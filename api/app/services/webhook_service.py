"""What the two Twilio webhooks do: check the signature, record the delivery, schedule a turn.

**The signature is the whole of this surface's authentication.** `/webhook/*` carries no auth
dependency (see `app/routers/webhook.py`), so `signature_is_valid` returning `True` is the only
thing standing between the open internet and every write below it. It returns `False` when
`TWILIO_AUTH_TOKEN` is unset rather than skipping the check: an unconfigured deployment must
refuse the endpoint, never accept everything posted to it.

**Nothing here commits** (§4). One inbound message is one transaction and the router commits it
whole — then, and only then, publishes the broadcast events, so a database error on the notify
cannot turn a committed write into the 500 Twilio would retry for hours.

**The inbound insert is the only redelivery dedup.** Twilio retries a delivery it believes
failed with the same `MessageSid`, and `UNIQUE (messages.twilio_sid)` is what recognises it:
`record_inbound` returns `None` when the SID is already recorded, and `handle_inbound` stops
there — no keyword, no turn marker, nothing for the router to publish. A duplicate arriving
while the first is still in flight blocks on the unique index until the first transaction
ends, and then either conflicts or is the one that records.

**The bot answers later, never here** (docs/specs/whatsapp-bot-agent.md §7). A message to a
chat with the bot stamps `turn_due_at` four seconds ahead, each new message pushing it on, and
`bot_worker` runs one turn for the burst once it falls due. The webhook always answers Twilio
with empty TwiML. The one reply written here is the fixed STOP/START confirmation, recorded
`queued` and sent by the router after the commit; a keyword starts no turn.

**`From` is stored with the `whatsapp:` prefix stripped and nothing else done to it** (P7-H).
It does not go through `phone_service`: an inbound message is proof of dialability by delivery,
and a strict validator refusing it on stale libphonenumber metadata would drop a real client's
message behind a 400 Twilio then retries forever. Every other write path in this codebase
normalises, and that asymmetry is deliberate rather than an oversight.

**Every outbound message goes through Twilio's REST API and carries a SID**, so the status
callback advances bot replies, office replies and notices alike (§7 "Limits and retries"). A
bot reply Twilio reports `failed` or `undelivered` also flags the chat "Bot got stuck"; it is
never resent, since a late resend could land after the chat moved on.
"""

import datetime
import logging
from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy.orm import Session
from twilio.request_validator import RequestValidator

from app.config import get_settings
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    FlagReason,
    Language,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
)
from app.models.message import Message
from app.schemas.bot import ReminderButton
from app.services import (
    bot_messages,
    conversation_service,
    message_service,
    reminder_consent_service,
    reminder_service,
)
from app.services.twilio_service import (
    TwilioSendFailed,
    TwilioServiceError,
    send_whatsapp_message,
)

logger = logging.getLogger(__name__)

WHATSAPP_PREFIX = "whatsapp:"
# The debounce (spec §7): a burst of messages gets one turn, this long after the last of them.
TURN_DEBOUNCE = datetime.timedelta(seconds=4)

# A merge can move a message to another chat once while a callback waits on the first.
CHAT_LOCK_ATTEMPTS = 2

# Twilio sends more delivery states than `messages.status` models. `undelivered` is a terminal
# failure carrying an `ErrorCode` and is recorded as one; `sending` and `read` are the finer
# grain either side of states we do keep. Anything not named here is ignored — a status this
# schema has no column for is a Twilio state, not a malformed request, and answering it with
# something other than 204 would only teach Twilio to retry it.
TWILIO_STATUSES: dict[str, MessageStatus] = {
    "queued": MessageStatus.QUEUED,
    "sending": MessageStatus.QUEUED,
    "sent": MessageStatus.SENT,
    "delivered": MessageStatus.DELIVERED,
    "read": MessageStatus.DELIVERED,
    "failed": MessageStatus.FAILED,
    "undelivered": MessageStatus.FAILED,
}


@dataclass(frozen=True, slots=True)
class Inbound:
    """The rows the router broadcasts after it commits.

    `recorded` is empty on a redelivery and holds the inbound message otherwise. It carries
    `Message` rows rather than serialised events so the mapping to a response shape stays in
    the router (§5).

    `notice` is a STOP/START confirmation recorded `queued`. The router sends it with
    `send_notice` after the commit, then broadcasts it.
    """

    recorded: tuple[Message, ...]
    notice: Message | None = None


