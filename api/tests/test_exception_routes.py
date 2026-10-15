"""A Staff member's Time off and its lifecycle — create, decide, cancel, Expired — over HTTP.

This is the REQ-063 isolation assertion set. Every negative case asserts the exact status
**and** that the body is `{"detail": "<string>"}`: `status_code != 200` would pass on a 404 or
a 500, and a cross-user request answered with a 404 or an empty 200 instead of a 403 is
precisely the failure this module exists to prevent.

The assertion that matters most is `test_tutor_cannot_decide_their_own_pending_request`. A
pending request its owner can approve is not a gate, and the whole point of the status column
is that nobody below an Admin removes their own availability without a second person agreeing.

Dates are far in the future unless a test is about the window having ended, so nothing here
drifts into "ended" as the calendar moves.
"""

import datetime
import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import REASON_MAX_LENGTH, TutorAvailabilityException
from app.models.enums import ExceptionStatus, UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.exceptions import (
    ALREADY_DECIDED_ERROR,
    DEVELOPER_TIME_OFF_ERROR,
    EXCEPTION_NOT_FOUND_ERROR,
    NOT_CANCELLABLE_ERROR,
    OTHERS_TIME_OFF_ERROR,
    TIME_OFF_CANCELLED_ERROR,
    TIME_OFF_ENDED_ERROR,
    USER_ARCHIVED_ERROR,
    USER_NOT_FOUND_ERROR,
    WINDOW_ENDED_ERROR,
)
from app.security import create_access_token, hash_password
from app.services import clock

ADMIN_ROLE_CASES = [UserRole.ADMIN, UserRole.DEVELOPER]
REQUESTER_ROLE_CASES = [UserRole.TUTOR, UserRole.MANAGER]

FUTURE = datetime.date(2099, 9, 1)
# A partial-day window on `FROZEN_DAY`, and clock readings either side of its end.
FROZEN_DAY = datetime.date(2099, 9, 1)
WINDOW_END = datetime.time(11, 0)


