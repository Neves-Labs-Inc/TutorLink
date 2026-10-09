"""Booking creation and in-place editing: the rules by kind and Staff role, the warning
contract, and the conflict guarantee behind them.

Same transaction contract as every other service here — nothing in this module commits, the
router owns the boundary. `db.flush()` inside the savepoint is what makes the constraints speak
before the request ends.

**`create_booking` and `replace_booking` run one pipeline, `_validate`.** The dashboard
Reschedule edits a booking in place (same id, kind and status) and every create rule is re-run
against the new values, so the two differ only in what `_Context` carries: on an edit the row
itself is left out of its own neighbours (`exclude_booking_id`) — it does not overlap, crowd or
duplicate itself — and rule 8 is skipped, because the Evaluation being edited already exists and
Franklin allows editing it after the Child was marked (answers.md, planner 3). **Correction
mode**: when the row's current start is already past, the window and lead-time gates are
skipped (`skip_window`), so the Office can fix a session that has already happened; a booking
still in the future is held to them as hard blocks like a create.

**The rules are `_HARD_RULES` and `_WARNING_RULES`, two ordered tables keyed by `BookingKind`,
and that is the enumeration `docs/api-design.md` ("`POST /api/bookings`") asks for by name.**
Each function carries its number, its status class and its issue number; a rule added anywhere
else is a rule the next reader will not find. Which rules run is decided by the kind and the
Staff member's role (`users.role` at write time, #130):

| | Evaluation | Regular, Admin | Regular, Tutor/Manager |
|---|---|---|---|
| hard | 2, 6, 7, 8, 9 | 2, 6, 7 | 2, 6, 7 |
| warnings (#151) | — | — | 1, 3, 4, 5 |

Rules 1, 3, 4 and 5 read the Staff member's teaching profile, which only a Tutor or a Manager
has; an Admin is checked for overlap and the Location alone. Rule 6 is a no-op In office.

**Hard blocks run first, then the warnings, and the warnings are collected rather than stopped
at.** The dashboard's contract (#151) is: every failing warning comes back at once as a 409 with
`warnings[]`, the client resubmits naming the codes it confirms, and the write lands only if
every warning raised on *that* submission is confirmed. `confirm_warnings=None` is the other
caller — the bot — which cannot confirm anything: for it each warning is still its rule's own
refusal, the first failing one, exactly as before the contract existed, so `bot_service`'s
`except` clauses keep working untouched.

**The status codes are deliberately not uniform**: a missing or retired reference (an inactive
user included) is 400, as is rule 1's hard half; overlap, a live Evaluation and unconfirmed
warnings are 409; a refused *combination* of valid rows — a role against a kind, a Subject or
slot against a kind, a home against a Location, rules 5 to 8 — is 422. `CONSTITUTION.md` §10
reserves 422 for "a deliberate semantic refusal of a well-formed request" and
`docs/api-design.md` assigns exactly that to these; they are not to be "corrected" to 400 by a
reader who has met §10's first clause without its parenthetical.

**`scheduling_service` is imported as a module, not by name.** Its `DateOutOfWindow` and
`LeadTimeNotMet` are the window arithmetic's own failures; this module re-raises them as its
own so a router catches one family of exceptions, and the two names would otherwise collide.
Every overlap and gap comparison also comes from there rather than being re-derived here,
because `GET /api/slots/available` subtracts by the same functions — a slot the bot was just
offered being refused on arrival is #44 item 1, and shared predicates are what makes that
structural instead of a thing two modules have to remember.

This module never imports `generate_grid`: the endpoint deliberately does not require the range
to land on a grid slot (REQ-044.23), so the Office may book the leftover a rigid grid strands.
"""

import datetime
import enum
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import ColumnElement, select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ExceptionStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.services import scheduling_service

# PostgreSQL SQLSTATEs (Appendix A). The constraints are matched by exception type, call site
# and class of violation — never by their rendered names, which a migrated database and a
# `create_all` one do not agree on.
EXCLUSION_VIOLATION_SQLSTATE = "23P01"
UNIQUE_VIOLATION_SQLSTATE = "23505"

# Who may be booked as Staff at all (#130): a Developer is refused like an unknown id.
BOOKABLE_ROLES = frozenset({UserRole.ADMIN, UserRole.MANAGER, UserRole.TUTOR})
EVALUATION_ROLES = frozenset({UserRole.ADMIN, UserRole.MANAGER})
TEACHING_ROLES = frozenset({UserRole.TUTOR, UserRole.MANAGER})


class WarningCode(str, enum.Enum):
    """The confirmable checks (#151), in the order they are reported."""

    OUTSIDE_SLOT = "outside_slot"
    GAP = "gap"
    TIME_OFF = "time_off"
    GRADE_CEILING = "grade_ceiling"


