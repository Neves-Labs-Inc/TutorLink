"""What the two Twilio webhooks do: check the signature, record the delivery, run one turn.

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
`record_inbound` returns `None` when the SID is already recorded, and `_turn` stops there with
empty TwiML — no status branch, no row lock, no bot turn, nothing for the router to publish.
That is sufficient on its own, concurrency included. A duplicate arriving while the first is
still in flight blocks on the unique index until the first transaction ends: if it committed,
the duplicate's insert conflicts and it takes the empty branch; if it rolled back, nothing was
recorded and the duplicate is the one turn that runs. Either way exactly one bot turn commits.
No second store is consulted first, so there is nothing to fall out of step with the row.

**`From` is stored with the `whatsapp:` prefix stripped and nothing else done to it** (P7-H).
It does not go through `phone_service`: an inbound message is proof of dialability by delivery,
and a strict validator refusing it on stale libphonenumber metadata would drop a real client's
message behind a 400 Twilio then retries forever. Every other write path in this codebase
normalises, and that asymmetry is deliberate rather than an oversight.

**Two outbound mechanisms, two status lifecycles, and they never meet** (amendment P7-3,
`docs/erd.md:349-356`, `docs/api-design.md:527-534`). A bot reply leaves as TwiML in this
webhook's own response and is recorded `sent` with a NULL `twilio_sid`, so it can never reach
`handle_status`; that callback advances only messages sent through Twilio's REST API, which is
an admin's reply typed on the socket.
"""

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
    Language,
    MessageStatus,
    SystemMessageKind,
)
from app.models.message import Message
from app.schemas.bot import BotTurn, ReminderButton
from app.services import (
    bot_messages,
    bot_service,
    conversation_service,
    message_service,
    reminder_consent_service,
    reminder_service,
    twilio_service,
)
from app.services.twilio_service import (
    TwilioSendFailed,
    TwilioServiceError,
    send_whatsapp_message,
)

logger = logging.getLogger(__name__)

WHATSAPP_PREFIX = "whatsapp:"

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
class InboundTurn:
    """The TwiML to answer Twilio with, and the rows the router broadcasts after it commits.

    `recorded` is empty on a redelivery, one row when an admin holds the thread, and two when
    the bot answered. It carries `Message` rows rather than serialised events so the mapping to
    a response shape stays in the router (§5).

    `notice` is a reminder-consent confirmation recorded `queued` under Takeover. The router
    sends it with `send_notice` after the commit, then broadcasts it.
    """

    twiml: str
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
) -> InboundTurn:
    """Record one inbound message and decide what to say back.

    The order of what follows is the specification, not an implementation choice
    (`docs/api-design.md:461-478`), and the router's signature check precedes all of it.

    `button_payload` is Twilio's `ButtonPayload`: a quick-reply tap, whose `body` is the
    button's text. A payload that is not a reminder button is ignored, and the tap is read as
    the text it carries.
    """
    return _turn(
        db,
        twilio_from=twilio_from,
        body=body,
        twilio_sid=twilio_sid,
        button=_reminder_button(button_payload),
    )


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

    return message_service.advance_status(
        db, twilio_sid=twilio_sid, status=status, error_code=error_code
    )


def _reminder_button(payload: str | None) -> ReminderButton | None:
    try:
        button = None if payload is None else ReminderButton(payload)
    except ValueError:
        logger.info("ignored an unknown ButtonPayload: %s", payload)
        button = None

    return button