# --- create: who asks, and the status it lands at -------------------------------------------


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
def test_a_tutor_or_managers_own_request_lands_pending(
    api: TestClient, db: Session, role: UserRole
) -> None:
    """A Manager's own request used to auto-approve with every other Office creation, skipping
    the second person the gate exists to put in the way."""
    user = _make_staff(db, role=role)

    response = api.post(f"/api/users/{user.id}/exceptions", json=_payload(), headers=_bearer(user))
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "pending"
    assert body["staff"] == {"id": str(user.id), "name": user.name, "role": role.value}
    assert body["reason"] == "vacation"
    assert body["decided_by"] is None
    assert body["decided_at"] is None
    assert body["cancelled_by"] is None
    assert body["cancelled_at"] is None
    assert _row(db, uuid.UUID(body["id"])).status is ExceptionStatus.PENDING


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
@pytest.mark.parametrize("target_role", [UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN])
def test_a_tutor_or_manager_creating_for_someone_else_is_403_and_writes_nothing(
    api: TestClient, db: Session, role: UserRole, target_role: UserRole
) -> None:
    """Not 404, not an empty 201: the 403 comes before the lookup."""
    user = _make_staff(db, role=role)
    target = _make_staff(db, role=target_role)

    response = api.post(
        f"/api/users/{target.id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)
    assert _count_for(db, target.id) == 0
    assert _count_for(db, user.id) == 0


def test_a_manager_creating_for_an_unknown_id_is_403_not_404(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.MANAGER)

    response = api.post(
        f"/api/users/{uuid.uuid4()}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
@pytest.mark.parametrize(
    "target_role", [UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN, None], ids=str
)
def test_an_admins_entry_lands_approved_and_decided_by_them(
    api: TestClient, db: Session, role: UserRole, target_role: UserRole | None
) -> None:
    """`None` is the Admin's own entry. Another Admin is a fair target: the #173 peer-admin
    rule does not apply to Time off."""
    user = _make_staff(db, role=role)
    target = user if target_role is None else _make_staff(db, role=target_role)

    response = api.post(
        f"/api/users/{target.id}/exceptions", json=_payload(), headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "approved"
    assert body["staff"]["id"] == str(target.id)
    assert body["decided_by"] == {"id": str(user.id), "name": user.name}
    assert body["decided_at"] is not None
    assert _row(db, uuid.UUID(body["id"])).decided_by == user.id


def test_an_admin_creating_for_a_developer_is_403(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.ADMIN)
    developer = _make_staff(db, role=UserRole.DEVELOPER)

    response = api.post(
        f"/api/users/{developer.id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, DEVELOPER_TIME_OFF_ERROR)
    assert _count_for(db, developer.id) == 0


def test_a_developer_creating_for_another_developer_is_201(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.DEVELOPER)
    developer = _make_staff(db, role=UserRole.DEVELOPER)

    response = api.post(
        f"/api/users/{developer.id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    assert response.status_code == 201
    assert response.json()["status"] == "approved"


def test_creating_for_an_archived_user_is_422(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.ADMIN)
    archived = _make_staff(db, role=UserRole.TUTOR)
    archived.is_archived = True
    db.flush()

    response = api.post(
        f"/api/users/{archived.id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 422, USER_ARCHIVED_ERROR)
    assert _count_for(db, archived.id) == 0


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
def test_a_requesters_window_that_ended_yesterday_is_422(
    api: TestClient, db: Session, role: UserRole
) -> None:
    """Filing it would make a request that is Expired on arrival."""
    user = _make_staff(db, role=role)

    response = api.post(
        f"/api/users/{user.id}/exceptions", json=_yesterday_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 422, WINDOW_ENDED_ERROR)
    assert _count_for(db, user.id) == 0


def test_an_admin_may_log_an_ended_window_and_it_is_then_frozen(
    api: TestClient, db: Session
) -> None:
    """Yesterday's sick day: it lands approved, and nothing can change it afterwards."""
    user = _make_staff(db, role=UserRole.ADMIN)
    tutor = _make_staff(db, role=UserRole.TUTOR)

    created = api.post(
        f"/api/users/{tutor.id}/exceptions", json=_yesterday_payload(), headers=_bearer(user)
    )
    cancelled = api.post(f"/api/exceptions/{created.json()['id']}/cancel", headers=_bearer(user))

    assert created.status_code == 201
    assert created.json()["status"] == "approved"
    _assert_detail(cancelled, 409, TIME_OFF_ENDED_ERROR)


@pytest.mark.parametrize(
    ("now", "expected_status"),
    [
        (datetime.datetime.combine(FROZEN_DAY, datetime.time(10, 59)), 201),
        (datetime.datetime.combine(FROZEN_DAY, WINDOW_END), 422),
    ],
    ids=["a-minute-before-the-end", "at-the-end"],
)
def test_a_partial_day_window_has_ended_once_its_end_time_is_reached(
    api: TestClient,
    db: Session,
    freeze_business_clock: Callable[[datetime.datetime], None],
    now: datetime.datetime,
    expected_status: int,
) -> None:
    """End <= now is ended: a window ending at 11:00 is over at 11:00, not a minute later."""
    freeze_business_clock(now)
    user = _make_staff(db, role=UserRole.TUTOR)

    response = api.post(
        f"/api/users/{user.id}/exceptions",
        json=_payload(
            start_date=FROZEN_DAY.isoformat(),
            end_date=FROZEN_DAY.isoformat(),
            start_time="09:00:00",
            end_time=WINDOW_END.isoformat(),
        ),
        headers=_bearer(user),
    )

    assert response.status_code == expected_status


@pytest.mark.parametrize(
    ("now", "expected_status"),
    [
        (datetime.datetime.combine(FROZEN_DAY, datetime.time(23, 59)), 201),
        (datetime.datetime.combine(FROZEN_DAY + datetime.timedelta(days=1), datetime.time()), 422),
    ],
    ids=["last-minute-of-the-day", "midnight-after"],
)
def test_a_whole_day_window_ends_at_the_start_of_the_next_day(
    api: TestClient,
    db: Session,
    freeze_business_clock: Callable[[datetime.datetime], None],
    now: datetime.datetime,
    expected_status: int,
) -> None:
    freeze_business_clock(now)
    user = _make_staff(db, role=UserRole.TUTOR)

    response = api.post(
        f"/api/users/{user.id}/exceptions",
        json=_payload(start_date=FROZEN_DAY.isoformat(), end_date=FROZEN_DAY.isoformat()),
        headers=_bearer(user),
    )

    assert response.status_code == expected_status


def test_a_status_in_the_create_body_cannot_self_approve(api: TestClient, db: Session) -> None:
    """`status` is not on the request schema at all, so supplying one is inert rather than
    honoured — a tutor cannot approve themselves by adding a key to their JSON."""
    user = _make_staff(db, role=UserRole.TUTOR)

    response = api.post(
        f"/api/users/{user.id}/exceptions",
        json=_payload(status="approved"),
        headers=_bearer(user),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "pending"


def test_a_partial_day_request_round_trips_its_window(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.TUTOR)

    response = api.post(
        f"/api/users/{user.id}/exceptions",
        json=_payload(start_time="09:00:00", end_time="11:30:00", reason="back after lunch"),
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 201
    assert body["start_time"] == "09:00:00"
    assert body["end_time"] == "11:30:00"
    assert body["reason"] == "back after lunch"


def test_a_whole_day_request_carries_a_null_window(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.TUTOR)

    body = api.post(
        f"/api/users/{user.id}/exceptions", json=_payload(), headers=_bearer(user)
    ).json()

    assert body["start_time"] is None
    assert body["end_time"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"start_time": "09:00:00"},
        {"end_time": "09:00:00"},
        {"start_time": "11:00:00", "end_time": "09:00:00"},
        {"start_date": "2026-09-05", "end_date": "2026-09-01"},
    ],
    ids=["start-only", "end-only", "backwards-window", "backwards-dates"],
)
def test_an_incoherent_window_is_400_not_a_constraint_violation(
    api: TestClient, db: Session, overrides: dict[str, str]
) -> None:
    """These mirror the table's CHECK constraints. Reaching PostgreSQL with a half-set time
    pair would turn an ordinary bad request into a 500."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/users/{tutor.user_id}/exceptions", json=_payload(**overrides), headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, tutor.user_id) == 0


def test_a_reason_over_the_limit_is_400(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/users/{user.id}/exceptions",
        json=_payload(reason="x" * (REASON_MAX_LENGTH + 1)),
        headers=_bearer(user),
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, user.id) == 0


def test_a_reason_at_the_limit_is_kept(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)
    reason = "x" * REASON_MAX_LENGTH

    response = api.post(
        f"/api/users/{user.id}/exceptions", json=_payload(reason=reason), headers=_bearer(user)
    )

    assert response.status_code == 201
    assert response.json()["reason"] == reason


def test_a_reason_is_trimmed(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/users/{user.id}/exceptions",
        json=_payload(reason="  Dentist  "),
        headers=_bearer(user),
    )

    assert response.status_code == 201
    assert response.json()["reason"] == "Dentist"


@pytest.mark.parametrize("overrides", [{"reason": "   "}, {"reason": None}, {}])
def test_a_blank_or_missing_reason_is_stored_as_null(
    api: TestClient, db: Session, overrides: dict[str, object]
) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)
    payload = {key: value for key, value in _payload().items() if key != "reason"}

    response = api.post(
        f"/api/users/{user.id}/exceptions", json={**payload, **overrides}, headers=_bearer(user)
    )

    assert response.status_code == 201
    assert response.json()["reason"] is None
    assert _row(db, uuid.UUID(response.json()["id"])).reason is None


def test_admin_creating_for_an_unknown_user_is_404(api: TestClient, db: Session) -> None:
    """Only Admin roles can reach this: any id but a requester's own is already a 403."""
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/users/{uuid.uuid4()}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 404, USER_NOT_FOUND_ERROR)


def test_an_admin_without_a_profile_holds_their_own_time_off(api: TestClient, db: Session) -> None:
    """Time off belongs to the person, so an Admin with no teaching profile can hold it."""
    user = _make_user(db, role=UserRole.ADMIN)

    created = api.post(f"/api/users/{user.id}/exceptions", json=_payload(), headers=_bearer(user))
    listed = api.get(f"/api/users/{user.id}/exceptions", headers=_bearer(user))

    assert created.status_code == 201
    assert created.json()["status"] == "approved"
    assert created.json()["staff"] == {"id": str(user.id), "name": user.name, "role": "admin"}
    assert [item["staff"]["role"] for item in listed.json()["items"]] == ["admin"]


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_the_old_tutor_paths_are_gone(api: TestClient, db: Session, method: str) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.request(
        method,
        f"/api/tutors/{tutor.id}/exceptions",
        json=_payload() if method == "POST" else None,
        headers=_bearer(user),
    )

    assert response.status_code == 404
    assert _count_for(db, tutor.user_id) == 0


# --- decide: only an Admin role, and only while it is still live ----------------------------


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_admin_decides_a_pending_exception(
    api: TestClient, db: Session, role: UserRole, decision: str
) -> None:
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    user = _make_staff(db, role=role)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": decision}, headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == decision
    assert body["decided_by"] == {"id": str(user.id), "name": user.name}
    assert body["decided_at"] is not None
    assert _row(db, row.id).status is ExceptionStatus(decision)


def test_approving_a_rejected_row_overwrites_the_earlier_decision(
    api: TestClient, db: Session
) -> None:
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    first = _make_staff(db, role=UserRole.ADMIN)
    second = _make_staff(db, role=UserRole.ADMIN)

    rejected = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "rejected"}, headers=_bearer(first)
    )
    approved = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(second)
    )

    assert rejected.status_code == 200
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["decided_by"] == {"id": str(second.id), "name": second.name}
    assert approved.json()["decided_at"] > rejected.json()["decided_at"]


@pytest.mark.parametrize(
    ("existing", "decision"),
    [
        (ExceptionStatus.APPROVED, "rejected"),
        (ExceptionStatus.APPROVED, "approved"),
        (ExceptionStatus.REJECTED, "rejected"),
    ],
)
def test_redeciding_is_409(
    api: TestClient, db: Session, existing: ExceptionStatus, decision: str
) -> None:
    """Declining an approval is refused: undoing one always goes through cancel."""
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=existing)
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": decision}, headers=_bearer(user)
    )

    _assert_detail(response, 409, ALREADY_DECIDED_ERROR)
    assert _row(db, row.id).status is existing


