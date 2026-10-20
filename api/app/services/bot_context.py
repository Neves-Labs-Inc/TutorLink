"""The per-turn content the bot agent reads after its cached prompt prefix: a snapshot of the
Guardian and the recent chat history (docs/specs/whatsapp-bot-agent.md §2 "Guardian snapshot", §5).

Both are plain text, rebuilt from saved records on every turn; nothing here writes.

- **Snapshot.** The saved truth the system prompt (`bot_prompt`) tells the agent to trust over
  the history, with the ids its tools take. It starts with the current date and time in the
  business zone, so the agent can work out "next Tuesday".
- **Transcript.** The last `WINDOW_SIZE` messages the Guardian could have seen, oldest first,
  one line each, stamped in business time. Staff-only lines (a number change note, a handoff
  note) are left out of the window. Notices are bracketed notes, a `--- N hours later ---` line
  marks a gap of more than `GAP`, and a message marked with `redacted_fields` shows only a
  placeholder (redaction is for the model only; the office reads the full text).

**One message, one line.** Every value that came from outside code (message bodies, names,
addresses, notes) is folded onto one line, its line breaks written as a literal `\\n`. The
prompt's Safety rules trust that only the history's own lines start with `Office (name):` or a
bracket, so a Guardian typing a newline and a fake office line must stay inside their own line.

The output depends only on the database and `now`, so the same inputs give the same text.
"""

import datetime
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.booking import Booking, upcoming_live_bookings
from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.child_assigned_tutor import ChildAssignedTutor
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    MessageAuthor,
    MessageStatus,
    RedactedField,
    SystemMessageKind,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.message import Message
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.services import clock, conversation_service
from app.services.guardian_state import guardian_states
from app.services.intake_progress import (
    MISSING_CHILD,
    MISSING_GUARDIAN_NAME,
    MISSING_HOME,
    IntakeProgress,
    intake_progress,
)

WINDOW_SIZE = 20
GAP = datetime.timedelta(hours=3)
# Matches `commit_proposal`'s expiry (spec §2 "Propose then commit").
PROPOSAL_TTL = datetime.timedelta(minutes=30)
HOURS_PER_DAY = 24
# Past this many hours a gap reads in days.
GAP_HOURS_LIMIT = 48
STAFF_ONLY_KINDS = (SystemMessageKind.NUMBER_CHANGE_NOTE, SystemMessageKind.HANDOFF_NOTE)
NO_MESSAGES = "(no messages yet)"
# What a line break inside one message is written as.
FOLDED_LINE_BREAK = "\\n"
# An admin whose name is still the email's local part is never named (#109).
UNNAMED_STAFF = "staff"

_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_SHORT = 3

_MISSING_LABELS = {
    MISSING_GUARDIAN_NAME: "Guardian name",
    MISSING_HOME: "a Home",
    MISSING_CHILD: "a Child",
}
_REMINDER_LABELS = {"opt_in": "on", "opt_out": "off", "never": "not set (off)"}
_REDACTED_PHRASES = {
    RedactedField.HOME_ADDRESS.value: "the Home address",
    RedactedField.HOME_DIRECTIONS.value: "the Home directions",
    RedactedField.CHILD_DATE_OF_BIRTH.value: "a Child's date of birth",
    RedactedField.CHILD_NOTES.value: "a Child's notes",
}
_REDACTION_VERBS = {
    MessageAuthor.CLIENT: "Guardian gave",
    MessageAuthor.BOT: "Bot repeated",
}


@dataclass(frozen=True)
class TurnContext:
    snapshot: str
    transcript: str


@dataclass(frozen=True, slots=True)
class _Reminder:
    child_names: tuple[str, ...]
    week_start: datetime.date


@dataclass(frozen=True, slots=True)
class _TaughtSubject:
    id: uuid.UUID
    name: str


@dataclass(frozen=True, slots=True)
class _ChildTutor:
    tutor_id: uuid.UUID
    name: str
    subjects: tuple[_TaughtSubject, ...]


def build_turn_context(
    db: Session, *, conversation: Conversation, now: datetime.datetime
) -> TurnContext:
    """The snapshot and transcript for one turn; `now` is the turn's aware instant."""
    zone = clock.business_zone()

    return TurnContext(
        snapshot=_snapshot(
            db, conversation=conversation, now=clock.to_business_wall_clock(now, zone)
        ),
        transcript=_transcript(db, conversation=conversation, zone=zone),
    )


