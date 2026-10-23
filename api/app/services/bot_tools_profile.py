"""The bot agent's non-booking tools: Intake records, Subjects, reminder preference and the
Office handoff (docs/specs/whatsapp-bot-agent.md §2 Tools, §3, §5 Redaction, §6).

Each tool follows `bot_tool_contract`: a strict input schema, idempotent writes, a rule
refusal as `ToolResult(status="refused")` with a `reason`, and any other exception left to
raise so the turn loop treats it as an outage. Every call and its result go to the app log
with the conversation id and record ids; personal values (address, directions, date of
birth, notes, the handoff summary, names, school, label, grade) are logged as set or not only.

**A deactivated Guardian** (archived by the office) is refused `guardian_deactivated` by every
tool that writes for them; `hand_off_to_office` stays open so the office hears from them.

**Saved details go to the office.** After Intake the Guardian can add a Home or a Child, and
the `update_*` tools only fill a field that is empty now (the closing asks). Changing a saved
value is refused `saved_details_go_to_office`, and the agent hands that request off.

**Redaction marking.** A save that stores an address, directions, a date of birth or notes
marks the Guardian messages and bot replies holding the saved value (`bot_redaction`) with the
field, so the history hides it. The candidates are those since that record's last save
(`updated_at`); for a new record, the last `HISTORY_WINDOW_MESSAGES`, among which is every
Guardian or bot message any 20-message history window can show. A value no candidate holds was
reworded, so the Guardian messages this turn answers are marked instead and the history hides
them whole. Bodies are never changed.
"""

import datetime
import logging
import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.child import HIGHEST_GRADE, LOWEST_GRADE, NOTES_MAX_LENGTH, Child
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    FlagReason,
    MessageAuthor,
    RedactedField,
    SystemMessageKind,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import DIRECTIONS_MAX_LENGTH, GuardianHome, Home
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.services import (
    bot_redaction,
    child_service,
    client_service,
    conversation_service,
    home_service,
    message_service,
    reminder_consent_service,
    subject_service,
)
from app.services.bot_tool_contract import SavedValue, ToolContext, ToolResult, ToolSpec
from app.services.intake_progress import intake_progress
from app.services.name_rules import InvalidName, normalize_name
from app.services.phone_service import InvalidPhoneNumber

logger = logging.getLogger(__name__)

ToolRun = Callable[[ToolContext, Mapping[str, object]], ToolResult]

# Guardian and bot messages a new record marks: at least every one a history window shows.
HISTORY_WINDOW_MESSAGES = 20
# `homes.label` is String(64); the address has no column limit, so the bot's Intake limit.
LABEL_MAX_LENGTH = 64
ADDRESS_MAX_LENGTH = 1000
# Far above any real catalogue; the bot's Subject list used the same bound.
SUBJECTS_LIMIT = 100
# Matches the Child notes bound; the note is model-written.
SUMMARY_MAX_LENGTH = 2000

# Refusal reasons the agent rephrases for the Guardian.
NAME_INVALID = "name_invalid"
PHONE_NUMBER_INVALID = "phone_number_invalid"
GUARDIAN_NEEDED = "guardian_needed"
# The office closed the account; only a handoff stays open to them.
GUARDIAN_DEACTIVATED = "guardian_deactivated"
ADDRESS_NEEDED = "address_needed"
ADDRESS_TOO_LONG = "address_too_long"
DIRECTIONS_TOO_LONG = "directions_too_long"
LABEL_NEEDED = "label_needed"
LABEL_TOO_LONG = "label_too_long"
HOME_NEEDED = "home_needed"
HOME_NOT_FOUND = "home_not_found"
CHILD_ARCHIVED = "child_archived"
SCHOOL_INVALID = "school_invalid"
GRADE_OUT_OF_RANGE = "grade_out_of_range"
DATE_OF_BIRTH_UNREADABLE = "date_of_birth_unreadable"
DATE_OF_BIRTH_IMPLAUSIBLE = "date_of_birth_implausible"
NOTES_TOO_LONG = "notes_too_long"
CHILD_NOT_FOUND = "child_not_found"
SAVED_DETAILS_GO_TO_OFFICE = "saved_details_go_to_office"
SUMMARY_NEEDED = "summary_needed"
SUMMARY_TOO_LONG = "summary_too_long"
CHILD_NEEDED = "child_needed"
ARCHIVED_CHILD_NOT_FOUND = "archived_child_not_found"
REACTIVATION_ALREADY_PENDING = "reactivation_already_pending"