def signature_is_valid(*, url: str, params: Mapping[str, str], signature: str | None) -> bool:
    """Whether Twilio signed this exact request, against this exact URL.

    `url` must be the full absolute URL Twilio posted to, scheme included — see
    `app.routers.webhook.signed_request_url`, which is the only place it is rebuilt. A URL that
    disagrees with Twilio's by so much as its scheme fails every signature on the endpoint.
    """
    auth_token = get_settings().twilio_auth_token

    if not auth_token or signature is None:
        valid = False
    else:
        valid = RequestValidator(auth_token).validate(url, dict(params), signature)

    return valid


def handle_inbound(
    db: Session,
    *,
    twilio_from: str,
    body: str,
    twilio_sid: str,
    button_payload: str | None = None,
) -> Inbound:
    """Record one inbound message, answer a STOP/START keyword, and schedule the bot's turn.

    `button_payload` is Twilio's `ButtonPayload`: a quick-reply tap, whose `body` is the
    button's text. "Stop reminders" is a STOP; any other tap ("Book a session" included) is
    read as the text it carries.
    """
    phone_number = twilio_from.removeprefix(WHATSAPP_PREFIX)
    # Locked (FOR NO KEY UPDATE) and re-read: the status read below is the current one.
    conversation = conversation_service.resolve_or_create(db, phone_number=phone_number)

    # Recorded before anything else, whoever holds the chat: the office must be able to read
    # what the Guardian said while the bot was silent.
    inbound = message_service.record_inbound(
        db, conversation=conversation, body=body, twilio_sid=twilio_sid
    )

    if inbound is None:
        return Inbound(recorded=())

    # A thread whose Guardian left its number is re-linked to whoever holds it now, or a STOP
    # would be recorded for the old Guardian.
    conversation_service.link_to_holder(db, conversation=conversation)
    notice = _confirm_consent_keyword(
        db, conversation=conversation, inbound=inbound, button=_reminder_button(button_payload)
    )
    if notice is None and conversation.status is ConversationStatus.BOT:
        conversation_service.mark_turn_due(
            db,
            conversation=conversation,
            at=datetime.datetime.now(tz=datetime.UTC) + TURN_DEBOUNCE,
        )

    return Inbound(recorded=(inbound,), notice=notice)


def handle_status(
    db: Session,
    *,
    twilio_sid: str,
    twilio_status: str,
    error_code: str | None,
    twilio_to: str | None = None,
) -> Message | None:
    """Apply one delivery callback, if it names a message this deployment still models.

    Returns the advanced row for the router to broadcast after it commits, or `None` on either
    miss. Silent on both by design. An unknown `MessageSid` is an ordinary event — retention
    deletes messages on a schedule and Twilio's callbacks are not bounded by it — and a 404
    would only teach Twilio to retry a row that no longer exists
    (`docs/api-design.md:533-536`). An unmodelled status is the same shape of miss.

    A Booking reminder's row is moved first, from Twilio's own status: it keeps `read`, which
    `messages.status` folds into `delivered`. That step may wait for a reminder send still
    being recorded (`twilio_to`, the callback's `To`), after which the message's SID is
    committed too.

    A bot reply that fails here flags its chat "Bot got stuck" (spec §6), once: a replayed
    callback no longer moves the row, so it flags nothing.
    """
    reminder_service.apply_delivery_status(
        db,
        twilio_sid=twilio_sid,
        twilio_status=twilio_status,
        error_code=error_code,
        twilio_to=twilio_to,
    )
    status = TWILIO_STATUSES.get(twilio_status)

    if status is None:
        return None

    if status is MessageStatus.FAILED:
        _lock_bot_reply_chat(db, twilio_sid=twilio_sid)
    advanced = message_service.advance_status(
        db, twilio_sid=twilio_sid, status=status, error_code=error_code
    )
    if advanced is not None and _is_failed_bot_reply(advanced):
        logger.error(
            "bot message %s on conversation %s failed at Twilio (code %s); flagging the chat",
            advanced.id,
            advanced.conversation_id,
            error_code,
        )
        conversation = conversation_service.lock(db, conversation_id=advanced.conversation_id)
        conversation_service.flag(db, conversation=conversation, reason=FlagReason.STUCK)

    return advanced


