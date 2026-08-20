"""The tutor time-off request and the admin decision on it, exercised over HTTP.

This is the REQ-063 tutor-isolation assertion set. Every negative case asserts the exact
status **and** that the body is `{"detail": "<string>"}`: `status_code != 200` would pass on a
404 or a 500, and a cross-tutor request answered with a 404 or an empty 200 instead of a 403
is precisely the failure this module exists to prevent.

The assertion that matters most is `test_tutor_cannot_decide_their_own_pending_request`. A
pending exception that a tutor can approve is not a gate, and the whole point of the status
column is that a tutor cannot remove their own availability without a second person agreeing.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailabilityException
from app.models.enums import ExceptionStatus, UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.exceptions import (
    ALREADY_DECIDED_ERROR,
    EXCEPTION_NOT_FOUND_ERROR,
    TUTOR_NOT_FOUND_ERROR,
)
from app.security import create_access_token, hash_password

ADMIN_ROLE_CASES = [UserRole.ADMIN, UserRole.DEVELOPER]


# --- create: a tutor asks for time off ------------------------------------------------------


def test_tutor_creating_their_own_request_lands_pending(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions", json=_payload(), headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "pending"
    assert body["tutor_id"] == str(tutor.id)
    assert body["reason"] == "vacation"
    assert _row(db, uuid.UUID(body["id"])).status is ExceptionStatus.PENDING


def test_tutor_creating_for_another_tutor_is_403_and_writes_nothing(
    api: TestClient, db: Session
) -> None:
    """Not 404, not an empty 201: the 403 comes from dependency resolution, so the route body
    never runs and no row exists for either tutor afterwards."""
    own = _make_tutor(db)
    other = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.post(
        f"/api/tutors/{other.id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)
    assert _count_for(db, other.id) == 0
    assert _count_for(db, own.id) == 0


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
def test_admin_creating_for_any_tutor_is_approved_immediately(
    api: TestClient, db: Session, role: UserRole
) -> None:
    """Exceptions were admin-managed and immediately blocking before the status column, and an
    admin approving their own entry is a gate with nobody on the other side of it."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=role)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions", json=_payload(), headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "approved"
    assert body["tutor_id"] == str(tutor.id)
    assert _row(db, uuid.UUID(body["id"])).status is ExceptionStatus.APPROVED


def test_a_status_in_the_create_body_cannot_self_approve(api: TestClient, db: Session) -> None:
    """`status` is not on the request schema at all, so supplying one is inert rather than
    honoured — a tutor cannot approve themselves by adding a key to their JSON."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions",
        json=_payload(status="approved"),
        headers=_bearer(user),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "pending"


def test_a_partial_day_request_round_trips_its_window(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions",
        json=_payload(start_time="09:00:00", end_time="11:30:00", notes="back after lunch"),
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 201
    assert body["start_time"] == "09:00:00"
    assert body["end_time"] == "11:30:00"
    assert body["notes"] == "back after lunch"


def test_a_whole_day_request_carries_a_null_window(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    body = api.post(
        f"/api/tutors/{tutor.id}/exceptions", json=_payload(), headers=_bearer(user)
    ).json()

    assert body["start_time"] is None
    assert body["end_time"] is None
    assert body["notes"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"start_time": "09:00:00"},
        {"end_time": "09:00:00"},
        {"start_time": "11:00:00", "end_time": "09:00:00"},
        {"start_date": "2026-09-05", "end_date": "2026-09-01"},
        {"reason": ""},
    ],
    ids=["start-only", "end-only", "backwards-window", "backwards-dates", "empty-reason"],
)
def test_an_incoherent_window_is_400_not_a_constraint_violation(
    api: TestClient, db: Session, overrides: dict[str, str]
) -> None:
    """These mirror the table's CHECK constraints. Reaching PostgreSQL with a half-set time
    pair would turn an ordinary bad request into a 500."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions", json=_payload(**overrides), headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, tutor.id) == 0