# The handoff reasons the agent may give (spec §3 Off-script and handoffs).
HANDOFF_REASONS = (
    FlagReason.QUESTION,
    FlagReason.BOOKING_REQUEST,
    FlagReason.GUARDIAN_LINK_REQUEST,
    FlagReason.REACTIVATION_REQUEST,
    FlagReason.DIDNT_UNDERSTAND,
)


def _create_guardian(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """The Guardian at the chat's number, linked to the chat. One already holding the number
    is returned unchanged."""
    existing = _guardian(ctx)

    if existing is not None and existing.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    if existing is not None:
        return ToolResult(status="ok", content=_guardian_content(existing))

    try:
        name = normalize_name(_text(tool_input, "name"))
    except InvalidName:
        return _refused(NAME_INVALID)

    try:
        detail = client_service.create_client(
            ctx.db,
            name=name,
            phone_number=ctx.conversation.phone_number,
            home=None,
            is_bot_turn=True,
        )
    except InvalidPhoneNumber:
        return _refused(PHONE_NUMBER_INVALID)

    # Through the turn's copy, never the row: the turn applies it under its end lock, so the
    # chat's row lock isn't held for the rest of the turn (spec: lock at start and end only).
    conversation_service.link_guardian(
        ctx.db, conversation=ctx.conversation, guardian_id=detail.client.id
    )

    return ToolResult(status="ok", content=_guardian_content(detail.client), progress=True)


def _create_home(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """A Home for the Guardian. The first is labelled "<first name>'s" unless a label is
    given; a later one needs a label, since the Guardian picks Homes by it. The same address
    returns the Guardian's existing Home unchanged."""
    guardian = _guardian(ctx)
    address = _text(tool_input, "address")
    directions = _optional_text(tool_input, "directions")
    label = _optional_text(tool_input, "label")

    if guardian is None:
        return _refused(GUARDIAN_NEEDED)

    if guardian.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    try:
        details = home_service.home_details(label=label, address=address, directions=directions)
    except home_service.BlankAddress:
        return _refused(ADDRESS_NEEDED)

    homes = _active_homes(ctx.db, guardian_id=guardian.id)
    same_address = next(
        (home for home in homes if _comparable(home.address) == _comparable(details.address)),
        None,
    )

    if same_address is not None:
        return ToolResult(status="ok", content=_home_content(same_address))

    stored_label = details.label

    if stored_label is None and homes:
        return _refused(LABEL_NEEDED)

    if stored_label is None:
        stored_label = f"{guardian.name.split()[0]}'s"

    refusal = _home_text_refusal(
        address=details.address, directions=details.directions, label=stored_label
    )

    if refusal is not None:
        return refusal

    home = home_service.add_home(
        ctx.db,
        client_id=guardian.id,
        label=stored_label,
        address=details.address,
        directions=details.directions,
    )

    saved = _home_values(home)
    _mark_redacted(ctx, saved=saved, since=None)

    return ToolResult(status="ok", content=_home_content(home), progress=True, redacted=saved)


def _create_child(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """A Child of the Guardian, once its name, school and Overall grade are in. The same name
    returns the Guardian's existing Child; the name of an archived one is refused with its id,
    since that is a Reactivation request, not a new Child.

    `home_id` is checked but not stored: a Child's Homes are its Guardians' Homes (#214).
    """
    guardian = _guardian(ctx)
    grade = tool_input["grade"]
    home_id = _optional_text(tool_input, "home_id")
    raw_date_of_birth = _optional_text(tool_input, "date_of_birth")
    notes = _optional_text(tool_input, "notes")

    if guardian is None:
        return _refused(GUARDIAN_NEEDED)

    if guardian.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    homes = _active_homes(ctx.db, guardian_id=guardian.id)

    if not homes:
        return _refused(HOME_NEEDED)

    if home_id is not None and home_id not in {str(home.id) for home in homes}:
        return _refused(HOME_NOT_FOUND)

    try:
        name = normalize_name(_text(tool_input, "name"))
    except InvalidName:
        return _refused(NAME_INVALID)

    same_name = next(
        (
            child
            for child in _linked_children(ctx.db, guardian_id=guardian.id)
            if _comparable(child.name) == _comparable(name)
        ),
        None,
    )

    if same_name is not None and same_name.is_archived:
        return _refused(CHILD_ARCHIVED, child_id=str(same_name.id))

    if same_name is not None:
        return ToolResult(status="ok", content=_child_content(same_name))

    try:
        school = normalize_name(_text(tool_input, "school"))
    except InvalidName:
        return _refused(SCHOOL_INVALID)

    is_grade = isinstance(grade, int) and not isinstance(grade, bool)

    if not is_grade or not LOWEST_GRADE <= grade <= HIGHEST_GRADE:
        return _refused(GRADE_OUT_OF_RANGE, lowest=LOWEST_GRADE, highest=HIGHEST_GRADE)

    date_of_birth = _date(raw_date_of_birth)

    if raw_date_of_birth is not None and date_of_birth is None:
        return _refused(DATE_OF_BIRTH_UNREADABLE)

    if notes is not None and len(notes.strip()) > NOTES_MAX_LENGTH:
        return _refused(NOTES_TOO_LONG, max_length=NOTES_MAX_LENGTH)

    try:
        child = child_service.create_child(
            ctx.db,
            guardian_ids=[guardian.id],
            name=name,
            date_of_birth=date_of_birth,
            grade_level=grade,
            school_name=school,
            notes=notes,
        )
    except child_service.InvalidDateOfBirth:
        return _refused(DATE_OF_BIRTH_IMPLAUSIBLE)

    saved = _child_values(
        date_of_birth=child.date_of_birth, raw_date_of_birth=raw_date_of_birth, notes=child.notes
    )
    _mark_redacted(ctx, saved=saved, since=None)

    return ToolResult(status="ok", content=_child_content(child), progress=True, redacted=saved)


def _update_guardian(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """A correction to the Guardian's name, only while Intake is in progress: after it, a
    change to a saved record goes to the office."""
    guardian = _guardian(ctx)

    if guardian is None:
        return _refused(GUARDIAN_NEEDED)

    if guardian.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    if not intake_progress(ctx.db, conversation=ctx.conversation).in_progress:
        return _refused(SAVED_DETAILS_GO_TO_OFFICE)

    try:
        name = normalize_name(_text(tool_input, "name"))
    except InvalidName:
        return _refused(NAME_INVALID)

    is_changed = name != guardian.name

    # A direct write: `client_service.update_client` needs a Staff member for its number
    # change, and this changes the name only.
    if is_changed:
        guardian.name = name
        ctx.db.flush()

    return ToolResult(status="ok", content=_guardian_content(guardian), progress=is_changed)


def _update_home(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """Fill a Home's empty directions or label (the closing asks). Repeating a saved value
    changes nothing; changing one is refused, and then nothing in the call is saved."""
    guardian = _guardian(ctx)
    home_id = _text(tool_input, "home_id")
    directions = _stripped(_optional_text(tool_input, "directions"))
    label = _stripped(_optional_text(tool_input, "label"))

    if guardian is None:
        return _refused(GUARDIAN_NEEDED)

    if guardian.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    home = next(
        (
            home
            for home in _active_homes(ctx.db, guardian_id=guardian.id)
            if str(home.id) == home_id
        ),
        None,
    )

    if home is None:
        return _refused(HOME_NOT_FOUND)

    refusal = _home_text_refusal(address=None, directions=directions, label=label)

    if refusal is not None:
        return refusal

    if _changes_saved(home.directions, directions) or _changes_saved(home.label, label):
        return _refused(SAVED_DETAILS_GO_TO_OFFICE)

    new_directions = directions if home.directions is None else None
    new_label = label if home.label is None else None
    is_changed = new_directions is not None or new_label is not None
    last_saved_at = home.updated_at

    if is_changed:
        home_service.update_home(
            ctx.db, home_id=home.id, label=new_label, address=None, directions=new_directions
        )

    filled = (
        ()
        if new_directions is None
        else (SavedValue(field=RedactedField.HOME_DIRECTIONS, text=new_directions),)
    )
    _mark_redacted(ctx, saved=filled, since=last_saved_at)

    return ToolResult(
        status="ok", content=_home_content(home), progress=is_changed, redacted=filled
    )


def _update_child(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """Fill a Child's empty notes or date of birth, on the same terms as `update_home`."""
    guardian = _guardian(ctx)
    child_id = _text(tool_input, "child_id")
    notes = _stripped(_optional_text(tool_input, "notes"))
    raw_date_of_birth = _optional_text(tool_input, "date_of_birth")
    date_of_birth = _date(raw_date_of_birth)

    if guardian is None:
        return _refused(GUARDIAN_NEEDED)

    if guardian.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    child = next(
        (
            child
            for child in _linked_children(ctx.db, guardian_id=guardian.id)
            if str(child.id) == child_id and not child.is_archived
        ),
        None,
    )

    if child is None:
        return _refused(CHILD_NOT_FOUND)

    if raw_date_of_birth is not None and date_of_birth is None:
        return _refused(DATE_OF_BIRTH_UNREADABLE)

    if notes is not None and len(notes) > NOTES_MAX_LENGTH:
        return _refused(NOTES_TOO_LONG, max_length=NOTES_MAX_LENGTH)

    if _changes_saved(child.notes, notes) or _changes_saved(child.date_of_birth, date_of_birth):
        return _refused(SAVED_DETAILS_GO_TO_OFFICE)

    new_notes = notes if child.notes is None else None
    new_date_of_birth = date_of_birth if child.date_of_birth is None else None
    last_saved_at = child.updated_at

    if new_notes is not None or new_date_of_birth is not None:
        try:
            child_service.update_child(
                ctx.db,
                child_id=child.id,
                guardian_ids=None,
                name=None,
                date_of_birth=new_date_of_birth,
                grade_level=None,
                school_name=None,
                notes=new_notes,
            )
        except child_service.InvalidDateOfBirth:
            return _refused(DATE_OF_BIRTH_IMPLAUSIBLE)

    filled = _child_values(
        date_of_birth=new_date_of_birth, raw_date_of_birth=raw_date_of_birth, notes=new_notes
    )
    _mark_redacted(ctx, saved=filled, since=last_saved_at)

    return ToolResult(
        status="ok", content=_child_content(child), progress=bool(filled), redacted=filled
    )


def _list_subjects(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """Active Subjects; `name_es` falls back to the English name, as the bot shows it."""
    rows, _ = subject_service.list_subjects(
        ctx.db, is_archived=False, limit=SUBJECTS_LIMIT, offset=0
    )
    subjects = [
        {
            "subject_id": str(row.subject.id),
            "name_en": row.subject.name,
            "name_es": row.subject.name_es or row.subject.name,
        }
        for row in rows
    ]

    return ToolResult(status="ok", content={"subjects": subjects})


def _set_reminder_preference(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """Opt the Guardian in or out of the weekly Booking reminder, with the turn's latest
    Guardian message as the evidence and the chat's number as where it came from."""
    guardian = _guardian(ctx)
    action = ConsentAction.OPT_IN if tool_input["opt_in"] is True else ConsentAction.OPT_OUT

    if guardian is None:
        return _refused(GUARDIAN_NEEDED)

    if guardian.is_archived:
        return _refused(GUARDIAN_DEACTIVATED)

    evidence = _latest_inbound(ctx)
    latest = ctx.db.scalars(
        select(ReminderConsent)
        .where(ReminderConsent.guardian_id == guardian.id)
        .order_by(ReminderConsent.created_at.desc(), ReminderConsent.id.desc())
        .limit(1)
    ).first()
    is_recorded = (
        latest is not None and latest.action is action and latest.message_id == evidence.id
    )

    if not is_recorded:
        reminder_consent_service.record_consent(
            ctx.db,
            guardian_id=guardian.id,
            action=action,
            source=ConsentSource.MESSAGE,
            message_id=evidence.id,
            phone_number=ctx.conversation.phone_number,
        )

    return ToolResult(
        status="ok", content={"opt_in": action is ConsentAction.OPT_IN}, progress=not is_recorded
    )


def _hand_off_to_office(ctx: ToolContext, tool_input: Mapping[str, object]) -> ToolResult:
    """Flag the chat for the office (latest reason wins) and leave the summary as a Staff-only
    `handoff_note`, never sent to WhatsApp. A Reactivation request names one of the
    Guardian's archived Children and is refused while another is pending.

    A retry (the latest note already says this summary and its flag, or for a Reactivation
    request the same pending Child, still stands) writes nothing again.
    """
    reason = FlagReason(_text(tool_input, "reason"))

    if reason not in HANDOFF_REASONS:
        raise ValueError(f"{reason.value} is not a handoff reason")

    summary = _stripped(_text(tool_input, "summary"))
    child_id = _optional_text(tool_input, "child_id")
    is_reactivation = reason is FlagReason.REACTIVATION_REQUEST

    if summary is None:
        return _refused(SUMMARY_NEEDED)

    if len(summary) > SUMMARY_MAX_LENGTH:
        return _refused(SUMMARY_TOO_LONG, max_length=SUMMARY_MAX_LENGTH)

    if is_reactivation and child_id is None:
        return _refused(CHILD_NEEDED)

    child = None if child_id is None else _archived_child(ctx, child_id=child_id)

    if is_reactivation and child is None:
        return _refused(ARCHIVED_CHILD_NOT_FOUND)

    content: dict[str, object] = {"handed_off": reason.value}

    # A retry only while the earlier handoff still stands: once Staff handled or resolved it,
    # the same summary is a new request.
    is_retry = (
        _latest_handoff_summary(ctx) == summary
        and ctx.conversation.flag_reason is not None
        and (
            not is_reactivation
            or ctx.conversation.reactivation_child_id == (None if child is None else child.id)
        )
    )

    if is_retry:
        return ToolResult(status="ok", content=content)

    if is_reactivation and ctx.conversation.reactivation_child_id is not None:
        return _refused(REACTIVATION_ALREADY_PENDING)

    if child is not None and is_reactivation:
        conversation_service.request_reactivation(
            ctx.db, conversation=ctx.conversation, child_id=child.id
        )
    else:
        conversation_service.flag(ctx.db, conversation=ctx.conversation, reason=reason)

    message_service.record_handoff_note(ctx.db, conversation=ctx.conversation, body=summary)

    return ToolResult(status="ok", content=content, progress=True)


# --- shared ----------------------------------------------------------------------------------


def _guardian(ctx: ToolContext) -> Guardian | None:
    """The Guardian holding the chat's number, linking the chat to them; `None` before one
    exists."""
    guardian_id = conversation_service.link_to_holder(ctx.db, conversation=ctx.conversation)

    return None if guardian_id is None else ctx.db.get(Guardian, guardian_id)


def _guardian_content(guardian: Guardian) -> dict[str, object]:
    return {"guardian_id": str(guardian.id), "name": guardian.name}


def _active_homes(db: Session, *, guardian_id: uuid.UUID) -> list[Home]:
    return list(
        db.scalars(
            select(Home)
            .join(GuardianHome, GuardianHome.home_id == Home.id)
            .where(GuardianHome.guardian_id == guardian_id, Home.is_archived.is_(False))
            .order_by(Home.created_at, Home.id)
        ).all()
    )


def _home_content(home: Home) -> dict[str, object]:
    # No address or directions: the model already has them from the message, and the result
    # is not redacted from the log.
    return {
        "home_id": str(home.id),
        "label": home.label,
        "has_directions": home.directions is not None,
    }


def _linked_children(db: Session, *, guardian_id: uuid.UUID) -> list[Child]:
    """Every Child linked to the Guardian, archived ones included."""
    return list(
        db.scalars(
            select(Child)
            .join(ChildGuardian, ChildGuardian.child_id == Child.id)
            .where(ChildGuardian.guardian_id == guardian_id)
            .order_by(Child.name, Child.id)
        ).all()
    )


def _child_content(child: Child) -> dict[str, object]:
    # No notes or date of birth, for the reason `_home_content` gives.
    return {
        "child_id": str(child.id),
        "name": child.name,
        "school": child.school_name,
        "grade": child.grade_level,
        "has_notes": child.notes is not None,
        "has_date_of_birth": child.date_of_birth is not None,
    }


def _child_values(
    *, date_of_birth: datetime.date | None, raw_date_of_birth: str | None, notes: str | None
) -> tuple[SavedValue, ...]:
    """The saved date of birth, as the ISO date and as the tool received it, and the notes."""
    birth_texts = (
        ()
        if date_of_birth is None or raw_date_of_birth is None
        else dict.fromkeys((date_of_birth.isoformat(), raw_date_of_birth.strip()))
    )
    birth = tuple(
        SavedValue(field=RedactedField.CHILD_DATE_OF_BIRTH, text=text) for text in birth_texts
    )
    saved_notes = (
        () if notes is None else (SavedValue(field=RedactedField.CHILD_NOTES, text=notes),)
    )

    return (*birth, *saved_notes)


def _date(raw: str | None) -> datetime.date | None:
    """An ISO date, or `None` when absent or unreadable."""
    try:
        value = None if raw is None else datetime.date.fromisoformat(raw.strip())
    except ValueError:
        value = None

    return value


def _home_values(home: Home) -> tuple[SavedValue, ...]:
    directions = (
        ()
        if home.directions is None
        else (SavedValue(field=RedactedField.HOME_DIRECTIONS, text=home.directions),)
    )

    return (SavedValue(field=RedactedField.HOME_ADDRESS, text=home.address), *directions)


def _home_text_refusal(
    *, address: str | None, directions: str | None, label: str | None
) -> ToolResult | None:
    """Length limits the columns hold, checked before any write."""
    refusal = None

    if address is not None and len(address.strip()) > ADDRESS_MAX_LENGTH:
        refusal = _refused(ADDRESS_TOO_LONG, max_length=ADDRESS_MAX_LENGTH)
    elif directions is not None and len(directions.strip()) > DIRECTIONS_MAX_LENGTH:
        refusal = _refused(DIRECTIONS_TOO_LONG, max_length=DIRECTIONS_MAX_LENGTH)
    elif label is not None and len(label.strip()) > LABEL_MAX_LENGTH:
        refusal = _refused(LABEL_TOO_LONG, max_length=LABEL_MAX_LENGTH)

    return refusal


def _mark_redacted(
    ctx: ToolContext, *, saved: Sequence[SavedValue], since: datetime.datetime | None
) -> None:
    """Mark each saved field on the Guardian messages and bot replies since `since` (a record's
    last save), or, for a new record (`None`), those any history window can show, that hold
    its value. A value none of them holds was reworded, so the Guardian messages this turn
    answers are marked instead: the history then hides them whole."""
    if not saved:
        return

    statement = (
        select(Message)
        .where(
            Message.conversation_id == ctx.conversation.id,
            Message.author_kind.in_((MessageAuthor.CLIENT, MessageAuthor.BOT)),
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
    )

    if since is None:
        statement = statement.limit(HISTORY_WINDOW_MESSAGES)
    else:
        statement = statement.where(Message.created_at > since)

    candidates = ctx.db.scalars(statement).all()
    texts_by_field: dict[RedactedField, list[str]] = {}
    for value in saved:
        texts_by_field.setdefault(value.field, []).append(value.text)

    for field, texts in texts_by_field.items():
        holding = [
            message
            for message in candidates
            if any(bot_redaction.contains_value(message.body, text) for text in texts)
        ]
        for message in holding or _answered_guardian_messages(ctx):
            _add_field(message, field)

    ctx.db.flush()


def _answered_guardian_messages(ctx: ToolContext) -> list[Message]:
    """The Guardian messages since the last bot reply: the ones this turn answers."""
    last_reply_at = ctx.db.scalars(
        select(func.max(Message.created_at)).where(
            Message.conversation_id == ctx.conversation.id,
            Message.author_kind == MessageAuthor.BOT,
        )
    ).first()
    statement = select(Message).where(
        Message.conversation_id == ctx.conversation.id,
        Message.author_kind == MessageAuthor.CLIENT,
    )

    if last_reply_at is not None:
        statement = statement.where(Message.created_at > last_reply_at)

    return list(ctx.db.scalars(statement).all())


def _add_field(message: Message, field: RedactedField) -> None:
    stored = message.redacted_fields or []

    if field.value not in stored:
        message.redacted_fields = [*stored, field.value]


def _latest_inbound(ctx: ToolContext) -> Message:
    """The turn's latest Guardian message. A turn always has one, so none is a bug."""
    message = ctx.db.scalars(
        select(Message)
        .where(
            Message.conversation_id == ctx.conversation.id,
            Message.author_kind == MessageAuthor.CLIENT,
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
    ).first()

    if message is None:
        raise LookupError(f"conversation {ctx.conversation.id} has no Guardian message")

    return message


def _latest_handoff_summary(ctx: ToolContext) -> str | None:
    return ctx.db.scalars(
        select(Message.body)
        .where(
            Message.conversation_id == ctx.conversation.id,
            Message.system_kind == SystemMessageKind.HANDOFF_NOTE,
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
    ).first()


def _archived_child(ctx: ToolContext, *, child_id: str) -> Child | None:
    """`child_id` when it names one of the Guardian's archived Children."""
    guardian = _guardian(ctx)
    children = [] if guardian is None else _linked_children(ctx.db, guardian_id=guardian.id)

    return next(
        (child for child in children if str(child.id) == child_id and child.is_archived), None
    )


def _changes_saved(stored: object, given: object) -> bool:
    """Whether writing `given` would replace a saved value with a different one."""
    return stored is not None and given is not None and stored != given


def _stripped(text: str | None) -> str | None:
    """Trimmed, with blank as absent, as the services store optional text."""
    trimmed = "" if text is None else text.strip()

    return trimmed or None


def _comparable(text: str) -> str:
    return " ".join(text.casefold().split())


def _text(tool_input: Mapping[str, object], key: str) -> str:
    value = tool_input[key]

    if not isinstance(value, str):
        raise TypeError(f"{key} must be a string")

    return value


def _optional_text(tool_input: Mapping[str, object], key: str) -> str | None:
    value = tool_input.get(key)

    return None if value is None else _text(tool_input, key)


def _refused(reason: str, **detail: object) -> ToolResult:
    return ToolResult(status="refused", content={"reason": reason, **detail})


def _schema(
    properties: dict[str, dict[str, object]], *, optional: frozenset[str] = frozenset()
) -> dict[str, Any]:
    """Strict: nothing else allowed. An optional property is left out of `required`, never made
    nullable, because the API caps the union-typed parameters a request may carry."""
    return {
        "type": "object",
        "properties": properties,
        "required": [name for name in properties if name not in optional],
        "additionalProperties": False,
    }


def _logged(name: str, run: ToolRun) -> Callable[[ToolContext, dict[str, Any]], ToolResult]:
    def logged_run(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        context = {
            "tool": name,
            "conversation_id": str(ctx.conversation.id),
            "input": _loggable(tool_input),
        }
        logger.info("bot tool %s called", name, extra=context)

        try:
            result = run(ctx, tool_input)
        except Exception:
            logger.exception("bot tool %s raised", name, extra=context)
            raise

        level = logging.INFO if result.status == "ok" else logging.WARNING
        logger.log(
            level,
            "bot tool %s %s",
            name,
            result.status,
            extra={**context, "result": _loggable(result.content), "progress": result.progress},
        )

        return result

    return logged_run


# Values redacted from the model's history are not logged either, nor the handoff summary,
# which can carry them and is kept in the chat as the Staff-only note. Names, schools, labels
# and grades are personal too: the log keeps ids only.
_UNLOGGED_KEYS = frozenset(
    {
        "address",
        "directions",
        "date_of_birth",
        "notes",
        "summary",
        "name",
        "school",
        "label",
        "grade",
    }
)


def _loggable(values: Mapping[str, object]) -> dict[str, object]:
    return {
        key: ("[set]" if value is not None else None) if key in _UNLOGGED_KEYS else value
        for key, value in values.items()
    }


_STRING: dict[str, object] = {"type": "string"}

TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="create_guardian",
        description=(
            "Save the Guardian (the person writing) with their name, once they have given it."
            " Returns the existing Guardian if one is already saved for this chat."
        ),
        input_schema=_schema({"name": _STRING}),
        run=_logged("create_guardian", _create_guardian),
    ),
    ToolSpec(
        name="update_guardian",
        description=(
            "Correct the Guardian's name. Only while Intake is in progress; after it, a"
            " change goes to the office (`hand_off_to_office` with `question`)."
        ),
        input_schema=_schema({"name": _STRING}),
        run=_logged("update_guardian", _update_guardian),
    ),
    ToolSpec(
        name="create_home",
        description=(
            "Save a Home for the Guardian once you have its address. `directions` is how the"
            " tutor gets in (gate code, parking) if given. Omit `label` for the first"
            ' Home; a later Home needs a label (e.g. "Dad\'s"). The same address returns the'
            " saved Home."
        ),
        input_schema=_schema(
            {"address": _STRING, "directions": _STRING, "label": _STRING},
            optional=frozenset({"directions", "label"}),
        ),
        run=_logged("create_home", _create_home),
    ),
    ToolSpec(
        name="update_home",
        description=(
            "Fill a saved Home's empty `directions` or `label` (an omitted field is left alone)."
            " Changing a saved value is refused: that goes to the office."
        ),
        input_schema=_schema(
            {"home_id": _STRING, "directions": _STRING, "label": _STRING},
            optional=frozenset({"directions", "label"}),
        ),
        run=_logged("update_home", _update_home),
    ),
    ToolSpec(
        name="create_child",
        description=(
            "Save a Child of the Guardian once you have its name, school and Overall grade"
            " (0 for Kindergarten to 12). `notes` (allergies, learning needs) and"
            " `date_of_birth` (YYYY-MM-DD) only if the Guardian volunteered them. `home_id`"
            " may be omitted when the Guardian has one Home. The same name returns the saved"
            " Child; an archived Child's name is refused with its id (a Reactivation request)."
        ),
        input_schema=_schema(
            {
                "name": _STRING,
                "school": _STRING,
                "grade": {"type": "integer"},
                "notes": _STRING,
                "date_of_birth": _STRING,
                "home_id": _STRING,
            },
            optional=frozenset({"notes", "date_of_birth", "home_id"}),
        ),
        run=_logged("create_child", _create_child),
    ),
    ToolSpec(
        name="update_child",
        description=(
            "Fill a saved Child's empty `notes` or `date_of_birth` (YYYY-MM-DD; an omitted field is left"
            " alone). Changing a saved value is refused: that goes to the office."
        ),
        input_schema=_schema(
            {"child_id": _STRING, "notes": _STRING, "date_of_birth": _STRING},
            optional=frozenset({"notes", "date_of_birth"}),
        ),
        run=_logged("update_child", _update_child),
    ),
    ToolSpec(
        name="list_subjects",
        description="List the Subjects we tutor, with their English and Spanish names.",
        input_schema=_schema({}),
        run=_logged("list_subjects", _list_subjects),
    ),
    ToolSpec(
        name="set_reminder_preference",
        description=(
            "Turn the weekly Booking reminder on (`opt_in` true) or off (false), on the"
            " Guardian's clear answer in their latest message."
        ),
        input_schema=_schema({"opt_in": {"type": "boolean"}}),
        run=_logged("set_reminder_preference", _set_reminder_preference),
    ),
    ToolSpec(
        name="hand_off_to_office",
        description=(
            "Ask the office to help: `question` (a question you can't answer, or a change to"
            " saved details), `booking_request` (a first Session, or no tutor teaches or is"
            " free), `guardian_link_request` (a Child already registered by another parent),"
            " `reactivation_request` (bring back an archived Child: `child_id` names it) or"
            " `didnt_understand` (going in circles). `summary` gives the office the details;"
            " the Guardian never sees it. Omit `child_id` for every other reason."
        ),
        input_schema=_schema(
            {
                "reason": {
                    "type": "string",
                    "enum": [reason.value for reason in HANDOFF_REASONS],
                },
                "summary": _STRING,
                "child_id": _STRING,
            },
            optional=frozenset({"child_id"}),
        ),
        run=_logged("hand_off_to_office", _hand_off_to_office),
    ),
)
