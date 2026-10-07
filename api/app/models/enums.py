"""Native PostgreSQL enum types used across the schema.

The `ENUM` instances below carry `create_type=False`: the types are created and dropped
explicitly by the Alembic migration, because a native PostgreSQL enum survives `DROP TABLE`
and would otherwise be left behind by `alembic downgrade base`.

`postgresql.ENUM` is used rather than `sa.Enum` deliberately — `sa.Enum` accepts a
`create_type` keyword but silently discards it, and its dialect implementation still
reports `create_type=True`.
"""

import enum

from sqlalchemy import Enum
from sqlalchemy.dialects import postgresql

USER_ROLE_ENUM_NAME = "user_role"
BOOKING_STATUS_ENUM_NAME = "booking_status"
EXCEPTION_STATUS_ENUM_NAME = "exception_status"
CONVERSATION_STATUS_ENUM_NAME = "conversation_status"
MESSAGE_AUTHOR_ENUM_NAME = "message_author"
MESSAGE_STATUS_ENUM_NAME = "message_status"
FLAG_REASON_ENUM_NAME = "flag_reason"


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    TUTOR = "tutor"
    DEVELOPER = "developer"
    MANAGER = "manager"


class BookingStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class ExceptionStatus(str, enum.Enum):
    """Approval state of a tutor availability exception.

    Only `APPROVED` blocks bookings. A `PENDING` request is a tutor asking for time off and
    has no effect on availability until an admin decides it, and `REJECTED` is terminal — so
    any query that subtracts exceptions from a tutor's schedule must filter on `APPROVED`
    rather than on the row's existence.
    """

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ConversationStatus(str, enum.Enum):
    """Who is answering the client on this thread right now.

    Deliberately not merged with `FlagReason`. `status` answers "who is replying" and
    `flag_reason` answers "why does an admin need to look" — a `BOT` conversation can be
    flagged and unattended, and a `HUMAN` one can carry a flag raised before the takeover.
    One column would lose whichever half is not currently true.
    """

    BOT = "bot"
    HUMAN = "human"


class MessageAuthor(str, enum.Enum):
    """Who wrote a message. Inbound and outbound are derived from this rather than stored:
    `CLIENT` is inbound, `BOT`, `ADMIN` and `SYSTEM` are outbound, and a second column
    recording the same fact could disagree with this one.

    `SYSTEM` is a notice the system sent or recorded on a Staff member's behalf (a takeover
    notice, a weekly reminder); `messages.system_kind` says which."""

    CLIENT = "client"
    BOT = "bot"
    ADMIN = "admin"
    SYSTEM = "system"


class MessageStatus(str, enum.Enum):
    """Delivery state.

    An inbound message is written `RECEIVED` and never moves again. An outbound message sent
    through Twilio's REST API — an admin's reply — starts `QUEUED` and is advanced by the
    delivery status callback. A bot reply returned as TwiML is written `SENT` directly: Twilio
    does not mint a `MessageSid` until after it reads the webhook's response, so the row has no
    SID for a later callback to match and would otherwise sit at `QUEUED` forever.
    """

    RECEIVED = "received"
    QUEUED = "queued"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"


class FlagReason(str, enum.Enum):
    """Why an admin needs to look at a conversation.

    `STUCK` is two failed re-prompts in a row with no usable reply. `PARSE_ERROR` is the parser
    itself failing rather than the client being unclear, raised immediately rather than burning
    a re-prompt on an outage that is not the client's fault.

    `GUARDIAN_LINK_REQUEST` is **not** a failure: the bot worked, understood a second guardian
    asking to be linked to an existing child, and stopped because phone-alone identity cannot
    tell a real second guardian from anyone who knows a child's name. It is listed beside the
    two failures but must be surfaced apart from them.

    `REACTIVATION_REQUEST` is not a failure either: a guardian asked for one of their inactive
    children to be reactivated, and only an admin can decide that. Like `GUARDIAN_LINK_REQUEST`
    it is an admin action rather than a bot failure. It was added by the user's OQ-71 answer
    (Phase 7D), which reversed the earlier three-values-only rule; the child it names is on
    `conversations.reactivation_child_id`, which a later flag does not overwrite.

    `BOOKING_REQUEST` and `QUESTION` are not failures either: the bot worked and handed the chat
    to the office. A booking request is an Office handoff (a Child not Evaluated, or with no
    Subject level for the subject), which only Staff can place; a question is one the bot cannot
    answer.

    No value exists for a policy refusal. A reschedule or cancellation refused inside
    `cancellation_cutoff_hours` is the bot working as intended rather than failing, and flagging
    it would bury the flags that mean the bot needs help.
    """

    STUCK = "stuck"
    PARSE_ERROR = "parse_error"
    GUARDIAN_LINK_REQUEST = "guardian_link_request"
    REACTIVATION_REQUEST = "reactivation_request"
    BOOKING_REQUEST = "booking_request"
    QUESTION = "question"