# --- snapshot ---------------------------------------------------------------------------------


def _snapshot(db: Session, *, conversation: Conversation, now: datetime.datetime) -> str:
    """`now` is naive business wall-clock time."""
    guardian_id = conversation_service.owner_id(db, conversation=conversation)
    progress = intake_progress(db, conversation=conversation)
    lines = [f"Current date and time: {_long_date(now.date())}, {now:%H:%M}"]

    if guardian_id is None:
        lines += ["Guardian: not named yet", _intake_line(progress)]
    else:
        guardian = db.get_one(Guardian, guardian_id)
        reminders = guardian_states(db, [guardian_id])[guardian_id].reminders
        lines += [
            f"Guardian: {_one_line(guardian.name)} (guardian id {guardian_id})",
            _intake_line(progress),
            f"Weekly booking reminder: {_REMINDER_LABELS[reminders]}",
            *_children_lines(db, guardian_id=guardian_id),
            *_home_lines(db, guardian_id=guardian_id),
            *_session_lines(db, guardian_id=guardian_id, now=now),
            *_proposal_lines(db, conversation=conversation, now=now),
        ]

    return "\n".join(lines)


def _intake_line(progress: IntakeProgress) -> str:
    if not progress.in_progress:
        return "Intake: finished"

    missing = ", ".join(_MISSING_LABELS[item] for item in progress.missing)
    return f"Intake: in progress; missing: {missing}"


def _children_lines(db: Session, *, guardian_id: uuid.UUID) -> list[str]:
    """Every linked Child, archived ones marked, so the agent can spot a Reactivation request."""
    children = db.scalars(
        select(Child)
        .join(ChildGuardian, ChildGuardian.child_id == Child.id)
        .where(ChildGuardian.guardian_id == guardian_id)
        .order_by(Child.name, Child.id)
    ).all()

    if not children:
        return ["Children: none"]

    tutors = _tutors_by_child(db, child_ids=[child.id for child in children])
    lines = ["Children:"]
    for child in children:
        lines += _child_lines(child, tutors[child.id])
    return lines


def _child_lines(child: Child, tutors: Sequence[_ChildTutor]) -> list[str]:
    status = "Evaluated" if child.evaluated_at is not None else "not Evaluated"
    archived = "archived; " if child.is_archived else ""
    grade = "not given" if child.grade_level is None else _grade(child.grade_level)
    lines = [
        f"- {_one_line(child.name)} (child id {child.id}): {archived}{status}; "
        f"school: {_one_line(child.school_name)}; Overall grade: {grade}"
    ]

    # Whether saved, never the value (P7-F / A-55): no tool takes them, and they stay off the
    # third-party model like the history's redaction placeholders.
    date_of_birth = "saved" if child.date_of_birth is not None else "not given"
    notes = "saved" if child.notes else "none"
    lines.append(f"  Date of birth: {date_of_birth}; notes: {notes}")
    if tutors:
        lines.append("  Assigned Tutors:")
        lines += [f"  - {_tutor_line(tutor)}" for tutor in tutors]
    else:
        lines.append("  Assigned Tutors: none")
    return lines


def _tutor_line(tutor: _ChildTutor) -> str:
    subjects = ", ".join(
        f"{_one_line(subject.name)} (subject id {subject.id})" for subject in tutor.subjects
    )
    teaches = subjects or "no Subject for this Child yet"
    return f"{_one_line(tutor.name)} (tutor id {tutor.tutor_id}): teaches {teaches}"


def _grade(grade_level: int) -> str:
    return "Kindergarten" if grade_level == 0 else str(grade_level)


