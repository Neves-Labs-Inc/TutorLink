"""Telling the Guardian who has joined or left the chat: Takeover, Transfer and Hand-back
notices, and the Retry of one that failed (#109).

**The ownership change always stands.** Each entry point commits the takeover, transfer or
release first and only then records the notice, so nothing about the notice (a closed window, an
unapproved template, Twilio refusing the send) can undo it.

**Record, commit, send, attach**: the order `conversation_stream._record_and_send` uses for a
Staff message, and for its reason. A notice the process dies before sending is still a line in
the thread, and one Twilio refuses is marked `failed` with the code rather than left `queued`.
This module therefore commits, unlike the services it calls: the commit between the record
and the send is the whole point, so it cannot be left to a caller.

**The rule, applied the same way on a Retry.** Inside the Guardian's 24-hour window a notice
is free-form text; outside it a Takeover or Transfer notice needs an approved Utility template,
and a Hand-back notice is not sent at all. A blank template id means "not approved yet": the
line is recorded `failed` with `template_not_approved` and nothing is sent. The copy is in the
conversation's language (`NULL` is English).

**A notice is only sent while it is true.** It is re-judged under the conversation row lock
before it is recorded and before a Retry: an ownership change undone in the meantime (a
hand-back, a later transfer) sends no notice about it.

**No email-derived name reaches a Guardian.** A holder whose `display_name_is_default` is set
gets the nameless notice and the nameless template. The Staff-facing line still names them,
through `author_user_id`.
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
)
from app.models.message import Message
from app.models.user import User
from app.services import conversation_service, message_service
from app.services.bot_messages import DEFAULT_LANGUAGE, render
from app.services.conversation_service import ConversationDetail
from app.services.message_service import ThreadMessage
from app.services.settings_service import get_str_setting
from app.services.twilio_service import (
    TwilioSendFailed,
    TwilioServiceError,
    send_whatsapp_message,
    send_whatsapp_template,
)

WINDOW_CLOSED = "window_closed"
TEMPLATE_NOT_APPROVED = "template_not_approved"
TAKEOVER_TEMPLATE_SETTING = "takeover_template_sid_{language}"
GENERIC_TAKEOVER_TEMPLATE_SETTING = "takeover_generic_template_sid_{language}"
TEMPLATE_STAFF_VARIABLE = "1"

RETRYABLE_KINDS = frozenset({SystemMessageKind.TAKEOVER_NOTICE, SystemMessageKind.TRANSFER_NOTICE})

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class NoticeOutcome:
    """The conversation after the change and its notice, `None` when nothing changed."""

    detail: ConversationDetail
    notice: ThreadMessage | None


class NoticeServiceError(Exception):
    """Base class for every failure this module reports."""


class NoticeNotFound(NoticeServiceError):
    """No message with that id in that conversation."""


class NoticeNotRetryable(NoticeServiceError):
    """Retry on anything but a failed Takeover or Transfer notice."""


class NoticeOutdated(NoticeServiceError):
    """Retry of a notice whose Takeover has ended: handed back, or transferred since."""


@dataclass(frozen=True, slots=True)
class _Plan:
    """What one notice sends: free-form `body`, or `template_sid` with `variables` (`body` is
    then the chat copy of the template). `refusal` is the reason nothing may be sent."""

    body: str
    template_sid: str | None
    variables: dict[str, str]
    refusal: str | None


def take_over(db: Session, *, conversation_id: uuid.UUID, user_id: uuid.UUID) -> NoticeOutcome:
    """Claim the thread and, unless the caller already held it, tell the Guardian who joined.

    Raises `conversation_service`'s `ConversationNotFound` and `ConversationHeldByAnother`.
    """
    change = conversation_service.claim(db, conversation_id=conversation_id, user_id=user_id)
    db.commit()
    notice = None

    if change.is_changed:
        notice = _notify(
            db,
            conversation_id=conversation_id,
            kind=SystemMessageKind.TAKEOVER_NOTICE,
            author_user_id=user_id,
        )

    return NoticeOutcome(
        detail=conversation_service.get_detail(db, conversation_id=conversation_id),
        notice=notice,
    )


def transfer(db: Session, *, conversation_id: uuid.UUID, user_id: uuid.UUID) -> NoticeOutcome:
    """Move a thread another Staff member holds to the caller, and tell the Guardian.

    Raises `ConversationNotFound`, `ConversationNotHeld` and `ConversationAlreadyHeld`.
    """
    conversation_service.transfer(db, conversation_id=conversation_id, user_id=user_id)
    db.commit()
    notice = _notify(
        db,
        conversation_id=conversation_id,
        kind=SystemMessageKind.TRANSFER_NOTICE,
        author_user_id=user_id,
    )

    return NoticeOutcome(
        detail=conversation_service.get_detail(db, conversation_id=conversation_id),
        notice=notice,
    )


def hand_back(db: Session, *, conversation_id: uuid.UUID, user_id: uuid.UUID) -> NoticeOutcome:
    """Hand the thread back to the bot and, if it was held, tell the Guardian it is back.

    Outside the window nothing is sent, and the line records `window_closed` so Staff can see
    the Guardian was not told. Raises `ConversationNotFound`.
    """
    change = conversation_service.release(db, conversation_id=conversation_id)
    db.commit()
    notice = None

    if change.is_changed:
        notice = _notify(
            db,
            conversation_id=conversation_id,
            kind=SystemMessageKind.HANDBACK_NOTICE,
            author_user_id=user_id,
        )

    return NoticeOutcome(
        detail=conversation_service.get_detail(db, conversation_id=conversation_id),
        notice=notice,
    )


def retry(db: Session, *, conversation_id: uuid.UUID, message_id: uuid.UUID) -> ThreadMessage:
    """Send a failed Takeover or Transfer notice again, on the same row.

    The rule is re-evaluated rather than replayed: the window may have closed since, and the
    holder may have set a real Display name. The notice must still be true: a Takeover that was
    handed back or transferred since is refused, or the Guardian would be told the wrong person
    is in the chat. The conversation is locked first (so a hand-back cannot slip in before the
    send is recorded), then the message (so two retries cannot both send).
    """
    try:
        conversation = conversation_service.lock(db, conversation_id=conversation_id)
    except conversation_service.ConversationNotFound as exc:
        raise NoticeNotFound(f"no conversation {conversation_id}") from exc

    message = db.execute(
        select(Message)
        .where(Message.id == message_id, Message.conversation_id == conversation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()

    if message is None:
        raise NoticeNotFound(f"no message {message_id} in conversation {conversation_id}")

    is_retryable = (
        message.author_kind is MessageAuthor.SYSTEM
        and message.system_kind in RETRYABLE_KINDS
        and message.status is MessageStatus.FAILED
    )
    if not is_retryable:
        raise NoticeNotRetryable(f"message {message_id} is not a failed takeover notice")

    if not _is_current(
        conversation, kind=message.system_kind, author_user_id=message.author_user_id
    ):
        raise NoticeOutdated(f"message {message_id} is about a takeover that has ended")

    author = db.get_one(User, message.author_user_id)
    plan = _plan(db, conversation=conversation, kind=message.system_kind, author=author)
    message_service.requeue(db, message=message, body=plan.body)

    return _send(db, message=message, conversation=conversation, plan=plan)


def _notify(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    kind: SystemMessageKind,
    author_user_id: uuid.UUID,
) -> ThreadMessage | None:
    """Record and send the notice, unless the change it announces was undone in the meantime.

    The change was committed (releasing its lock) before this runs, so another Staff member's
    hand-back or transfer can land in between. Re-judged under the lock, a notice that is no
    longer true is skipped; the later change records its own. The lock is held until the
    record commits, so notices are recorded in the order of the changes they announce.
    """
    conversation = conversation_service.lock(db, conversation_id=conversation_id)
    notice = None

    if _is_current(conversation, kind=kind, author_user_id=author_user_id):
        author = db.get_one(User, author_user_id)
        plan = _plan(db, conversation=conversation, kind=kind, author=author)
        message = message_service.record_system_notice(
            db,
            conversation=conversation,
            body=plan.body,
            system_kind=kind,
            author_user_id=author_user_id,
        )
        notice = _send(db, message=message, conversation=conversation, plan=plan)
    else:
        # Ends the transaction the lock opened.
        db.commit()

    return notice


def _is_current(
    conversation: Conversation, *, kind: SystemMessageKind | None, author_user_id: uuid.UUID | None
) -> bool:
    """Whether the ownership a notice announces is still the conversation's."""
    if kind is SystemMessageKind.HANDBACK_NOTICE:
        is_current = conversation.status is ConversationStatus.BOT
    else:
        is_current = (
            conversation.status is ConversationStatus.HUMAN
            and conversation.taken_over_by_user_id == author_user_id
        )

    return is_current


