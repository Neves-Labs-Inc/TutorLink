"""Booking creation: the seven validation rules, and the conflict guarantee behind them.

Same transaction contract as every other service here — nothing in this module commits, the
router owns the boundary. `db.flush()` inside the savepoint is what makes the constraint speak
before the request ends.

**The seven rules are `_RULES`, one ordered tuple, and that is the enumeration
`docs/api-design.md:1154-1157` asks for by name.** The list has been amended three times in two
days and expects a fourth; a rule added anywhere else is a rule the next reader will not find.
Each function carries its number, its status class and its issue number.

**The status codes are deliberately not uniform**: rule 1 is 400, rules 2, 3 and 4 are 409, and
rules 5, 6 and 7 are 422. `CONSTITUTION.md` §10 reserves 422 for "a deliberate semantic refusal
of a well-formed request", and `docs/api-design.md:1141-1144` assigns exactly that to the last
three: the request is well-formed and conflicts with nothing, it just names a combination that
is not permitted. They are the only 422s in the codebase and they are not to be "corrected" to
400 by a reader who has met §10's first clause without its parenthetical.

**`scheduling_service` is imported as a module, not by name.** Its `DateOutOfWindow` and
`LeadTimeNotMet` are the window arithmetic's own failures; this module re-raises them as its
own so a router catches one family of exceptions, and the two names would otherwise collide.
Every overlap comparison also comes from there rather than being re-derived here, because
`GET /api/slots/available` subtracts by the same functions — a slot the bot was just offered
being refused on arrival is #44 item 1, and shared predicates are what makes that structural
instead of a thing two modules have to remember.

This module never imports `generate_grid`: the endpoint deliberately does not require the range
to land on a grid slot (REQ-044.23), so an admin may book the leftover a rigid grid strands.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import BookingStatus, ExceptionStatus
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.services import scheduling_service


@dataclass(frozen=True, slots=True)
class BookingRequest:
    child_id: uuid.UUID
    tutor_id: uuid.UUID
    subject_id: uuid.UUID
    availability_id: uuid.UUID
    home_id: uuid.UUID
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    booked_by_guardian_id: uuid.UUID | None
    notes: str | None


class BookingWriteError(Exception):
    """Base class for every failure this module reports."""


class BookingReferenceNotFound(BookingWriteError):
    """One of the ids in the request names no row, or one an admin has retired
    (REQ-044.24) — 400. See `_resolve` for why a soft-deleted row is this and not a 422."""


class OutsideAvailability(BookingWriteError):
    """Rule 1 — 400."""


class BookingOverlaps(BookingWriteError):
    """Rule 2 — 409."""


class GapNotRespected(BookingWriteError):
    """Rule 3 — 409."""


class BlockedByException(BookingWriteError):
    """Rule 4 — 409."""


class TutorGradeCeilingExceeded(BookingWriteError):
    """Rule 5 — 422."""


class HomeNotLinkedToChild(BookingWriteError):
    """Rule 6 — 422."""


class GuardianNotLinkedToChild(BookingWriteError):
    """Rule 7 — 422."""


class DateOutOfWindow(BookingWriteError):
    """REQ-044.22 — 400."""


class LeadTimeNotMet(BookingWriteError):
    """REQ-044.22 — 400."""


@dataclass(frozen=True, slots=True)
class _Context:
    request: BookingRequest
    availability: TutorAvailability
    child: Child
    gap_minutes: int


def create_booking(db: Session, *, request: BookingRequest, now: datetime.datetime) -> Booking:
    """A `confirmed` booking, or the first rule that refuses it.

    `now` is a parameter rather than a clock read here, for the reason `scheduling_service`
    takes one: the window gates are then testable without freezing time.

    References resolve first, so a mistyped id — or one naming a row an admin has retired — is
    always REQ-044.24's 400 rather than a confusing rule failure about a row the caller never
    named. The window gates run next, ahead of the rules, because a date in the past is refused
    whatever the tutor's schedule says.
    """
    settings = scheduling_service.load_scheduling_settings(db)
    context = _resolve(db, request=request, gap_minutes=settings.session_gap_minutes)

    _assert_within_window(request, now=now, settings=settings)

    for rule in _RULES:
        rule(db, context)

    booking = Booking(
        child_id=request.child_id,
        tutor_id=request.tutor_id,
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
    # the readable 409, and a read-then-write check alone races. The savepoint wraps the insert
    # and the flush and nothing else, so no unrelated failure is mislabelled a conflict and the
    # `Session` survives the rollback — `client_service.py:159-165` records what assigning
    # anything above `begin_nested` does instead, since `_take_snapshot` flushes first and the
    # failing statement then runs outside the savepoint. The constraint is matched by the
    # exception type and this call site, never by its rendered name: a migrated database and a
    # `create_all` one do not agree on names.
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
        raise BookingOverlaps from exc

    return booking


def _rule_1_inside_named_availability(db: Session, context: _Context) -> None:
    """Rule 1 — 400. The `availability_id` the caller named, not any range that happens to fit.

    A row belonging to another tutor, an inactive one, or one for a different weekday is a
    rule-1 failure and not a reference failure: accepting `availability_id` as an unchecked
    column would let a caller point at another tutor's slot (OQ-4).
    """
    availability = context.availability
    request = context.request

    # `weekday()` is 0 = Monday … 6 = Sunday, which is `tutor_availability.day_of_week`'s
    # encoding. `isoweekday()` and PostgreSQL's `EXTRACT(DOW)` both number differently and both
    # silently shift every booking by a day.
    if (
        availability.tutor_id != request.tutor_id
        or not availability.is_active
        or availability.day_of_week != request.scheduled_date.weekday()
        or request.start_time < availability.start_time
        or request.end_time > availability.end_time
    ):
        raise OutsideAvailability


def _rule_2_no_live_overlap(db: Session, context: _Context) -> None:
    """Rule 2 — 409, and the readable half of REQ-045."""
    request = context.request

    if _overlapping_booking(
        db,
        tutor_id=request.tutor_id,
        scheduled_date=request.scheduled_date,
        start_time=request.start_time,
        end_time=request.end_time,
    ):
        raise BookingOverlaps


def _rule_3_gap_respected(db: Session, context: _Context) -> None:
    """Rule 3 — 409. Both inequalities strict, so clearance of exactly one gap is accepted."""
    request = context.request

    if _gap_encroached(
        db,
        tutor_id=request.tutor_id,
        scheduled_date=request.scheduled_date,
        start_time=request.start_time,
        end_time=request.end_time,
        gap_minutes=context.gap_minutes,
    ):
        raise GapNotRespected


def _rule_4_not_blocked_by_exception(db: Session, context: _Context) -> None:
    """Rule 4 — 409 (#24). Only `approved` blocks; `pending` and `rejected` never do.

    Bare overlap, not gap-expanded: step 2 of `GET /api/slots/available` subtracts exceptions
    the same way, and the asymmetry with rule 3 is deliberate.
    """
    request = context.request

    for row in _approved_exceptions(db, tutor_id=request.tutor_id, on=request.scheduled_date):
        if _exception_blocks(row, start_time=request.start_time, end_time=request.end_time):
            raise BlockedByException


def _rule_5_grade_ceiling_respected(db: Session, context: _Context) -> None:
    """Rule 5 — 422 (#36). A **missing** `tutor_subjects` row is a refusal, not a pass.

    Written as a join, `... JOIN tutor_subjects ... WHERE max_grade_level >= level` drops the
    row when the tutor holds no assignment for the subject, and "no row" then reads as "nothing
    to refuse" — turning the strongest possible violation, a tutor who does not teach the
    subject at all, into a success. Fetch, check for `None`, then compare; the ceiling is per
    subject and the boundary is inclusive.

    The ceiling is compared against the Child's Subject level for this subject, never the
    Overall grade. With no level the comparison is skipped, so Staff can book the Evaluation
    session, but never the `None` check: the tutor must still teach the subject.
    """
    request = context.request
    assignment = db.scalars(
        select(TutorSubject).where(
            TutorSubject.tutor_id == request.tutor_id,
            TutorSubject.subject_id == request.subject_id,
        )
    ).first()
    level = db.scalars(
        select(ChildSubjectLevel.level).where(
            ChildSubjectLevel.child_id == request.child_id,
            ChildSubjectLevel.subject_id == request.subject_id,
        )
    ).first()

    if assignment is None:
        raise TutorGradeCeilingExceeded
    if level is not None and assignment.max_grade_level < level:
        raise TutorGradeCeilingExceeded


def _rule_6_home_belongs_to_child(db: Session, context: _Context) -> None:
    """Rule 6 — 422 (#38). Checked against the **child**, never against the booking guardian.

    A guardian booking a session at the child's other home — the co-parent's house — is
    accepted, which is the case the two columns exist for. Rule 7 is what keeps that safe.
    """
    request = context.request
    linked = db.scalars(
        select(ChildHome.id).where(
            ChildHome.child_id == request.child_id,
            ChildHome.home_id == request.home_id,
        )
    ).first()

    if linked is None:
        raise HomeNotLinkedToChild


def _rule_7_guardian_linked_to_child(db: Session, context: _Context) -> None:
    """Rule 7 — 422 (#38). NULL is always allowed and is the admin path.

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


_RULES: tuple[Callable[[Session, _Context], None], ...] = (
    _rule_1_inside_named_availability,
    _rule_2_no_live_overlap,
    _rule_3_gap_respected,
    _rule_4_not_blocked_by_exception,
    _rule_5_grade_ceiling_respected,
    _rule_6_home_belongs_to_child,
    _rule_7_guardian_linked_to_child,
)


def _resolve(db: Session, *, request: BookingRequest, gap_minutes: int) -> _Context:
    """The rows the rules read, and REQ-044.24's 400 when one of them is missing or retired.

    `retirable` is every reference that carries `is_active`, and a deactivated one is refused
    exactly as a missing one is. A soft delete keeps the row and its dependent rows, so an
    existence check alone lets this endpoint confirm a session against a tutor that
    `GET /api/slots/available` has already stopped offering (`slot_service`'s
    `_qualified_tutor_names`) — the write path more permissive than the offer path, which is
    #44 item 1 in reverse and is why the phase's divergence tests do not catch it. `subjects`
    and `homes` are checked here and on neither surface today.

    **Still the 400, deliberately not one of the 422s.** `docs/api-design.md:1141-1144` gives
    422 to rules 5, 6 and 7, each of which refuses a *combination* of two rows that are
    individually fine; a retired row is a property of one reference, which is what rule 1
    already answers with a 400 when the named availability range is inactive. Adding a third
    convention for a unary reference failure is what this avoids.

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

    `tutor_availability.is_active` is absent from `retirable` because it is rule 1's, not a
    reference failure — a withdrawn range names the wrong times rather than the wrong row (OQ-4).
    """
    child = db.get(Child, request.child_id, with_for_update={"read": True}, populate_existing=True)
    availability = db.get(TutorAvailability, request.availability_id)
    tutor = db.get(Tutor, request.tutor_id)
    # The Tutor's active flag is the person's (#130): a profile is retired with its user.
    retirable = [
        None if tutor is None else tutor.user,
        db.get(Subject, request.subject_id),
        db.get(Home, request.home_id, with_for_update={"read": True}, populate_existing=True),
    ]

    if request.booked_by_guardian_id is not None:
        retirable.append(db.get(Guardian, request.booked_by_guardian_id))

    if (
        child is None
        or not child.is_active
        or availability is None
        or any(row is None or not row.is_active for row in retirable)
    ):
        raise BookingReferenceNotFound

    return _Context(
        request=request, availability=availability, child=child, gap_minutes=gap_minutes
    )


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


def _overlapping_booking(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    scheduled_date: datetime.date,
    start_time: datetime.time,
    end_time: datetime.time,
) -> bool:
    """Rule 2's pre-check, named rather than inline so a test can reach past it to the
    constraint (D-I). Nothing else in this module may compare bookings by hand."""
    return any(
        scheduling_service.overlaps(start_time, end_time, booking.start_time, booking.end_time)
        for booking in _live_bookings(db, tutor_id=tutor_id, scheduled_date=scheduled_date)
    )


def _gap_encroached(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    scheduled_date: datetime.date,
    start_time: datetime.time,
    end_time: datetime.time,
    gap_minutes: int,
) -> bool:
    """Rule 3's pre-check. Named for the same reason as `_overlapping_booking`, and reading the
    same rows through `_live_bookings` so the two rules can never disagree about which bookings
    count."""
    return any(
        scheduling_service.overlaps_within_gap(
            start_time, end_time, booking.start_time, booking.end_time, gap_minutes=gap_minutes
        )
        for booking in _live_bookings(db, tutor_id=tutor_id, scheduled_date=scheduled_date)
    )


def _live_bookings(
    db: Session, *, tutor_id: uuid.UUID, scheduled_date: datetime.date
) -> list[Booking]:
    """`LIVE_BOOKING_STATUSES` is the single definition of a booking that counts — the same set
    the exclusion constraint's `WHERE` covers, so a cancelled booking frees its range here
    exactly as it does in the database."""
    return list(
        db.scalars(
            select(Booking).where(
                Booking.tutor_id == tutor_id,
                Booking.scheduled_date == scheduled_date,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
            )
        ).all()
    )


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