@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_deciding_a_cancelled_row_is_409(api: TestClient, db: Session, decision: str) -> None:
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=ExceptionStatus.CANCELLED)
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": decision}, headers=_bearer(user)
    )

    _assert_detail(response, 409, TIME_OFF_CANCELLED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.CANCELLED


@pytest.mark.parametrize(
    ("existing", "decision"),
    [
        (ExceptionStatus.PENDING, "approved"),
        (ExceptionStatus.PENDING, "rejected"),
        (ExceptionStatus.REJECTED, "approved"),
    ],
)
def test_deciding_an_ended_row_is_409(
    api: TestClient, db: Session, existing: ExceptionStatus, decision: str
) -> None:
    """History stays fixed once the Time off is over, Expired requests included."""
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=existing, start_date=_long_ago())
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": decision}, headers=_bearer(user)
    )

    _assert_detail(response, 409, TIME_OFF_ENDED_ERROR)
    assert _row(db, row.id).status is existing


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
def test_a_requester_cannot_decide_even_their_own_pending_request(
    api: TestClient, db: Session, role: UserRole
) -> None:
    """The assertion this feature exists for, and a Manager is no exception now."""
    user = _make_staff(db, role=role)
    row = _make_exception(db, user_id=user.id, status=ExceptionStatus.PENDING)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_tutor_cannot_decide_their_own_pending_request(api: TestClient, db: Session) -> None:
    """A tutor who can approve their own time off has not been gated by anything, and the row
    must still be pending afterwards."""
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_a_manager_cannot_decide_someone_elses_request(api: TestClient, db: Session) -> None:
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    user = _make_staff(db, role=UserRole.MANAGER)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "rejected"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_an_admin_deciding_a_developers_row_is_403(api: TestClient, db: Session) -> None:
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    row = _make_exception(db, user_id=developer.id, status=ExceptionStatus.PENDING)
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, DEVELOPER_TIME_OFF_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_a_developer_decides_a_developers_row(api: TestClient, db: Session) -> None:
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    row = _make_exception(db, user_id=developer.id, status=ExceptionStatus.PENDING)
    user = _make_staff(db, role=UserRole.DEVELOPER)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    assert response.status_code == 200