@dataclass(frozen=True, slots=True)
class BookingRequest:
    child_id: uuid.UUID
    # The Staff member, as a user (#130).
    user_id: uuid.UUID
    kind: BookingKind
    location: BookingLocation
    subject_id: uuid.UUID | None
    availability_id: uuid.UUID | None
    home_id: uuid.UUID | None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    booked_by_guardian_id: uuid.UUID | None
    notes: str | None


class KeepNotes(enum.Enum):
    """The `notes` value of a replacement that leaves the row's notes as they are."""

    KEEP = "keep"


KEEP_NOTES = KeepNotes.KEEP


@dataclass(frozen=True, slots=True)
class BookingReplacement:
    """The editable fields of `PUT /api/bookings/{id}`: everything a `BookingRequest` names
    except the Child, the kind and the booking guardian, which an edit keeps.

    `kind` is here only to be checked: a body naming a kind other than the row's is refused.
    `notes` is `KEEP_NOTES` when the body did not name them; `None` clears them.
    """

    user_id: uuid.UUID
    location: BookingLocation
    subject_id: uuid.UUID | None
    availability_id: uuid.UUID | None
    home_id: uuid.UUID | None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    kind: BookingKind | None
    notes: str | None | KeepNotes = KEEP_NOTES


class BookingWriteError(Exception):
    """Base class for every failure this module reports."""


class BookingNotFound(BookingWriteError):
    """No `bookings` row for the id being edited — 404."""


class BookingNotLive(BookingWriteError):
    """The row being edited is Completed or Cancelled — 409. Only a live booking is edited in
    place; a finished one is history."""


class BookingKindImmutable(BookingWriteError):
    """The body names a kind other than the row's — 422. A booking never changes kind."""


class BookingReferenceNotFound(BookingWriteError):
    """One of the ids in the request names no row, or one an admin has retired
    (REQ-044.24) — 400. See `_resolve` for why a soft-deleted row is this and not a 422."""


class StaffRoleNotAllowed(BookingWriteError):
    """The Staff member's role does not take this kind of booking (#130) — 422."""


class BookingShapeInvalid(BookingWriteError):
    """A Subject, slot or home present or absent against the kind, the role or the Location
    (#130) — 422."""


class OutsideAvailability(BookingWriteError):
    """Rule 1 — 400 for a range that is not the Staff member's; otherwise the `outside_slot`
    warning."""


class BookingOverlaps(BookingWriteError):
    """Rule 2 — 409."""


class GapNotRespected(BookingWriteError):
    """Rule 3 — 409, or the `gap` warning."""


class BlockedByException(BookingWriteError):
    """Rule 4 — 409, or the `time_off` warning."""


class TutorGradeCeilingExceeded(BookingWriteError):
    """Rule 5 — 422, or the `grade_ceiling` warning."""


class HomeNotLinkedToChild(BookingWriteError):
    """Rule 6 — 422."""


class GuardianNotLinkedToChild(BookingWriteError):
    """Rule 7 — 422."""


class ChildAlreadyEvaluated(BookingWriteError):
    """Rule 8 (#133) — 422."""


class LiveEvaluationExists(BookingWriteError):
    """Rule 9 (#133) — 409."""


class UnconfirmedWarnings(BookingWriteError):
    """One or more warnings the caller did not confirm (#151) — 409 with `warnings[]`.

    `codes` is every warning raised on this submission that `confirm_warnings` did not name,
    in rule order: the client confirms exactly these and resubmits.
    """

    def __init__(self, codes: tuple[WarningCode, ...]) -> None:
        super().__init__(", ".join(code.value for code in codes))
        self.codes = codes


class DateOutOfWindow(BookingWriteError):
    """REQ-044.22 — 400."""


class LeadTimeNotMet(BookingWriteError):
    """REQ-044.22 — 400."""


@dataclass(frozen=True, slots=True)
class _Teaching:
    """What rules 1, 4 and 5 read: the Staff member's teaching profile, the range the caller
    named and the Subject. Present exactly for a Tutor/Manager Regular booking, by the shape
    checks."""

    tutor_id: uuid.UUID
    availability: TutorAvailability
    subject_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class _Context:
    request: BookingRequest
    child: Child
    gap_minutes: int
    teaching: _Teaching | None
    # The booking being edited, left out of every read that would otherwise find it; `None`
    # on a create.
    exclude_booking_id: uuid.UUID | None


type _Rule = Callable[[Session, _Context], None]
type _WarningRule = Callable[[Session, _Context, _Teaching], None]