def _send(
    db: Session, *, message: Message, conversation: Conversation, plan: _Plan
) -> ThreadMessage:
    """Commit the queued row, send it (or record why not), and commit the outcome."""
    db.commit()

    if plan.refusal is not None:
        message_service.mark_failed(db, message=message, error_code=plan.refusal)
    else:
        try:
            twilio_sid = _deliver(to=conversation.phone_number, plan=plan)
        except TwilioServiceError as exc:
            logger.exception(
                "notice %s on conversation %s was recorded but Twilio did not accept it",
                message.id,
                conversation.id,
            )
            # A missing configuration carries no Twilio code; a refusal does, and Staff need it.
            error_code = exc.code if isinstance(exc, TwilioSendFailed) else None
            message_service.mark_failed(db, message=message, error_code=error_code)
        else:
            message_service.attach_twilio_sid(db, message=message, twilio_sid=twilio_sid)

    db.commit()
    row = message_service.get_thread_message(db, message_id=message.id)
    # The row was committed above and nothing here deletes it.
    assert row is not None

    return row


def _deliver(*, to: str, plan: _Plan) -> str:
    if plan.template_sid is None:
        twilio_sid = send_whatsapp_message(to=to, body=plan.body)
    else:
        twilio_sid = send_whatsapp_template(
            to=to, content_sid=plan.template_sid, content_variables=plan.variables
        )

    return twilio_sid