def test_admin_deciding_an_unknown_exception_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{uuid.uuid4()}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 404, EXCEPTION_NOT_FOUND_ERROR)


@pytest.mark.parametrize("target", ["pending", "cancelled"])
def test_only_approved_or_rejected_is_an_accepted_decision(
    api: TestClient, db: Session, target: str
) -> None:
    """Cancelling is its own route with its own rules, and nothing goes back to pending."""
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.APPROVED)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": target}, headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _row(db, row.id).status is ExceptionStatus.APPROVED


# --- list: one person's Time off, every status ----------------------------------------------


def test_tutor_lists_their_own_exceptions(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/users/{tutor.user_id}/exceptions", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert set(body) == {"items", "total", "page", "page_size"}
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert [item["id"] for item in body["items"]] == [str(row.id)]
    assert body["items"][0]["status"] == "pending"


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
def test_a_requester_listing_someone_elses_time_off_is_403(
    api: TestClient, db: Session, role: UserRole
) -> None:
    """Not 404, and emphatically not an empty 200. A Manager reads only their own."""
    other = _make_staff(db, role=UserRole.TUTOR)
    _make_exception(db, user_id=other.id, status=ExceptionStatus.PENDING)
    user = _make_staff(db, role=role)

    response = api.get(f"/api/users/{other.id}/exceptions", headers=_bearer(user))

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)


def test_a_manager_lists_their_own_time_off(api: TestClient, db: Session) -> None:
    user = _make_staff(db, role=UserRole.MANAGER)
    row = _make_exception(db, user_id=user.id, status=ExceptionStatus.PENDING)

    response = api.get(f"/api/users/{user.id}/exceptions", headers=_bearer(user))

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(row.id)]


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
@pytest.mark.parametrize("target_role", [UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN])
def test_an_admin_lists_anyones_time_off(
    api: TestClient, db: Session, role: UserRole, target_role: UserRole
) -> None:
    target = _make_staff(db, role=target_role)
    other = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=target.id, status=ExceptionStatus.PENDING)
    _make_exception(db, user_id=other.id, status=ExceptionStatus.APPROVED)
    user = _make_staff(db, role=role)

    response = api.get(f"/api/users/{target.id}/exceptions", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [str(row.id)]


def test_an_admin_listing_a_developers_time_off_is_403(api: TestClient, db: Session) -> None:
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    _make_exception(db, user_id=developer.id, status=ExceptionStatus.APPROVED)
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.get(f"/api/users/{developer.id}/exceptions", headers=_bearer(user))

    _assert_detail(response, 403, DEVELOPER_TIME_OFF_ERROR)


def test_a_developer_lists_another_developers_time_off(api: TestClient, db: Session) -> None:
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    _make_exception(db, user_id=developer.id, status=ExceptionStatus.APPROVED)
    user = _make_staff(db, role=UserRole.DEVELOPER)

    response = api.get(f"/api/users/{developer.id}/exceptions", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_an_ended_pending_row_reads_expired_and_nothing_else_does(
    api: TestClient, db: Session
) -> None:
    """Expired is derived at read time: only a pending row whose end has passed, nothing
    stored, no job."""
    user = _make_staff(db, role=UserRole.TUTOR)
    expired = _make_exception(
        db, user_id=user.id, status=ExceptionStatus.PENDING, start_date=_long_ago()
    )
    still_pending = _make_exception(db, user_id=user.id, status=ExceptionStatus.PENDING)
    ended_approved = _make_exception(
        db, user_id=user.id, status=ExceptionStatus.APPROVED, start_date=_long_ago()
    )

    body = api.get(f"/api/users/{user.id}/exceptions", headers=_bearer(user)).json()
    statuses = {item["id"]: item["status"] for item in body["items"]}

    assert statuses == {
        str(expired.id): "expired",
        str(still_pending.id): "pending",
        str(ended_approved.id): "approved",
    }
    assert _row(db, expired.id).status is ExceptionStatus.PENDING


def test_the_list_names_who_decided_and_who_cancelled(api: TestClient, db: Session) -> None:
    owner = _make_staff(db, role=UserRole.TUTOR)
    admin = _make_staff(db, role=UserRole.ADMIN)
    decided = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    cancelled = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    api.patch(f"/api/exceptions/{decided.id}", json={"status": "approved"}, headers=_bearer(admin))
    api.post(f"/api/exceptions/{cancelled.id}/cancel", headers=_bearer(owner))

    body = api.get(f"/api/users/{owner.id}/exceptions", headers=_bearer(owner)).json()
    items = {item["id"]: item for item in body["items"]}

    assert items[str(decided.id)]["decided_by"] == {"id": str(admin.id), "name": admin.name}
    assert items[str(decided.id)]["cancelled_by"] is None
    assert items[str(cancelled.id)]["cancelled_by"] == {"id": str(owner.id), "name": owner.name}
    assert items[str(cancelled.id)]["cancelled_at"] is not None
    assert items[str(cancelled.id)]["decided_by"] is None


def test_every_status_is_listed(api: TestClient, db: Session) -> None:
    """Only an approved row blocks availability, but the list is how someone sees a request is
    still waiting and how an Admin finds what is left to decide."""
    tutor = _make_tutor(db)
    for exception_status in ExceptionStatus:
        _make_exception(db, user_id=tutor.user_id, status=exception_status)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/users/{tutor.user_id}/exceptions", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert body["total"] == 4
    assert {item["status"] for item in body["items"]} == {
        "pending",
        "approved",
        "rejected",
        "cancelled",
    }


def test_total_counts_rows_the_page_did_not_return(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    for exception_status in ExceptionStatus:
        _make_exception(db, user_id=tutor.user_id, status=exception_status)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    body = api.get(
        f"/api/users/{tutor.user_id}/exceptions?page_size=2", headers=_bearer(user)
    ).json()

    assert len(body["items"]) == 2
    assert body["total"] == 4
    assert body["page_size"] == 2


def test_rows_are_ordered_by_start_date_then_id(api: TestClient, db: Session) -> None:
    """Two requests starting on one date is the ordinary case for a tutor booking a week off in
    pieces, and LIMIT/OFFSET over a sort key that cannot separate them has no ordering
    guarantee across separate executions — so a page could repeat or skip a row."""
    tutor = _make_tutor(db)
    same_day = [
        _make_exception(
            db,
            user_id=tutor.user_id,
            status=ExceptionStatus.PENDING,
            start_date=datetime.date(2026, 9, 5),
        ).id
        for _ in range(2)
    ]
    earliest = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.PENDING,
        start_date=datetime.date(2026, 9, 1),
    ).id
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    url = f"/api/users/{tutor.user_id}/exceptions"
    first = api.get(url, headers=_bearer(user)).json()
    again = api.get(url, headers=_bearer(user)).json()

    expected = [str(earliest), *sorted(str(row_id) for row_id in same_day)]
    assert [item["id"] for item in first["items"]] == expected
    assert [item["id"] for item in again["items"]] == expected


@pytest.mark.parametrize("query", ["page=0", "page_size=0", "page_size=101"])
def test_a_malformed_page_parameter_is_400_never_422(
    api: TestClient, db: Session, query: str
) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/users/{tutor.user_id}/exceptions?{query}", headers=_bearer(user))

    _assert_detail_shape(response, 400)
    assert query.split("=")[0] in response.json()["detail"]


# --- list window: overlap, not containment --------------------------------------------------


def test_a_row_ending_exactly_on_from_is_included(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 5),
    )
    row.end_date = datetime.date(2026, 9, 7)
    db.flush()
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-07", headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(row.id)]


def test_a_row_ending_the_day_before_from_is_excluded(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 5),
    )
    row.end_date = datetime.date(2026, 9, 6)
    db.flush()
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-07", headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["items"] == []
    assert body["total"] == 0