def create_booking(
    db: Session,
    *,
    request: BookingRequest,
    now: datetime.datetime,
    confirm_warnings: frozenset[WarningCode] | None = None,
) -> Booking:
    """A `confirmed` booking, or the first hard block, or the warnings left unconfirmed.

    `now` is a parameter rather than a clock read here, for the reason `scheduling_service`
    takes one: the window gates are then testable without freezing time.

    `confirm_warnings` is the dashboard's half of the warning contract (#151): the codes the
    Office has confirmed on this submission, an empty set on its first try. `None` means the
    caller does not speak the contract — the bot — and gets each warning as its rule's own
    exception instead, so a gap it cannot confirm is still `GapNotRespected`.

    The order of the checks is `_validate`'s.
    """
    _validate(
        db,
        request=request,
        now=now,
        confirm_warnings=confirm_warnings,
        exclude_booking_id=None,
        skip_window=False,
    )

    booking = Booking(
        child_id=request.child_id,
        user_id=request.user_id,
        kind=request.kind,
        location=request.location,
        subject_id=request.subject_id,
        availability_id=request.availability_id,
        home_id=request.home_id,
        booked_by_guardian_id=request.booked_by_guardian_id,
        scheduled_date=request.scheduled_date,
        start_time=request.start_time,
        end_time=request.end_time,
        status=BookingStatus.CONFIRMED,
        notes=request.notes,
    )

    # REQ-045, second layer. `excl_bookings_live_overlap` is the guarantee; rule 2 above is only
    # the readable 409, and a read-then-write check alone races. Likewise
    # `uq_bookings_one_live_evaluation_per_child` holds when two Evaluation creates race on a
    # Child rule 9 read only `FOR SHARE` (#133). The savepoint wraps the insert and the flush and
    # nothing else, so no unrelated failure is mislabelled a conflict and the `Session` survives
    # the rollback — `client_service.py:159-165` records what assigning anything above
    # `begin_nested` does instead, since `_take_snapshot` flushes first and the failing statement
    # then runs outside the savepoint. The two constraints are told apart by SQLSTATE — the
    # class of violation, not a name.
    #
    # **REQ-045.6, the documented limit of that guarantee.** The constraint compares `tsrange`s
    # with `&&`, so it enforces rule 2 and *not* rule 3: `session_gap_minutes` is runtime
    # editable and cannot be baked into an index expression. Two gap-adjacent bookings submitted
    # concurrently can therefore both land, each having passed a rule-3 check that could not see
    # the other. That is accepted and unclosable at this layer, not a defect awaiting a fix.
    try:
        with db.begin_nested():
            db.add(booking)
            db.flush()
    except IntegrityError as exc:
        raise _conflict_of(exc) from exc

    return booking


def replace_booking(
    db: Session,
    *,
    booking_id: uuid.UUID,
    replacement: BookingReplacement,
    now: datetime.datetime,
    confirm_warnings: frozenset[WarningCode],
) -> Booking:
    """The booking edited in place — same id, kind and status — or the first hard block, or
    the warnings left unconfirmed. Always bumps `updated_at`, even when nothing else changed:
    the dashboard reads it back as the version it last saw.

    **Locking.** `_resolve` documents the lock order conversation → child → home → bookings
    and forbids locking a booking ahead of the child and home reads, so the row is first read
    unlocked for the fields an edit keeps, and locked `FOR UPDATE` only once `_validate` has
    taken the child and the home. `child_id` and `kind` cannot change under that unlocked read
    (nothing edits them), but `status` can — a status transition that commits in between is seen
    when the lock lands, and the edit is refused rather than reviving a booking just cancelled.
    The lock then holds for the rules, the write and the flush, so two edits of one booking
    serialise instead of both passing the rules against the same neighbours.
    """
    row = db.get(Booking, booking_id)

    if row is None:
        raise BookingNotFound
    if replacement.kind is not None and replacement.kind is not row.kind:
        raise BookingKindImmutable
    _check_live(row)

    request = _request_of(row, replacement)
    # Correction mode: a session that has already started is being corrected, not booked, and
    # the window gates would refuse every correction of a past session.
    starts_at = datetime.datetime.combine(row.scheduled_date, row.start_time)
    is_past = starts_at <= now

    _validate(
        db,
        request=request,
        now=now,
        confirm_warnings=confirm_warnings,
        exclude_booking_id=row.id,
        skip_window=is_past,
        before_rules=lambda: _check_live(_lock(db, row)),
    )

    # The same second layer as the create (see there): the EXCLUDE and the partial unique
    # index hold against what the rules could not see, inside a savepoint so the `Session`
    # survives the rollback. The assignments are *inside* `begin_nested` for the reason the
    # create's comment gives: `_take_snapshot` flushes dirty state before emitting SAVEPOINT,
    # so a row dirtied above the `with` would be UPDATEd in the outer transaction and a
    # constraint failure there poisons the `Session`.
    try:
        with db.begin_nested():
            row.user_id = request.user_id
            row.location = request.location
            row.subject_id = request.subject_id
            row.availability_id = request.availability_id
            row.home_id = request.home_id
            row.scheduled_date = request.scheduled_date
            row.start_time = request.start_time
            row.end_time = request.end_time
            row.notes = request.notes
            # Set here rather than left to the column's `onupdate`: that fires only when some
            # column changed, and an edit restating the current values must still bump it.
            row.updated_at = datetime.datetime.now(tz=datetime.UTC)
            db.flush()
    except IntegrityError as exc:
        raise _conflict_of(exc) from exc

    return row