def _lock_bot_reply_chat(db: Session, *, twilio_sid: str) -> None:
    """Lock the chat of the bot reply `twilio_sid` names, before `advance_status` locks the
    message: conversation first, as a number change's merge takes them. A merge that moved the
    message while this waited deleted the chat it was in, so the lookup is retried once."""
    for _ in range(CHAT_LOCK_ATTEMPTS):
        conversation_id = message_service.bot_reply_conversation_id(db, twilio_sid=twilio_sid)
        if conversation_id is None:
            break
        try:
            conversation_service.lock(db, conversation_id=conversation_id)
        except conversation_service.ConversationNotFound:
            continue
        break


def _is_failed_bot_reply(message: Message) -> bool:
    return message.author_kind is MessageAuthor.BOT and message.status is MessageStatus.FAILED


def _reminder_button(payload: str | None) -> ReminderButton | None:
    try:
        button = None if payload is None else ReminderButton(payload)
    except ValueError:
        logger.info("ignored an unknown ButtonPayload: %s", payload)
        button = None

    return button


def send_notice(db: Session, *, notice: Message) -> Message:
    """Send a committed `queued` notice and record the outcome: its SID, or `failed` with
    Twilio's code. The caller commits; the record was committed first, so a notice the process
    dies before sending is still a line in the thread (`notice_service`'s order)."""
    conversation = db.get_one(Conversation, notice.conversation_id)

    try:
        twilio_sid = send_whatsapp_message(to=conversation.phone_number, body=notice.body)
    except TwilioServiceError as exc:
        # A missing configuration carries no Twilio code; a refusal does, and Staff need it.
        error_code = exc.code if isinstance(exc, TwilioSendFailed) else None
        # No traceback: the chained Twilio error quotes the Guardian's number.
        logger.error(
            "consent notice %s on conversation %s was recorded but Twilio did not accept it:"
            " %s (code %s)",
            notice.id,
            conversation.id,
            exc,
            error_code,
        )
        sent = message_service.mark_failed(db, message=notice, error_code=error_code)
    else:
        sent = message_service.attach_twilio_sid(db, message=notice, twilio_sid=twilio_sid)

    return sent


def _confirm_consent_keyword(
    db: Session, *, conversation: Conversation, inbound: Message, button: ReminderButton | None
) -> Message | None:
    """Record a STOP/BAJA/PARAR or START/ALTA keyword, or a "Stop reminders" tap, and queue
    its fixed confirmation, whoever holds the chat (spec §3 "Reminder replies").

    Only the exact keywords and the button: a free-text phrase is the agent's to read, or the
    office's under Takeover. A chat with no Guardian has nothing to record against, so `None`,
    and the message is an ordinary one. A Spanish-only keyword (BAJA, PARAR, ALTA) switches the
    chat to Spanish and is confirmed in Spanish.
    """
    if button is ReminderButton.STOP_REMINDERS or bot_messages.is_stop_keyword(inbound.body):
        action: ConsentAction | None = ConsentAction.OPT_OUT
    elif bot_messages.is_start_keyword(inbound.body):
        action = ConsentAction.OPT_IN
    else:
        action = None

    notice = None
    owner = conversation_service.owner_id(db, conversation=conversation)
    if action is not None and owner is not None:
        detected = bot_messages.keyword_language(inbound.body)
        if detected is not None and conversation.language is not Language(detected):
            conversation_service.set_language(
                db, conversation=conversation, language=Language(detected)
            )
        reminder_consent_service.record_consent(
            db,
            guardian_id=owner,
            action=action,
            source=ConsentSource.MESSAGE,
            message_id=inbound.id,
            phone_number=conversation.phone_number,
        )
        language = None if conversation.language is None else conversation.language.value
        is_stop = action is ConsentAction.OPT_OUT
        notice = message_service.record_system_notice(
            db,
            conversation=conversation,
            body=bot_messages.render("OPTED_OUT" if is_stop else "OPTED_IN", language),
            system_kind=SystemMessageKind.CONSENT_NOTICE,
            author_user_id=None,
        )

    return notice