def _plan(
    db: Session, *, conversation: Conversation, kind: SystemMessageKind, author: User
) -> _Plan:
    language = None if conversation.language is None else conversation.language.value
    is_open = conversation_service.window_is_open(db, conversation_id=conversation.id)

    if kind is SystemMessageKind.HANDBACK_NOTICE:
        plan = _Plan(
            body=render("HANDBACK_NOTICE", language),
            template_sid=None,
            variables={},
            refusal=None if is_open else WINDOW_CLOSED,
        )
    elif is_open:
        plan = _free_form_takeover(language=language, author=author)
    else:
        plan = _template_takeover(db, language=language, author=author)

    return plan


def _free_form_takeover(*, language: str | None, author: User) -> _Plan:
    if author.display_name_is_default:
        body = render("TAKEOVER_NOTICE_GENERIC", language)
    else:
        body = render("TAKEOVER_NOTICE", language, staff=author.display_name)

    return _Plan(body=body, template_sid=None, variables={}, refusal=None)


def _template_takeover(db: Session, *, language: str | None, author: User) -> _Plan:
    setting_language = language or DEFAULT_LANGUAGE

    if author.display_name_is_default:
        setting = GENERIC_TAKEOVER_TEMPLATE_SETTING
        body = render("TEMPLATE_takeover_notice_generic", language)
        variables = {}
    else:
        setting = TAKEOVER_TEMPLATE_SETTING
        body = render("TEMPLATE_takeover_notice", language, staff=author.display_name)
        variables = {TEMPLATE_STAFF_VARIABLE: author.display_name}

    template_sid = get_str_setting(db, key=setting.format(language=setting_language)).strip()

    return _Plan(
        body=body,
        template_sid=template_sid or None,
        variables=variables,
        refusal=None if template_sid else TEMPLATE_NOT_APPROVED,
    )