def _tutors_by_child(
    db: Session, *, child_ids: Sequence[uuid.UUID]
) -> defaultdict[uuid.UUID, list[_ChildTutor]]:
    """Each Child's Assigned Tutors by their Tutor profile id (the id `list_slots` and `propose`
    take), with the Subjects each teaches at or above the Child's Subject level, as `list_slots`
    qualifies them."""
    tutor_rows = db.execute(
        select(ChildAssignedTutor.child_id, Tutor.id, User.name)
        .join(User, User.id == ChildAssignedTutor.user_id)
        .join(Tutor, Tutor.user_id == User.id)
        .where(ChildAssignedTutor.child_id.in_(child_ids))
        .order_by(User.name, Tutor.id)
    ).all()
    subject_rows = db.execute(
        select(ChildSubjectLevel.child_id, TutorSubject.tutor_id, Subject.id, Subject.name)
        .join(TutorSubject, TutorSubject.subject_id == ChildSubjectLevel.subject_id)
        .join(Subject, Subject.id == ChildSubjectLevel.subject_id)
        .where(
            ChildSubjectLevel.child_id.in_(child_ids),
            TutorSubject.max_grade_level >= ChildSubjectLevel.level,
            Subject.is_archived.is_(False),
        )
        .order_by(Subject.name, Subject.id)
    ).all()
    taught: defaultdict[tuple[uuid.UUID, uuid.UUID], list[_TaughtSubject]] = defaultdict(list)
    for child_id, tutor_id, subject_id, subject_name in subject_rows:
        taught[(child_id, tutor_id)].append(_TaughtSubject(id=subject_id, name=subject_name))

    tutors: defaultdict[uuid.UUID, list[_ChildTutor]] = defaultdict(list)
    for child_id, tutor_id, name in tutor_rows:
        tutors[child_id].append(
            _ChildTutor(tutor_id=tutor_id, name=name, subjects=tuple(taught[(child_id, tutor_id)]))
        )
    return tutors


def _home_lines(db: Session, *, guardian_id: uuid.UUID) -> list[str]:
    """The Guardian's active Homes, the ones a Session can be booked at."""
    homes = db.scalars(
        select(Home)
        .join(GuardianHome, GuardianHome.home_id == Home.id)
        .where(GuardianHome.guardian_id == guardian_id, Home.is_archived.is_(False))
        .order_by(Home.created_at, Home.id)
    ).all()

    if not homes:
        return ["Homes: none"]

    lines = ["Homes:"]
    for home in homes:
        label = "no label" if home.label is None else _one_line(home.label)
        # Saved or not, never the value (P7-F / A-55): door codes and addresses stay off the model.
        directions = "saved" if home.directions else "none"
        lines.append(f"- {label} (home id {home.id}): address saved; directions: {directions}")
    return lines


def _session_lines(db: Session, *, guardian_id: uuid.UUID, now: datetime.datetime) -> list[str]:
    """Live Tutoring Sessions still to start, for every Child linked to the Guardian.

    Evaluations are the Office's to cancel or move, so they are left out.
    """
    bookings = db.scalars(
        select(Booking)
        .join(ChildGuardian, ChildGuardian.child_id == Booking.child_id)
        .where(
            ChildGuardian.guardian_id == guardian_id,
            Booking.kind == BookingKind.REGULAR,
            upcoming_live_bookings(now),
        )
        .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
    ).all()

    if not bookings:
        return ["Upcoming sessions: none"]

    return ["Upcoming sessions:", *(f"- {_session_label(booking)}" for booking in bookings)]


def _session_label(booking: Booking) -> str:
    subject = "no Subject" if booking.subject is None else _one_line(booking.subject.name)
    when = (
        f"{_short_date(booking.scheduled_date)} {booking.start_time:%H:%M}-{booking.end_time:%H:%M}"
    )
    return (
        f"{when}: {subject}, {_one_line(booking.child.name)}, {_one_line(booking.staff.name)}, "
        f"{_place(booking.location.value, booking.home)} (booking id {booking.id})"
    )


def _place(location: str, home: Home | None) -> str:
    if location != BookingLocation.HOME.value:
        return "at the office"
    # The label only, never the address: a shared Child's Session can be at a co-Guardian's
    # Home (as `bot_messages.format_location`).
    if home is None or not home.label:
        return "at home"

    return f"at home ({_one_line(home.label)})"


# --- the pending proposal ---------------------------------------------------------------------


def _proposal_lines(
    db: Session, *, conversation: Conversation, now: datetime.datetime
) -> list[str]:
    """What a "yes" from the Guardian would commit, resolved to names. `now` is naive business
    wall-clock time; past `PROPOSAL_TTL` the proposal reads as expired, as commit will judge it."""
    actions = conversation.proposal_actions
    proposed_at = conversation.proposed_at

    if not actions or proposed_at is None:
        return ["Pending proposal: none"]

    made = clock.to_business_wall_clock(proposed_at, clock.business_zone())
    state = (
        "expired, a yes no longer books it; propose again"
        if now - made > PROPOSAL_TTL
        else "waiting for the Guardian's yes"
    )
    return [
        f"Pending proposal (made {_stamp(made)}), {state}:",
        *(f"- {_action_line(db, action)}" for action in actions),
    ]