def _validate(
    db: Session,
    *,
    request: BookingRequest,
    now: datetime.datetime,
    confirm_warnings: frozenset[WarningCode] | None,
    exclude_booking_id: uuid.UUID | None,
    skip_window: bool,
    before_rules: Callable[[], None] = lambda: None,
) -> None:
    """The one rule pipeline, for a create and for an edit.

    The shape is checked before any read, so a Subject on an Evaluation is refused for what it
    is rather than for an id it never needed. References resolve next, so a mistyped id — or
    one naming a row an admin has retired — is always REQ-044.24's 400 rather than a confusing
    rule failure about a row the caller never named. The window gates run ahead of the rules,
    because a date in the past is refused whatever the Staff member's schedule says.

    `before_rules` runs once the references are resolved — and so once the child and the home
    are share-locked — and before any rule reads a booking: it is where an edit takes its own
    row's lock without breaking `_resolve`'s lock order.
    """
    _check_shape(request)
    settings = scheduling_service.load_scheduling_settings(db)
    staff = _resolve_staff(db, request=request)
    _check_role(request, role=staff.role)
    context = _resolve(
        db,
        request=request,
        gap_minutes=settings.session_gap_minutes,
        exclude_booking_id=exclude_booking_id,
    )
    before_rules()

    if not skip_window:
        _assert_within_window(request, now=now, settings=settings)

    for rule in _HARD_RULES[request.kind]:
        rule(db, context)

    _run_warning_rules(db, context, confirm_warnings=confirm_warnings)