# The enums below are stored as VARCHAR with a CHECK rather than as native PostgreSQL enums:
# a native enum cannot drop a value and cannot use a new one in the transaction that added it,
# and none of these is shared across enough tables to earn that cost.


class Language(str, enum.Enum):
    """A Guardian-facing language. NULL where it is stored means not detected: English is used."""

    EN = "en"
    ES = "es"


LANGUAGE_CODE_LENGTH = 2


class ConsentAction(str, enum.Enum):
    OPT_IN = "opt_in"
    OPT_OUT = "opt_out"


class ConsentSource(str, enum.Enum):
    """Where a reminder consent came from. `SYSTEM` is Twilio reporting the number blocked."""

    INTAKE = "intake"
    MESSAGE = "message"
    STAFF = "staff"
    SYSTEM = "system"


class ReminderStatus(str, enum.Enum):
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"
    UNDELIVERABLE = "undeliverable"
    SKIPPED = "skipped"


class ReminderSkipReason(str, enum.Enum):
    TAKEOVER = "takeover"
    TEMPLATE_NOT_APPROVED = "template_not_approved"


class SystemMessageKind(str, enum.Enum):
    TAKEOVER_NOTICE = "takeover_notice"
    TRANSFER_NOTICE = "transfer_notice"
    HANDBACK_NOTICE = "handback_notice"
    BOOKING_REMINDER = "booking_reminder"
    CONSENT_NOTICE = "consent_notice"


def _values(enum_class: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_class]


def varchar_enum(enum_class: type[enum.Enum], *, length: int) -> Enum:
    """A VARCHAR column type that reads and writes `enum_class` members.

    No constraint is emitted here: each table declares its own named CHECK through
    `in_values_predicate`, so the migration and the model name it the same way.
    """
    return Enum(
        enum_class,
        native_enum=False,
        create_constraint=False,
        length=length,
        values_callable=_values,
        validate_strings=True,
    )


def in_values_predicate(column: str, enum_class: type[enum.Enum]) -> str:
    """The CHECK predicate `column IN (...)` over every value of `enum_class`."""
    values = ", ".join(f"'{value}'" for value in _values(enum_class))

    return f"{column} IN ({values})"


user_role_enum = postgresql.ENUM(
    UserRole,
    name=USER_ROLE_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

booking_status_enum = postgresql.ENUM(
    BookingStatus,
    name=BOOKING_STATUS_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

exception_status_enum = postgresql.ENUM(
    ExceptionStatus,
    name=EXCEPTION_STATUS_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

conversation_status_enum = postgresql.ENUM(
    ConversationStatus,
    name=CONVERSATION_STATUS_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

message_author_enum = postgresql.ENUM(
    MessageAuthor,
    name=MESSAGE_AUTHOR_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

message_status_enum = postgresql.ENUM(
    MessageStatus,
    name=MESSAGE_STATUS_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

flag_reason_enum = postgresql.ENUM(
    FlagReason,
    name=FLAG_REASON_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

USER_ROLE_VALUES = _values(UserRole)
BOOKING_STATUS_VALUES = _values(BookingStatus)
EXCEPTION_STATUS_VALUES = _values(ExceptionStatus)
CONVERSATION_STATUS_VALUES = _values(ConversationStatus)
MESSAGE_AUTHOR_VALUES = _values(MessageAuthor)
MESSAGE_STATUS_VALUES = _values(MessageStatus)
FLAG_REASON_VALUES = _values(FlagReason)