def _action_line(db: Session, action: dict[str, object]) -> str:
    kind = _field(action, "kind") or "unknown action"

    if kind == "book":
        child = _row(db, Child, _field(action, "child_id"))
        subject = _row(db, Subject, _field(action, "subject_id"))
        child_name = "an unknown Child" if child is None else _one_line(child.name)
        subject_name = "an unknown Subject" if subject is None else _one_line(subject.name)
        line = f"book {child_name}, {subject_name}, {_slot(db, action)}"
    elif kind == "cancel":
        line = f"cancel {_proposed_session(db, action)}"
    elif kind == "reschedule":
        line = f"reschedule {_proposed_session(db, action)} to {_slot(db, action)}"
    else:
        line = _one_line(kind)
    return line


def _proposed_session(db: Session, action: dict[str, object]) -> str:
    booking = _row(db, Booking, _field(action, "booking_id"))
    return "an unknown session" if booking is None else _session_label(booking)


def _slot(db: Session, action: dict[str, object]) -> str:
    """The time, Tutor and place a book or reschedule action names."""
    tutor = _row(db, Tutor, _field(action, "tutor_id"))
    home = _row(db, Home, _field(action, "home_id"))
    tutor_name = "an unknown Tutor" if tutor is None else _one_line(tutor.user.name)
    location = _field(action, "location") or BookingLocation.HOME.value
    return (
        f"{_action_date(_field(action, 'date'))} {_action_time(_field(action, 'start_time'))} "
        f"with {tutor_name}, {_place(location, home)}"
    )


def _field(action: dict[str, object], key: str) -> str | None:
    value = action.get(key)
    return value if isinstance(value, str) else None


def _row[T](db: Session, model: type[T], raw_id: str | None) -> T | None:
    """The row `raw_id` names, or `None` when it is missing or not a UUID."""
    if raw_id is None:
        return None

    try:
        row_id = uuid.UUID(raw_id)
    except ValueError:
        return None
    return db.get(model, row_id)


def _action_date(raw: str | None) -> str:
    try:
        text = _short_date(datetime.date.fromisoformat(raw or ""))
    except ValueError:
        text = _one_line(raw or "an unknown date")
    return text


def _action_time(raw: str | None) -> str:
    try:
        text = f"{datetime.time.fromisoformat(raw or ''):%H:%M}"
    except ValueError:
        text = _one_line(raw or "an unknown time")
    return text


# --- transcript -------------------------------------------------------------------------------