def test_a_row_starting_exactly_on_to_is_included(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 10),
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?to=2026-09-10", headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(row.id)]


def test_a_row_starting_the_day_after_to_is_excluded(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 11),
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?to=2026-09-10", headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["items"] == []
    assert body["total"] == 0


def test_a_row_spanning_the_whole_window_is_included(api: TestClient, db: Session) -> None:
    """The case a containment predicate fails, and the reason this task exists: a row that
    starts before the window and ends after it still overlaps every day the window covers."""
    tutor = _make_tutor(db)
    row = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 1),
    )
    row.end_date = datetime.date(2026, 9, 30)
    db.flush()
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-10&to=2026-09-20",
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(row.id)]


def test_from_and_to_together_narrow_to_the_overlapping_rows(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    inside = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 10),
    )
    _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 1, 1),
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-01&to=2026-09-30",
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(inside.id)]


def test_from_alone_excludes_rows_that_end_before_it(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    later = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 15),
    )
    _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 1, 1),
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-01", headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(later.id)]


def test_to_alone_excludes_rows_that_start_after_it(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    earlier = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 1, 1),
    )
    _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 15),
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?to=2026-09-01", headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(earlier.id)]


def test_neither_from_nor_to_returns_every_row_as_before(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    for exception_status in ExceptionStatus:
        _make_exception(db, user_id=tutor.user_id, status=exception_status)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/users/{tutor.user_id}/exceptions", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert body["total"] == 4


def test_windowed_total_counts_the_filtered_query_before_paging(
    api: TestClient, db: Session
) -> None:
    tutor = _make_tutor(db)
    for offset in range(3):
        _make_exception(
            db,
            user_id=tutor.user_id,
            status=ExceptionStatus.APPROVED,
            start_date=datetime.date(2026, 9, 10 + offset),
        )
    for offset in range(2):
        _make_exception(
            db,
            user_id=tutor.user_id,
            status=ExceptionStatus.APPROVED,
            start_date=datetime.date(2026, 1, 1 + offset),
        )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-01&to=2026-09-30&page_size=2",
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 200
    assert len(body["items"]) == 2
    assert body["total"] == 3


def test_a_malformed_from_is_400_not_422(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=notadate", headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)


def test_windowing_another_tutors_exceptions_is_still_403(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    other = _make_tutor(db)
    _make_exception(db, user_id=other.user_id, status=ExceptionStatus.APPROVED)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.get(
        f"/api/users/{other.user_id}/exceptions?from=2026-09-01&to=2026-09-30",
        headers=_bearer(user),
    )

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)


def test_a_tutor_windowing_their_own_id_still_gets_their_rows(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(
        db,
        user_id=tutor.user_id,
        status=ExceptionStatus.APPROVED,
        start_date=datetime.date(2026, 9, 15),
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(
        f"/api/users/{tutor.user_id}/exceptions?from=2026-09-01&to=2026-09-30",
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 200
    assert [item["id"] for item in body["items"]] == [str(row.id)]


# --- cancel: the owner withdraws, an Admin undoes -------------------------------------------


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN])
@pytest.mark.parametrize("existing", [ExceptionStatus.PENDING, ExceptionStatus.APPROVED])
def test_the_owner_cancels_their_own_live_row(
    api: TestClient, db: Session, role: UserRole, existing: ExceptionStatus
) -> None:
    user = _make_staff(db, role=role)
    row = _make_exception(db, user_id=user.id, status=existing)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert body["id"] == str(row.id)
    assert body["status"] == "cancelled"
    assert body["cancelled_by"] == {"id": str(user.id), "name": user.name}
    assert body["cancelled_at"] is not None
    # Kept, not deleted: the history is the point.
    assert _row(db, row.id).status is ExceptionStatus.CANCELLED
    assert _row(db, row.id).cancelled_by == user.id


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
@pytest.mark.parametrize("target_role", [UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN])
def test_an_admin_cancels_someone_elses_row(
    api: TestClient, db: Session, role: UserRole, target_role: UserRole
) -> None:
    """The way back from a mistaken approval, now that decide refuses to re-decide."""
    owner = _make_staff(db, role=target_role)
    row = _make_exception(db, user_id=owner.id, status=ExceptionStatus.APPROVED)
    user = _make_staff(db, role=role)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json()["cancelled_by"] == {"id": str(user.id), "name": user.name}


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
@pytest.mark.parametrize("existing", list(ExceptionStatus))
def test_a_requester_cancelling_someone_elses_row_is_403_whatever_its_status(
    api: TestClient, db: Session, role: UserRole, existing: ExceptionStatus
) -> None:
    """Ownership before status: answering 409 for someone else's rejected row would tell the
    caller it has been ruled on."""
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=existing)
    user = _make_staff(db, role=role)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)
    assert _row(db, row.id).status is existing


def test_an_admin_cancelling_a_developers_row_is_403(api: TestClient, db: Session) -> None:
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    row = _make_exception(db, user_id=developer.id, status=ExceptionStatus.APPROVED)
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    _assert_detail(response, 403, DEVELOPER_TIME_OFF_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.APPROVED


def test_a_developer_cancels_a_developers_row(api: TestClient, db: Session) -> None:
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    row = _make_exception(db, user_id=developer.id, status=ExceptionStatus.APPROVED)
    user = _make_staff(db, role=UserRole.DEVELOPER)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    assert response.status_code == 200


@pytest.mark.parametrize("existing", [ExceptionStatus.REJECTED, ExceptionStatus.CANCELLED])
def test_cancelling_a_rejected_or_cancelled_own_row_is_409(
    api: TestClient, db: Session, existing: ExceptionStatus
) -> None:
    user = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=user.id, status=existing)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    _assert_detail(response, 409, NOT_CANCELLABLE_ERROR)
    assert _row(db, row.id).status is existing


@pytest.mark.parametrize("existing", [ExceptionStatus.PENDING, ExceptionStatus.APPROVED])
def test_cancelling_an_ended_row_is_409(
    api: TestClient, db: Session, existing: ExceptionStatus
) -> None:
    """The pending case is Expired: it left the queue, and it stays as it was."""
    user = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=user.id, status=existing, start_date=_long_ago())

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    _assert_detail(response, 409, TIME_OFF_ENDED_ERROR)
    assert _row(db, row.id).status is existing


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER, *ADMIN_ROLE_CASES])
def test_cancelling_an_unknown_row_is_404(api: TestClient, db: Session, role: UserRole) -> None:
    """404 for everyone: an id that resolves to no row cannot be anybody's to be refused for."""
    user = _make_staff(db, role=role)

    response = api.post(f"/api/exceptions/{uuid.uuid4()}/cancel", headers=_bearer(user))

    _assert_detail(response, 404, EXCEPTION_NOT_FOUND_ERROR)