def _lock(db: Session, row: Booking) -> Booking:
    """The row `FOR UPDATE`, re-read so a status changed by a concurrent transaction is seen
    (`populate_existing`, as `_resolve` does for the child)."""
    return db.execute(
        select(Booking)
        .where(Booking.id == row.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def _check_live(row: Booking) -> None:
    if row.status.value not in LIVE_BOOKING_STATUSES:
        raise BookingNotLive


def _request_of(row: Booking, replacement: BookingReplacement) -> BookingRequest:
    """The full request the rules judge: the row's immutable fields with the edit's values."""
    return BookingRequest(
        child_id=row.child_id,
        user_id=replacement.user_id,
        kind=row.kind,
        location=replacement.location,
        subject_id=replacement.subject_id,
        availability_id=replacement.availability_id,
        home_id=replacement.home_id,
        scheduled_date=replacement.scheduled_date,
        start_time=replacement.start_time,
        end_time=replacement.end_time,
        # Not editable here and so not re-judged: the row keeps its guardian untouched. Passing
        # it through would make a Guardian deactivated since the booking block every edit of it
        # with a 400 naming an id the body cannot carry.
        booked_by_guardian_id=None,
        notes=row.notes if replacement.notes is KEEP_NOTES else replacement.notes,
    )


def _conflict_of(exc: IntegrityError) -> BookingWriteError:
    sqlstate = getattr(exc.orig, "sqlstate", None)

    if sqlstate == UNIQUE_VIOLATION_SQLSTATE:
        conflict: BookingWriteError = LiveEvaluationExists()
    elif sqlstate == EXCLUSION_VIOLATION_SQLSTATE:
        conflict = BookingOverlaps()
    else:
        raise exc

    return conflict


# --- the rules ------------------------------------------------------------------------------


def _rule_1_inside_named_availability(db: Session, context: _Context, teaching: _Teaching) -> None:
    """Rule 1 — the `outside_slot` warning. The `availability_id` the caller named, not any
    range that happens to fit.

    The hard half — the range exists, is active and is this Staff member's — is `_resolve`'s
    400: accepting `availability_id` as an unchecked column would let a caller point at
    another Staff member's slot (OQ-4). What is left here is the time falling outside the
    range, which the Office may confirm (#151).
    """
    availability = teaching.availability
    request = context.request

    # `weekday()` is 0 = Monday … 6 = Sunday, which is `tutor_availability.day_of_week`'s
    # encoding. `isoweekday()` and PostgreSQL's `EXTRACT(DOW)` both number differently and both
    # silently shift every booking by a day.
    if (
        availability.day_of_week != request.scheduled_date.weekday()
        or request.start_time < availability.start_time
        or request.end_time > availability.end_time
    ):
        raise OutsideAvailability


def _rule_2_no_live_overlap(db: Session, context: _Context) -> None:
    """Rule 2 — 409, and the readable half of REQ-045. Every kind, every role."""
    request = context.request

    if _overlapping_booking(
        db,
        user_id=request.user_id,
        scheduled_date=request.scheduled_date,
        start_time=request.start_time,
        end_time=request.end_time,
        exclude_booking_id=context.exclude_booking_id,
    ):
        raise BookingOverlaps


def _rule_3_gap_respected(db: Session, context: _Context, teaching: _Teaching) -> None:
    """Rule 3 — the `gap` warning. Both inequalities strict, so clearance of exactly one gap is
    accepted. Two In office bookings need no gap at all (#132)."""
    request = context.request

    if _gap_encroached(
        db,
        user_id=request.user_id,
        location=request.location,
        scheduled_date=request.scheduled_date,
        start_time=request.start_time,
        end_time=request.end_time,
        gap_minutes=context.gap_minutes,
        exclude_booking_id=context.exclude_booking_id,
    ):
        raise GapNotRespected


def _rule_4_not_blocked_by_exception(db: Session, context: _Context, teaching: _Teaching) -> None:
    """Rule 4 — the `time_off` warning (#24). Only `approved` blocks; `pending` and `rejected`
    never do.

    Bare overlap, not gap-expanded: step 2 of `GET /api/slots/available` subtracts exceptions
    the same way, and the asymmetry with rule 3 is deliberate.
    """
    request = context.request

    for row in _approved_exceptions(db, tutor_id=teaching.tutor_id, on=request.scheduled_date):
        if _exception_blocks(row, start_time=request.start_time, end_time=request.end_time):
            raise BlockedByException


def _rule_5_grade_ceiling_respected(db: Session, context: _Context, teaching: _Teaching) -> None:
    """Rule 5 — the `grade_ceiling` warning (#36). A **missing** `tutor_subjects` row is a
    refusal, not a pass.

    Written as a join, `... JOIN tutor_subjects ... WHERE max_grade_level >= level` drops the
    row when the Staff member holds no assignment for the subject, and "no row" then reads as
    "nothing to refuse" — turning the strongest possible violation, a Staff member who does not
    teach the subject at all, into a success. Fetch, check for `None`, then compare; the
    ceiling is per subject and the boundary is inclusive.

    The ceiling is compared against the Child's Subject level for this subject, never the
    Overall grade. With no level the comparison is skipped, but never the `None` check: the
    Staff member must still teach the subject.
    """
    request = context.request
    assignment = db.scalars(
        select(TutorSubject).where(
            TutorSubject.tutor_id == teaching.tutor_id,
            TutorSubject.subject_id == teaching.subject_id,
        )
    ).first()
    level = db.scalars(
        select(ChildSubjectLevel.level).where(
            ChildSubjectLevel.child_id == request.child_id,
            ChildSubjectLevel.subject_id == teaching.subject_id,
        )
    ).first()

    if assignment is None:
        raise TutorGradeCeilingExceeded
    if level is not None and assignment.max_grade_level < level:
        raise TutorGradeCeilingExceeded


def _rule_6_home_belongs_to_child(db: Session, context: _Context) -> None:
    """Rule 6 — 422 (#38). Checked against the **child**, never against the booking guardian;
    nothing to check In office, where the shape guarantees `home_id` is NULL.

    A guardian booking a session at the child's other home — the co-parent's house — is
    accepted, which is the case the two columns exist for. Rule 7 is what keeps that safe.
    """
    request = context.request

    if request.home_id is not None:
        linked = db.scalars(
            select(ChildHome.id).where(
                ChildHome.child_id == request.child_id,
                ChildHome.home_id == request.home_id,
            )
        ).first()

        if linked is None:
            raise HomeNotLinkedToChild


def _rule_7_guardian_linked_to_child(db: Session, context: _Context) -> None:
    """Rule 7 — 422 (#38). NULL is always allowed and is the Office path.

    The `child_guardians` link is the only thing separating a co-parent booking into the other
    household from a stranger booking for someone else's child.
    """
    request = context.request

    if request.booked_by_guardian_id is not None:
        linked = db.scalars(
            select(ChildGuardian.id).where(
                ChildGuardian.child_id == request.child_id,
                ChildGuardian.guardian_id == request.booked_by_guardian_id,
            )
        ).first()

        if linked is None:
            raise GuardianNotLinkedToChild


def _rule_8_child_not_evaluated(db: Session, context: _Context) -> None:
    """Rule 8 — 422 (#133). An Evaluation is for a Child not yet Evaluated. Clearing the mark
    (`child_evaluation_service`, which this module never touches) reopens it.

    Not applied to an edit: the Evaluation already exists, and the Office may move it after
    the Child was marked (answers.md, planner 3). The Completed → Confirmed revert stays strict
    and is `booking_status_service`'s, not this rule's.
    """
    if context.exclude_booking_id is not None:
        return

    if context.child.evaluated_at is not None:
        raise ChildAlreadyEvaluated


def _rule_9_no_live_evaluation(db: Session, context: _Context) -> None:
    """Rule 9 — 409 (#133), the readable half of `uq_bookings_one_live_evaluation_per_child`.
    Completed and Cancelled Evaluations do not count, and neither does the Evaluation being
    edited: only *another* live one refuses."""
    live = db.scalars(
        select(Booking.id).where(
            Booking.child_id == context.request.child_id,
            Booking.kind == BookingKind.EVALUATION,
            Booking.status.in_(LIVE_BOOKING_STATUSES),
            _not_the_booking(context.exclude_booking_id),
        )
    ).first()

    if live is not None:
        raise LiveEvaluationExists


_HARD_RULES: dict[BookingKind, tuple[_Rule, ...]] = {
    BookingKind.REGULAR: (
        _rule_2_no_live_overlap,
        _rule_6_home_belongs_to_child,
        _rule_7_guardian_linked_to_child,
    ),
    BookingKind.EVALUATION: (
        _rule_2_no_live_overlap,
        _rule_6_home_belongs_to_child,
        _rule_7_guardian_linked_to_child,
        _rule_8_child_not_evaluated,
        _rule_9_no_live_evaluation,
    ),
}

# Run only with a teaching profile in hand — a Tutor/Manager Regular booking — in the order
# the codes are reported.
_WARNING_RULES: tuple[tuple[WarningCode, _WarningRule], ...] = (
    (WarningCode.OUTSIDE_SLOT, _rule_1_inside_named_availability),
    (WarningCode.GAP, _rule_3_gap_respected),
    (WarningCode.TIME_OFF, _rule_4_not_blocked_by_exception),
    (WarningCode.GRADE_CEILING, _rule_5_grade_ceiling_respected),
)


def _run_warning_rules(
    db: Session, context: _Context, *, confirm_warnings: frozenset[WarningCode] | None
) -> None:
    """Every failing warning, collected (#151): the Office confirms them all at once, so
    stopping at the first would cost a round trip per warning and would let a later one go
    unmentioned until the earlier was confirmed."""
    teaching = context.teaching

    if teaching is None:
        return

    raised: list[tuple[WarningCode, BookingWriteError]] = []
    for code, rule in _WARNING_RULES:
        try:
            rule(db, context, teaching)
        except BookingWriteError as exc:
            raised.append((code, exc))

    if raised and confirm_warnings is None:
        # The bot: the first failing rule refuses as its own exception, as it always has.
        raise raised[0][1]

    unconfirmed = tuple(
        code for code, _ in raised if confirm_warnings is not None and code not in confirm_warnings
    )
    if unconfirmed:
        raise UnconfirmedWarnings(unconfirmed)


# --- the shape, the references and the window ---------------------------------------------


def _check_shape(request: BookingRequest) -> None:
    """The role-independent half of the shape (#130), before any read: a home Location names a
    home and the office none; a Regular booking has a Subject and an Evaluation has neither a
    Subject nor a slot. Mirrors the three CHECKs on `bookings`."""
    at_home = request.location is BookingLocation.HOME
    is_regular = request.kind is BookingKind.REGULAR

    if at_home != (request.home_id is not None):
        raise BookingShapeInvalid
    if is_regular != (request.subject_id is not None):
        raise BookingShapeInvalid
    if not is_regular and request.availability_id is not None:
        raise BookingShapeInvalid


def _check_role(request: BookingRequest, *, role: UserRole) -> None:
    """The role-dependent half: who takes which kind, and whether a slot is named (#130).

    An Evaluation is an Admin's or a Manager's. A Regular booking with an Admin names no slot —
    they have no profile to offer one — and one with a Tutor or Manager must name one; only the
    time falling outside it is a warning, the slot itself stays required (#151).
    """
    if request.kind is BookingKind.EVALUATION:
        if role not in EVALUATION_ROLES:
            raise StaffRoleNotAllowed
    elif role in TEACHING_ROLES:
        if request.availability_id is None:
            raise BookingShapeInvalid
    elif request.availability_id is not None:
        raise BookingShapeInvalid


def _resolve_staff(db: Session, *, request: BookingRequest) -> User:
    """The Staff member, as a person. A missing, inactive or unbookable (Developer) user is a
    reference failure like any other retired row (#130); `users.is_active` is the only flag
    that decides whether a Tutor or Manager is active."""
    staff = db.get(User, request.user_id)

    if staff is None or not staff.is_active or staff.role not in BOOKABLE_ROLES:
        raise BookingReferenceNotFound

    return staff


def _resolve(
    db: Session,
    *,
    request: BookingRequest,
    gap_minutes: int,
    exclude_booking_id: uuid.UUID | None,
) -> _Context:
    """The rows the rules read, and REQ-044.24's 400 when one of them is missing or retired.

    `retirable` is every reference that carries `is_active`, and a deactivated one is refused
    exactly as a missing one is. A soft delete keeps the row and its dependent rows, so an
    existence check alone lets this endpoint confirm a session against a Staff member that
    `GET /api/slots/available` has already stopped offering (`slot_service`'s
    `_qualified_tutor_names`) — the write path more permissive than the offer path, which is
    #44 item 1 in reverse and is why the phase's divergence tests do not catch it. `subjects`
    and `homes` are checked here and on neither surface today.

    **Still the 400, deliberately not one of the 422s.** The 422s refuse a *combination* of
    two rows that are individually fine; a retired row is a property of one reference. Adding
    a third convention for a unary reference failure is what this avoids.

    **The named availability range is resolved here too** (`_resolve_teaching`): a missing row
    is this 400, and one that is not an active range of *this* Staff member's profile is rule
    1's own 400. The time falling outside the range is rule 1's warning, not either.

    `children` carries `is_active` from migration 0016 on (P7C-1) and an inactive child is
    refused here exactly as a missing one, like every other retirable reference. (`CONSTITUTION.md`
    §12 governs junctions only and never forbade the flag — D-7C-4.)

    **The child and the home are read `FOR SHARE`** (P7C-S), because each has a deactivation
    that decides on the bookings it can see: `child_service.update_child` locks the child
    `FOR UPDATE` and cancels the upcoming bookings it counted, and `home_service.update_home`
    locks the home `FOR UPDATE` and refuses while one is upcoming. An unlocked read here would
    let a booking commit behind either decision — a live session on an inactive child that the
    admin never confirmed, or at a home the guard just let go. With the share lock each pair
    serialises: a deactivation already under way makes this wait and then see the row inactive;
    a booking already past this line makes the deactivation wait and then see the booking.
    `FOR SHARE` does not conflict with itself, so bookings of one child or at one home do not
    queue on each other. `populate_existing` is what makes the locked read win over a row the
    caller's session already cached: otherwise a caller that loaded it earlier in the transaction
    would be judged on the value read *before* the lock waited (`conversation_service._locked`).

    **Lock order is conversation → child → home → bookings**, and nothing in this module may
    lock a booking before these reads. Neither deactivation can close a cycle against it:
    `update_child` takes the child and then bookings, and reaches a home only through the key
    share an inserted `child_homes` row takes, after the child; `update_home` takes only the home
    and waits on nothing else. The child is kept out of `retirable` because the rules need it
    too; the home stays in it, read locked.
    """
    child = db.get(Child, request.child_id, with_for_update={"read": True}, populate_existing=True)
    retirable: list[Subject | Home | Guardian | None] = []

    if request.subject_id is not None:
        retirable.append(db.get(Subject, request.subject_id))
    if request.home_id is not None:
        retirable.append(
            db.get(Home, request.home_id, with_for_update={"read": True}, populate_existing=True)
        )
    if request.booked_by_guardian_id is not None:
        retirable.append(db.get(Guardian, request.booked_by_guardian_id))

    if (
        child is None
        or not child.is_active
        or any(row is None or not row.is_active for row in retirable)
    ):
        raise BookingReferenceNotFound

    return _Context(
        request=request,
        child=child,
        gap_minutes=gap_minutes,
        teaching=_resolve_teaching(db, request=request),
        exclude_booking_id=exclude_booking_id,
    )


def _resolve_teaching(db: Session, *, request: BookingRequest) -> _Teaching | None:
    """The teaching profile and the named range, for the shapes that name one; `None` for the
    rest. `_check_role` has already paired "names a slot" with "has a teaching role"."""
    if request.availability_id is None or request.subject_id is None:
        return None

    tutor_id = db.scalar(select(Tutor.id).where(Tutor.user_id == request.user_id))
    availability = db.get(TutorAvailability, request.availability_id)

    if availability is None:
        raise BookingReferenceNotFound
    # Rule 1's hard half, still 400 (OQ-4): a row belonging to another profile, a withdrawn one,
    # or one named by a Manager with no profile to own it names the wrong range, not the wrong
    # row. Only the time falling outside the range is the warning (#151).
    if tutor_id is None or availability.tutor_id != tutor_id or not availability.is_active:
        raise OutsideAvailability

    return _Teaching(tutor_id=tutor_id, availability=availability, subject_id=request.subject_id)


def _assert_within_window(
    request: BookingRequest,
    *,
    now: datetime.datetime,
    settings: scheduling_service.SchedulingSettings,
) -> None:
    try:
        scheduling_service.assert_date_in_window(
            request.scheduled_date,
            today=now.date(),
            lookahead_days=settings.booking_lookahead_days,
        )
    except scheduling_service.DateOutOfWindow as exc:
        raise DateOutOfWindow from exc

    try:
        scheduling_service.assert_lead_time_met(
            request.scheduled_date,
            request.start_time,
            now=now,
            min_lead_hours=settings.min_booking_lead_hours,
        )
    except scheduling_service.LeadTimeNotMet as exc:
        raise LeadTimeNotMet from exc


# --- the reads the rules share --------------------------------------------------------------


def _overlapping_booking(
    db: Session,
    *,
    user_id: uuid.UUID,
    scheduled_date: datetime.date,
    start_time: datetime.time,
    end_time: datetime.time,
    exclude_booking_id: uuid.UUID | None,
) -> bool:
    """Rule 2's pre-check, named rather than inline so a test can reach past it to the
    constraint (D-I). Nothing else in this module may compare bookings by hand."""
    return any(
        scheduling_service.overlaps(start_time, end_time, booking.start_time, booking.end_time)
        for booking in _live_bookings(
            db,
            user_id=user_id,
            scheduled_date=scheduled_date,
            exclude_booking_id=exclude_booking_id,
        )
    )


def _gap_encroached(
    db: Session,
    *,
    user_id: uuid.UUID,
    location: BookingLocation,
    scheduled_date: datetime.date,
    start_time: datetime.time,
    end_time: datetime.time,
    gap_minutes: int,
    exclude_booking_id: uuid.UUID | None,
) -> bool:
    """Rule 3's pre-check. Named for the same reason as `_overlapping_booking`, and reading the
    same rows through `_live_bookings` so the two rules can never disagree about which bookings
    count. The gap is the travel gap: none between two In office bookings (#132)."""
    return any(
        scheduling_service.overlaps_within_gap(
            start_time,
            end_time,
            booking.start_time,
            booking.end_time,
            gap_minutes=scheduling_service.travel_gap_minutes(
                location, booking.location, gap_minutes=gap_minutes
            ),
        )
        for booking in _live_bookings(
            db,
            user_id=user_id,
            scheduled_date=scheduled_date,
            exclude_booking_id=exclude_booking_id,
        )
    )


def _live_bookings(
    db: Session,
    *,
    user_id: uuid.UUID,
    scheduled_date: datetime.date,
    exclude_booking_id: uuid.UUID | None,
) -> list[Booking]:
    """`LIVE_BOOKING_STATUSES` is the single definition of a booking that counts — the same set
    the exclusion constraint's `WHERE` covers, so a cancelled booking frees its range here
    exactly as it does in the database. Keyed on the Staff member's user, as the constraint is,
    and of either kind: an Evaluation is a neighbour like any other session. The booking being
    edited is not its own neighbour."""
    return list(
        db.scalars(
            select(Booking).where(
                Booking.user_id == user_id,
                Booking.scheduled_date == scheduled_date,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
                _not_the_booking(exclude_booking_id),
            )
        ).all()
    )


def _not_the_booking(exclude_booking_id: uuid.UUID | None) -> ColumnElement[bool]:
    """Every row on a create; every row but the one being edited on an edit. Spelled out
    because `Booking.id != None` would render as `IS NOT NULL`, which is right by accident."""
    if exclude_booking_id is None:
        return true()

    return Booking.id != exclude_booking_id


def _approved_exceptions(
    db: Session, *, tutor_id: uuid.UUID, on: datetime.date
) -> list[TutorAvailabilityException]:
    return list(
        db.scalars(
            select(TutorAvailabilityException).where(
                TutorAvailabilityException.tutor_id == tutor_id,
                TutorAvailabilityException.status == ExceptionStatus.APPROVED,
                TutorAvailabilityException.start_date <= on,
                TutorAvailabilityException.end_date >= on,
            )
        ).all()
    )


def _exception_blocks(
    row: TutorAvailabilityException, *, start_time: datetime.time, end_time: datetime.time
) -> bool:
    if row.start_time is None or row.end_time is None:
        blocks = True
    else:
        blocks = scheduling_service.overlaps(start_time, end_time, row.start_time, row.end_time)

    return blocks