def _turn(
    db: Session,
    *,
    twilio_from: str,
    body: str,
    twilio_sid: str,
    button: ReminderButton | None,
) -> InboundTurn:
    phone_number = twilio_from.removeprefix(WHATSAPP_PREFIX)
    conversation = conversation_service.resolve_or_create(db, phone_number=phone_number)

    # Recorded **before** the branch, never inside the `bot` arm
    # (`docs/api-design.md:475-478`). The whole point of a handoff is that the admin can read
    # what the client said while the bot was silent, so recording as a side effect of bot
    # processing would lose exactly the messages the takeover feature exists to show.
    inbound = message_service.record_inbound(
        db, conversation=conversation, body=body, twilio_sid=twilio_sid
    )

    if inbound is None:
        return InboundTurn(twiml=twilio_service.twiml_empty(), recorded=())

    notice = None

    if conversation.status is ConversationStatus.HUMAN:
        reply = None
        twiml = twilio_service.twiml_empty()
        notice = _confirm_consent_keyword(
            db, conversation=conversation, inbound=inbound, button=button
        )
    else:
        # REQ-130.4 / P7D-I. Re-read the pending request from the row, never from the identity
        # map, and under the row lock held to the commit: two overlapping turns must not both
        # see "nothing pending" and both record one. The lock serialises overlapping *distinct*
        # messages from one number; a redelivery never reaches this line, since it stopped at
        # the conflicting insert above. The insert's `last_message_at` update happens to hold
        # the lock already, and `with_for_update` takes it here regardless, where the read
        # depends on it, so a change to how recording touches the conversation cannot quietly
        # drop it. Conversation first, children after — the order `resolve_reactivation`
        # takes them in (P7D-E), so an approval racing this turn waits rather than deadlocks.
        # `flag_reason` is re-read under the same lock: `flag()` decides precedence from it,
        # and so is `language`, which Staff can change from the dashboard.
        db.refresh(
            conversation,
            attribute_names=["reactivation_child_id", "flag_reason", "language"],
            with_for_update=True,
        )
        decided = bot_service.reply_for(
            db,
            phone_number=phone_number,
            body=body,
            guardian_id=conversation.guardian_id,
            reactivation_pending=conversation.reactivation_child_id is not None,
            language=None if conversation.language is None else conversation.language.value,
            button=button,
        )
        _apply(db, conversation=conversation, decided=decided, inbound=inbound)
        reply = message_service.record_bot_reply(db, conversation=conversation, body=decided.reply)
        twiml = twilio_service.twiml_reply(decided.reply)

    recorded = tuple(row for row in (inbound, reply) if row is not None)

    return InboundTurn(twiml=twiml, recorded=recorded, notice=notice)


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
    """Under Takeover, record a STOP/BAJA/PARAR or START/ALTA keyword, or a "Stop reminders"
    tap, and queue its confirmation.

    Only the exact keywords and the button: the parser is not called while Staff hold the
    thread, so a free-text phrase (and a "Book a session" tap) is theirs to handle. A thread with no Guardian has nothing to record
    against, and is left to Staff the same way. A Spanish-only keyword (BAJA, PARAR, ALTA)
    switches the thread to Spanish, as it would with the bot, and is confirmed in Spanish.
    """
    if button is ReminderButton.STOP_REMINDERS or bot_messages.is_stop_keyword(inbound.body):
        action: ConsentAction | None = ConsentAction.OPT_OUT
    elif bot_messages.is_start_keyword(inbound.body):
        action = ConsentAction.OPT_IN
    else:
        action = None

    notice = None
    if action is not None and conversation.guardian_id is not None:
        # The bot's language rule for a keyword: a Spanish-only one switches the thread.
        detected = bot_service.keyword_language(inbound.body)
        if detected is not None and conversation.language is not Language(detected):
            conversation_service.set_language(
                db, conversation=conversation, language=Language(detected)
            )
        reminder_consent_service.record_consent(
            db,
            guardian_id=conversation.guardian_id,
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


def _apply(db: Session, *, conversation: Conversation, decided: BotTurn, inbound: Message) -> None:
    """Write the conversation mutations the bot decided on but left to its caller (P7-C).

    A flag does **not** suppress the reply (`docs/api-design.md:479-500`): the client is told
    an admin will reach out, and that reply is recorded and returned like any other.

    A Guardian language the turn adopted is stored, so the next turn replies in it.

    A reminder consent is recorded with the inbound message as its evidence and the thread's
    number as where it came from, after the link so a thread linked on this very turn still has
    its Guardian.

    A reactivation request is recorded last, and flags the thread `reactivation_request`
    (REQ-132.3). The bot only returns one when the column read under the row lock said nothing
    was pending, so `ReactivationAlreadyPending` cannot fire here; it is the service's own guard.
    """
    if decided.link_guardian_id is not None:
        conversation_service.link_guardian(
            db, conversation=conversation, guardian_id=decided.link_guardian_id
        )

    if decided.language is not None:
        conversation_service.set_language(
            db, conversation=conversation, language=Language(decided.language)
        )

    if decided.consent is not None and conversation.guardian_id is None:
        # The bot asks only at a step that has a Guardian, and reports the link on that turn.
        logger.warning(
            "dropped a %s consent on conversation %s: it has no guardian",
            decided.consent.action.value,
            conversation.id,
        )
    elif decided.consent is not None:
        reminder_consent_service.record_consent(
            db,
            guardian_id=conversation.guardian_id,
            action=decided.consent.action,
            source=decided.consent.source,
            message_id=inbound.id,
            phone_number=conversation.phone_number,
        )

    if decided.flag_reason is not None:
        conversation_service.flag(db, conversation=conversation, reason=decided.flag_reason)

    if decided.reactivation_child_id is not None:
        conversation_service.request_reactivation(
            db, conversation=conversation, child_id=decided.reactivation_child_id
        )