def test_an_unrecognised_reason_is_400_not_a_constraint_violation(
    api: TestClient, db: Session
) -> None:
    """The set mirrors docs/erd.md's documented values and the admin dashboard's reason
    dropdown. A value outside it would reach that dropdown with no matching option."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions",
        json=_payload(reason="dentist"),
        headers=_bearer(user),
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, tutor.id) == 0


def test_admin_creating_for_an_unknown_tutor_is_404(api: TestClient, db: Session) -> None:
    """Only an admin can reach this: a tutor's own id is a foreign key, and any other id is
    already a 403."""
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{uuid.uuid4()}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 404, TUTOR_NOT_FOUND_ERROR)


# --- decide: only an admin, and only once ---------------------------------------------------


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_admin_decides_a_pending_exception(
    api: TestClient, db: Session, role: UserRole, decision: str
) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, tutor_id=tutor.id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=role)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": decision}, headers=_bearer(user)
    )

    assert response.status_code == 200
    assert response.json()["status"] == decision
    assert _row(db, row.id).status is ExceptionStatus(decision)


def test_tutor_cannot_decide_their_own_pending_request(api: TestClient, db: Session) -> None:
    """The assertion this feature exists for. A tutor who can approve their own time off has
    not been gated by anything, and the row must still be pending afterwards."""
    tutor = _make_tutor(db)
    row = _make_exception(db, tutor_id=tutor.id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_tutor_cannot_decide_another_tutors_exception(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    other = _make_tutor(db)
    row = _make_exception(db, tutor_id=other.id, status=ExceptionStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "rejected"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


@pytest.mark.parametrize("decided", [ExceptionStatus.APPROVED, ExceptionStatus.REJECTED])
def test_admin_redeciding_a_decided_exception_is_409(
    api: TestClient, db: Session, decided: ExceptionStatus
) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, tutor_id=tutor.id, status=decided)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 409, ALREADY_DECIDED_ERROR)
    assert _row(db, row.id).status is decided


def test_admin_deciding_an_unknown_exception_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{uuid.uuid4()}", json={"status": "approved"}, headers=_bearer(user)
    )

    _assert_detail(response, 404, EXCEPTION_NOT_FOUND_ERROR)


def test_pending_is_not_an_accepted_decision(api: TestClient, db: Session) -> None:
    """Both decisions are terminal. A decided row pushed back to pending would stop blocking
    bookings without anyone having rejected it."""
    tutor = _make_tutor(db)
    row = _make_exception(db, tutor_id=tutor.id, status=ExceptionStatus.APPROVED)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/exceptions/{row.id}", json={"status": "pending"}, headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _row(db, row.id).status is ExceptionStatus.APPROVED


# --- 401 and the null-tutor_id data error ----------------------------------------------------


def test_unauthenticated_create_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.post(f"/api/tutors/{tutor.id}/exceptions", json=_payload())

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _count_for(db, tutor.id) == 0


def test_unauthenticated_decide_is_401(api: TestClient, db: Session) -> None:
    """`require_admin` depends on `get_current_user`, so authentication fails first — 401,
    never the 403 that would tell an anonymous caller the row exists."""
    tutor = _make_tutor(db)
    row = _make_exception(db, tutor_id=tutor.id, status=ExceptionStatus.PENDING)

    response = api.patch(f"/api/exceptions/{row.id}", json={"status": "approved"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _row(db, row.id).status is ExceptionStatus.PENDING


def test_tutor_with_null_tutor_id_cannot_create(api: TestClient, db: Session) -> None:
    """`users.tutor_id` is nullable because admins have no tutor profile, so a tutor row in
    that state is a data error and must fail loudly rather than be treated as unscoped."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = api.post(
        f"/api/tutors/{tutor.id}/exceptions", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)
    assert _count_for(db, tutor.id) == 0


def test_tutor_with_null_tutor_id_cannot_decide(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_exception(db, tutor_id=tutor.id, status=ExceptionStatus.PENDING)
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
        tutor_id=tutor.id,
        start_date=datetime.date(2026, 9, 1),
        end_date=datetime.date(2026, 9, 1),
        reason="dentist",
    )
    db.add(row)
    db.flush()
    db.refresh(row)

    assert row.status is ExceptionStatus.APPROVED


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "start_date": "2026-09-01",
        "end_date": "2026-09-03",
        "reason": "vacation",
    }
    payload.update(overrides)
    return payload


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_user(db: Session, *, role: UserRole, tutor_id: uuid.UUID | None = None) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password("exception-password"),
        role=role,
        tutor_id=tutor_id,
    )
    db.add(user)
    db.flush()
    return user


def _make_exception(
    db: Session, *, tutor_id: uuid.UUID, status: ExceptionStatus
) -> TutorAvailabilityException:
    row = TutorAvailabilityException(
        tutor_id=tutor_id,
        start_date=datetime.date(2026, 9, 1),
        end_date=datetime.date(2026, 9, 3),
        reason="dentist",
        status=status,
    )
    db.add(row)
    db.flush()
    return row


def _row(db: Session, exception_id: uuid.UUID) -> TutorAvailabilityException:
    db.expire_all()
    return db.get_one(TutorAvailabilityException, exception_id)


def _count_for(db: Session, tutor_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count())
        .select_from(TutorAvailabilityException)
        .where(TutorAvailabilityException.tutor_id == tutor_id)
    ).scalar_one()


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
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