def _transcript(db: Session, *, conversation: Conversation, zone: ZoneInfo) -> str:
    rows = db.execute(
        select(Message, User)
        .outerjoin(User, User.id == Message.author_user_id)
        .where(
            Message.conversation_id == conversation.id,
            or_(Message.system_kind.is_(None), Message.system_kind.not_in(STAFF_ONLY_KINDS)),
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(WINDOW_SIZE)
    ).all()
    window = [(message, author) for message, author in reversed(rows)]
    reminders = _reminders_by_sid(db, [message for message, _author in window])

    lines: list[str] = []
    previous: datetime.datetime | None = None
    for message, author in window:
        if previous is not None and message.created_at - previous > GAP:
            lines.append(_gap_line(message.created_at - previous))
        stamp = _stamp(clock.to_business_wall_clock(message.created_at, zone))
        lines.append(f"[{stamp}] {_message_text(message, author, reminders)}")
        previous = message.created_at

    return "\n".join(lines) or NO_MESSAGES


def _gap_line(gap: datetime.timedelta) -> str:
    hours = int(gap.total_seconds() // 3600)
    amount = f"{hours} hours" if hours < GAP_HOURS_LIMIT else f"{hours // HOURS_PER_DAY} days"
    return f"--- {amount} later ---"


def _message_text(message: Message, author: User | None, reminders: dict[str, _Reminder]) -> str:
    redacted = message.redacted_fields or []

    if message.author_kind is MessageAuthor.SYSTEM:
        text = _notice(message, author, reminders)
    elif redacted:
        text = _placeholder(message.author_kind, author, redacted)
    else:
        text = f"{_speaker(message.author_kind, author)}: {_one_line(message.body)}"

    if message.status is MessageStatus.FAILED:
        text += " [not delivered]"
    return text


def _speaker(author_kind: MessageAuthor, author: User | None) -> str:
    if author_kind is MessageAuthor.CLIENT:
        return "Guardian"
    if author_kind is MessageAuthor.BOT:
        return "Bot"

    return f"Office ({_staff_name(author)})"


def _staff_name(author: User | None) -> str:
    if author is None or author.name_is_default:
        return UNNAMED_STAFF

    return _one_line(author.name)


def _placeholder(author_kind: MessageAuthor, author: User | None, redacted: list[str]) -> str:
    """`[Guardian gave the Home address: saved]`: one phrase per saved field, in a fixed order."""
    verb = _REDACTION_VERBS.get(author_kind) or f"{_speaker(author_kind, author)} repeated"
    phrases = [phrase for field, phrase in _REDACTED_PHRASES.items() if field in redacted]
    return f"[{verb} {_join(phrases)}: saved]"


def _join(phrases: Sequence[str]) -> str:
    if len(phrases) <= 1:
        return "".join(phrases)

    return f"{', '.join(phrases[:-1])} and {phrases[-1]}"


def _notice(message: Message, author: User | None, reminders: dict[str, _Reminder]) -> str:
    kind = message.system_kind

    if kind is SystemMessageKind.TAKEOVER_NOTICE:
        text = f"[Takeover: {_holder(author)} joined the chat; the bot is silent]"
    elif kind is SystemMessageKind.TRANSFER_NOTICE:
        text = f"[Transfer: {_holder(author)} took over the chat; the bot is silent]"
    elif kind is SystemMessageKind.HANDBACK_NOTICE:
        text = "[Hand-back: the chat is back with the bot]"
    elif kind is SystemMessageKind.BOOKING_REMINDER:
        reminder = None if message.twilio_sid is None else reminders.get(message.twilio_sid)
        text = _reminder_note(reminder)
    elif kind is SystemMessageKind.CONSENT_NOTICE:
        text = f"[Reminder preference notice sent: {_one_line(message.body)}]"
    else:
        text = f"[Notice sent: {_one_line(message.body)}]"
    return text


def _holder(author: User | None) -> str:
    if author is None or author.name_is_default:
        return "someone from the office"

    return f"{_one_line(author.name)} from the office"


def _reminder_note(reminder: _Reminder | None) -> str:
    if reminder is None:
        return "[Booking reminder sent]"

    week = reminder.week_start
    names = "".join(f"{name}, " for name in reminder.child_names)
    return f"[Booking reminder sent: {names}week of {_MONTHS[week.month - 1]} {week.day}]"


def _reminders_by_sid(db: Session, messages: Sequence[Message]) -> dict[str, _Reminder]:
    """The reminder each `booking_reminder` line sent, matched on its SID, with the Children it
    named in the reminder's order. Two queries for the whole window."""
    sids = [
        message.twilio_sid
        for message in messages
        if message.system_kind is SystemMessageKind.BOOKING_REMINDER and message.twilio_sid
    ]

    if not sids:
        return {}

    reminders = db.scalars(
        select(BookingReminder).where(BookingReminder.twilio_sid.in_(sids))
    ).all()
    child_ids = {child_id for reminder in reminders for child_id in reminder.child_ids}
    names: dict[uuid.UUID, str] = dict(
        db.execute(select(Child.id, Child.name).where(Child.id.in_(child_ids))).tuples().all()
    )
    return {
        reminder.twilio_sid: _Reminder(
            child_names=tuple(
                _one_line(names[child_id]) for child_id in reminder.child_ids if child_id in names
            ),
            week_start=reminder.week_start,
        )
        for reminder in reminders
        if reminder.twilio_sid is not None
    }


# --- formatting -------------------------------------------------------------------------------


def _one_line(text: str) -> str:
    """`text` on one line: its line breaks (any Unicode kind) written as a literal `\\n`."""
    return FOLDED_LINE_BREAK.join(text.strip().splitlines())


def _long_date(date: datetime.date) -> str:
    return f"{_WEEKDAYS[date.weekday()]}, {_MONTHS[date.month - 1]} {date.day}, {date.year}"


def _short_date(date: datetime.date) -> str:
    weekday = _WEEKDAYS[date.weekday()][:_SHORT]
    month = _MONTHS[date.month - 1][:_SHORT]
    return f"{weekday} {month} {date.day}"


def _stamp(wall_clock: datetime.datetime) -> str:
    return f"{_short_date(wall_clock.date())} {wall_clock:%H:%M}"
