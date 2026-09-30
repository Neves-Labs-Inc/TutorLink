"""Shapes shared between `parser_service` and `bot_service` (P7-A).

`BotIntent` lives here rather than in `models/enums.py` because it is never stored in a
column — it exists only to type the parser's structured output.

`FlagReason` is a PostgreSQL enum owned by task T1's migration `0014` and imported from
`app.models.enums`. T0 and T1 build concurrently, so there is a window in this phase in which
that import does not resolve; it is harmless because nothing imports this module until block 2.
"""

import enum
import uuid

from pydantic import BaseModel

from app.models.enums import FlagReason


class BotIntent(str, enum.Enum):
    BOOK = "book"
    CANCEL = "cancel"
    RESCHEDULE = "reschedule"
    LINK_GUARDIAN = "link_guardian"
    UNKNOWN = "unknown"


class ParsedIntent(BaseModel):
    """What the parser extracted from one inbound message.

    `answer` is the parent's answer to the question the bot last asked, or `None` when the
    message does not answer it. `fields` carries any other slots the message supplies (e.g. a
    child's name) as raw strings; `bot_service` is responsible for resolving them against the
    database.
    `confidence_is_low` signals a re-prompt rather than acting on a guess.
    """

    intent: BotIntent
    answer: str | None = None
    fields: dict[str, str]
    confidence_is_low: bool


class BotTurn(BaseModel):
    """One turn's result: what to say, and what the webhook should apply.

    P7-C: `bot_service` is pure with respect to the conversation row. It never mutates
    `conversations` or `messages` itself — the webhook applies `link_guardian_id`,
    `flag_reason` and `reactivation_child_id` after this returns. `reactivation_child_id` is the
    inactive child the guardian confirmed they want reactivated (REQ-132.3); the webhook records
    it through `conversation_service.request_reactivation`.
    """

    reply: str
    link_guardian_id: uuid.UUID | None = None
    flag_reason: FlagReason | None = None
    reactivation_child_id: uuid.UUID | None = None