def test_delete_is_gone(api: TestClient, db: Session) -> None:
    """Cancel replaced it. The path still serves PATCH, so the method is what is refused."""
    owner = _make_staff(db, role=UserRole.TUTOR)
    row = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    user = _make_staff(db, role=UserRole.ADMIN)

    response = api.delete(f"/api/exceptions/{row.id}", headers=_bearer(user))

    assert response.status_code == 405
    assert _row(db, row.id).status is ExceptionStatus.PENDING


# --- 401, and a profile-less Tutor reaching for someone else --------------------------------


def test_unauthenticated_create_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.post(f"/api/users/{tutor.user_id}/exceptions", json=_payload())

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _count_for(db, tutor.user_id) == 0


def test_unauthenticated_decide_is_401(api: TestClient, db: Session) -> None:
    """`require_admin` depends on `get_current_user`, so authentication fails first — 401,
    never the 403 that would tell an anonymous caller the row exists."""
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)

    response = api.patch(f"/api/exceptions/{row.id}", json={"status": "approved"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_unauthenticated_cancel_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)

    response = api.post(f"/api/exceptions/{row.id}/cancel")

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_unauthenticated_list_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)

    response = api.get(f"/api/users/{tutor.user_id}/exceptions")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_tutor_with_null_tutor_id_cannot_create_for_someone_else(
    api: TestClient, db: Session
) -> None:
    """A `tutor` user with no profile is still only themselves: anyone else's id is a 403."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = api.post(
        f"/api/users/{tutor.user_id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)
    assert _count_for(db, tutor.user_id) == 0


def test_tutor_with_null_tutor_id_cannot_list_someone_else(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = api.get(f"/api/users/{tutor.user_id}/exceptions", headers=_bearer(user))

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)


def test_tutor_with_null_tutor_id_cannot_cancel_someone_else(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = api.post(f"/api/exceptions/{row.id}/cancel", headers=_bearer(user))

    _assert_detail(response, 403, OTHERS_TIME_OFF_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_tutor_with_null_tutor_id_cannot_decide(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, user_id=tutor.user_id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


# --- the column default -----------------------------------------------------------------------


def test_a_row_written_without_a_status_defaults_to_approved(db: Session) -> None:
    """Migration 0008's backfill, asserted from the model side: a writer that does not know
    about `status` still produces a blocking exception, never an inert one."""
    tutor = _make_tutor(db)
    row = TutorAvailabilityException(
        user_id=tutor.user_id,
        start_date=FUTURE,
        end_date=FUTURE,
        reason="dentist",
    )
    db.add(row)
    db.flush()
    db.refresh(row)

    assert row.status is ExceptionStatus.APPROVED


# --- the Admin cross-Staff list ------------------------------------------------------------


@pytest.mark.parametrize("role", REQUESTER_ROLE_CASES)
def test_a_tutor_or_manager_listing_all_time_off_is_403(
    api: TestClient, db: Session, role: UserRole
) -> None:
    user = _make_staff(db, role=role)

    response = api.get("/api/exceptions", headers=_bearer(user))

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
def test_an_admin_role_lists_all_staffs_time_off(
    api: TestClient, db: Session, role: UserRole
) -> None:
    admin = _make_staff(db, role=role)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    manager = _make_staff(db, role=UserRole.MANAGER)
    mine = _make_exception(db, user_id=tutor.id, status=ExceptionStatus.PENDING)
    theirs = _make_exception(db, user_id=manager.id, status=ExceptionStatus.APPROVED)

    response = api.get("/api/exceptions?page_size=100", headers=_bearer(admin))
    body = response.json()

    assert response.status_code == 200
    ids = {item["id"] for item in body["items"]}
    assert {str(mine.id), str(theirs.id)} <= ids
    assert body["total"] >= 2
    item = next(item for item in body["items"] if item["id"] == str(mine.id))
    assert item["staff"] == {"id": str(tutor.id), "name": tutor.name, "role": "tutor"}


def test_unauthenticated_list_all_is_401(api: TestClient) -> None:
    response = api.get("/api/exceptions")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_status_pending_leaves_out_ended_undecided_rows_and_expired_returns_them(
    api: TestClient, db: Session
) -> None:
    admin = _make_staff(db, role=UserRole.ADMIN)
    owner = _make_staff(db, role=UserRole.TUTOR)
    live = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING)
    ended = _make_exception(
        db, user_id=owner.id, status=ExceptionStatus.PENDING, start_date=_long_ago()
    )
    approved_ended = _make_exception(
        db, user_id=owner.id, status=ExceptionStatus.APPROVED, start_date=_long_ago()
    )
    base = f"/api/exceptions?user_id={owner.id}"

    pending = api.get(f"{base}&status=pending", headers=_bearer(admin)).json()
    expired = api.get(f"{base}&status=expired", headers=_bearer(admin)).json()
    approved = api.get(f"{base}&status=approved", headers=_bearer(admin)).json()

    assert [item["id"] for item in pending["items"]] == [str(live.id)]
    assert pending["total"] == 1
    assert [item["id"] for item in expired["items"]] == [str(ended.id)]
    assert [item["status"] for item in expired["items"]] == ["expired"]
    assert expired["total"] == 1
    assert {item["id"] for item in approved["items"]} == {str(approved_ended.id)}


def test_user_id_dates_and_status_combine_and_total_matches(api: TestClient, db: Session) -> None:
    admin = _make_staff(db, role=UserRole.ADMIN)
    owner = _make_staff(db, role=UserRole.TUTOR)
    other = _make_staff(db, role=UserRole.TUTOR)
    hit = _make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING, start_date=FUTURE)
    _make_exception(db, user_id=other.id, status=ExceptionStatus.PENDING, start_date=FUTURE)
    _make_exception(db, user_id=owner.id, status=ExceptionStatus.APPROVED, start_date=FUTURE)
    _make_exception(
        db,
        user_id=owner.id,
        status=ExceptionStatus.PENDING,
        start_date=FUTURE + datetime.timedelta(days=30),
    )
    # Ends the day before the window opens; the overlap test must leave it out.
    window_from = FUTURE + datetime.timedelta(days=3)
    window_to = FUTURE + datetime.timedelta(days=10)

    response = api.get(
        f"/api/exceptions?user_id={owner.id}&status=pending&from={window_from}&to={window_to}",
        headers=_bearer(admin),
    )
    body = response.json()

    assert response.status_code == 200
    assert body["items"] == []
    assert body["total"] == 0

    response = api.get(
        f"/api/exceptions?user_id={owner.id}&status=pending&from={FUTURE}&to={window_to}",
        headers=_bearer(admin),
    )
    body = response.json()

    assert [item["id"] for item in body["items"]] == [str(hit.id)]
    assert body["total"] == 1


def test_the_default_sort_is_start_date_and_requested_sort_is_oldest_created_first(
    api: TestClient, db: Session
) -> None:
    admin = _make_staff(db, role=UserRole.ADMIN)
    owner = _make_staff(db, role=UserRole.TUTOR)
    later_start_older = _make_exception(
        db,
        user_id=owner.id,
        status=ExceptionStatus.PENDING,
        start_date=FUTURE + datetime.timedelta(days=10),
    )
    earlier_start_newer = _make_exception(
        db, user_id=owner.id, status=ExceptionStatus.PENDING, start_date=FUTURE
    )
    later_start_older.created_at = datetime.datetime(2090, 1, 1, tzinfo=datetime.UTC)
    earlier_start_newer.created_at = datetime.datetime(2090, 2, 1, tzinfo=datetime.UTC)
    db.flush()
    base = f"/api/exceptions?user_id={owner.id}"

    by_start = api.get(base, headers=_bearer(admin)).json()
    by_requested = api.get(f"{base}&sort=requested", headers=_bearer(admin)).json()

    assert [item["id"] for item in by_start["items"]] == [
        str(earlier_start_newer.id),
        str(later_start_older.id),
    ]
    assert [item["id"] for item in by_requested["items"]] == [
        str(later_start_older.id),
        str(earlier_start_newer.id),
    ]


def test_paging_is_stable_when_rows_share_a_start_date(api: TestClient, db: Session) -> None:
    admin = _make_staff(db, role=UserRole.ADMIN)
    owner = _make_staff(db, role=UserRole.TUTOR)
    rows = [_make_exception(db, user_id=owner.id, status=ExceptionStatus.PENDING) for _ in range(5)]
    base = f"/api/exceptions?user_id={owner.id}&page_size=2"

    seen = [
        item["id"]
        for page in (1, 2, 3)
        for item in api.get(f"{base}&page={page}", headers=_bearer(admin)).json()["items"]
    ]

    assert sorted(seen) == sorted(str(row.id) for row in rows)
    assert len(set(seen)) == 5


def test_a_developers_time_off_never_appears(api: TestClient, db: Session) -> None:
    admin = _make_staff(db, role=UserRole.ADMIN)
    developer = _make_staff(db, role=UserRole.DEVELOPER)
    hidden = _make_exception(db, user_id=developer.id, status=ExceptionStatus.APPROVED)

    everyone = api.get("/api/exceptions?page_size=100", headers=_bearer(admin)).json()
    named = api.get(f"/api/exceptions?user_id={developer.id}", headers=_bearer(admin)).json()
    as_developer = api.get(
        f"/api/exceptions?user_id={developer.id}", headers=_bearer(developer)
    ).json()

    assert str(hidden.id) not in {item["id"] for item in everyone["items"]}
    assert named["items"] == []
    assert named["total"] == 0
    assert as_developer["items"] == []


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "start_date": FUTURE.isoformat(),
        "end_date": (FUTURE + datetime.timedelta(days=2)).isoformat(),
        "reason": "vacation",
    }
    payload.update(overrides)
    return payload


def _yesterday_payload() -> dict[str, object]:
    yesterday = clock.business_today() - datetime.timedelta(days=1)
    return _payload(start_date=yesterday.isoformat(), end_date=yesterday.isoformat())


def _long_ago() -> datetime.date:
    return clock.business_today() - datetime.timedelta(days=30)


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_user(db: Session, *, role: UserRole, tutor_id: uuid.UUID | None = None) -> User:
    if tutor_id is None:
        suffix = uuid.uuid4().hex[:12]
        user = User(
            email=f"user-{suffix}@example.com",
            name=f"User {suffix}",
            hashed_password=hash_password("exception-password"),
            role=role,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("exception-password")
        user.role = role
    db.flush()
    return user


def _make_staff(db: Session, *, role: UserRole) -> User:
    """A signed-in Staff member in the shape their role has: Tutors and Managers hold a teaching
    profile, Admins and Developers do not."""
    if role in (UserRole.TUTOR, UserRole.MANAGER):
        user = _make_user(db, role=role, tutor_id=_make_tutor(db).id)
    else:
        user = _make_user(db, role=role)
    return user


def _make_exception(
    db: Session,
    *,
    user_id: uuid.UUID,
    status: ExceptionStatus,
    start_date: datetime.date = FUTURE,
) -> TutorAvailabilityException:
    row = TutorAvailabilityException(
        user_id=user_id,
        start_date=start_date,
        end_date=start_date + datetime.timedelta(days=2),
        reason="dentist",
        status=status,
    )
    db.add(row)
    db.flush()
    return row


def _row(db: Session, exception_id: uuid.UUID) -> TutorAvailabilityException:
    db.expire_all()
    return db.get_one(TutorAvailabilityException, exception_id)


def _count_for(db: Session, user_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count())
        .select_from(TutorAvailabilityException)
        .where(TutorAvailabilityException.user_id == user_id)
    ).scalar_one()


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    """The status, and a body that is exactly `{"detail": "<string>"}` — nothing else."""
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)


def _assert_detail_shape(response: Response, expected_status: int) -> None:
    """For the validation failures, whose message is pydantic's rather than this project's."""
    assert response.status_code == expected_status
    body = response.json()
    assert set(body) == {"detail"}
    assert isinstance(body["detail"], str)
