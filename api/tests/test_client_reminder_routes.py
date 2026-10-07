"""`/api/clients/{id}/reminders`: a Guardian's weekly-reminder status, and Staff recording an
opt-in or opt-out for them.

The status is the current consent (the latest `reminder_consents` row, or `never`), the last
`booking_reminders` row, and the consent history newest first. Recording appends a `staff` row
naming the caller and sends the Guardian nothing.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    Language,
    ReminderSkipReason,
    ReminderStatus,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.reminder_consent import ReminderConsent
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token
from tests.fake_twilio import FakeTwilio

STAFF_NAME = "Mia Manager"
INTAKE_AT = datetime.datetime(2026, 9, 1, 15, 0, tzinfo=datetime.UTC)
LATER = datetime.datetime(2026, 9, 20, 15, 0, tzinfo=datetime.UTC)
LAST_WEEK = datetime.date(2026, 9, 21)
EARLIER_WEEK = datetime.date(2026, 9, 14)
CLIENT_NOT_FOUND = {"detail": "Client not found"}
# Written out rather than imported, so a reworded message is a deliberate test change.
SYSTEM_OPT_OUT_ERROR = (
    "WhatsApp reported this Guardian blocked our number; only the Guardian can turn reminders "
    "back on by messaging START from this number."
)


# --- GET /api/clients/{id}/reminders ------------------------------------------------------------


def test_a_guardian_never_asked_has_no_consent_no_reminder_and_no_history(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)

    response = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db)))

    assert response.status_code == 200
    assert response.json() == {
        "consent": {
            "state": "never",
            "source": None,
            "set_at": None,
            "blocked_by_whatsapp": False,
        },
        "last_reminder": None,
        "history": [],
    }


def test_a_guardian_opted_in_at_intake_reads_opted_in_from_intake(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)
    consent = _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)

    body = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db))).json()

    assert (body["consent"]["state"], body["consent"]["source"]) == ("opt_in", "intake")
    assert _at(body["consent"]["set_at"]) == INTAKE_AT
    [row] = body["history"]
    assert (row["id"], row["action"], row["source"], row["who"]) == (
        str(consent.id),
        "opt_in",
        "intake",
        "Guardian",
    )
    assert _at(row["created_at"]) == INTAKE_AT


def test_a_guardian_who_opted_out_by_message_reads_opted_out_with_history_newest_first(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.MESSAGE, at=LATER)

    body = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db))).json()

    assert (body["consent"]["state"], body["consent"]["source"]) == ("opt_out", "message")
    assert _at(body["consent"]["set_at"]) == LATER
    assert body["consent"]["blocked_by_whatsapp"] is False
    assert [(row["action"], row["source"], row["who"]) for row in body["history"]] == [
        ("opt_out", "message", "Guardian"),
        ("opt_in", "intake", "Guardian"),
    ]


def test_a_system_opt_out_is_attributed_to_whatsapp_and_the_last_reminder_shows_its_error(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.SYSTEM, at=LATER)
    _reminder(db, guardian, week_start=LAST_WEEK, status=ReminderStatus.FAILED, error_code="63050")

    body = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db))).json()

    assert (body["consent"]["state"], body["consent"]["source"]) == ("opt_out", "system")
    assert body["consent"]["blocked_by_whatsapp"] is True
    assert body["history"][0]["who"] == "WhatsApp"
    assert body["last_reminder"] == {
        "week_start": LAST_WEEK.isoformat(),
        "status": "failed",
        "error_code": "63050",
        "skip_reason": None,
    }


def test_the_last_reminder_is_the_latest_week_and_shows_its_skip_reason(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    _reminder(
        db,
        guardian,
        week_start=LAST_WEEK,
        status=ReminderStatus.SKIPPED,
        skip_reason=ReminderSkipReason.TAKEOVER,
    )
    _reminder(db, guardian, week_start=EARLIER_WEEK, status=ReminderStatus.READ)

    body = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db))).json()

    assert body["last_reminder"] == {
        "week_start": LAST_WEEK.isoformat(),
        "status": "skipped",
        "error_code": None,
        "skip_reason": "takeover",
    }


def test_a_staff_row_in_the_history_names_its_staff_member(api: TestClient, db: Session) -> None:
    guardian = _make_guardian(db)
    staff = _make_user(db, display_name=STAFF_NAME)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.STAFF, at=LATER, set_by=staff)

    body = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db))).json()

    assert body["consent"]["source"] == "staff"
    assert body["history"][0]["who"] == STAFF_NAME


def test_another_guardians_rows_are_not_in_the_status(api: TestClient, db: Session) -> None:
    guardian = _make_guardian(db)
    other = _make_guardian(db)
    _consent(db, other, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    _reminder(db, other, week_start=LAST_WEEK, status=ReminderStatus.SENT)

    body = api.get(f"/api/clients/{guardian.id}/reminders", headers=_auth(_make_user(db))).json()

    assert (body["consent"]["state"], body["last_reminder"], body["history"]) == (
        "never",
        None,
        [],
    )


def test_the_status_of_an_unknown_client_is_404(api: TestClient, db: Session) -> None:
    response = api.get(f"/api/clients/{uuid.uuid4()}/reminders", headers=_auth(_make_user(db)))

    assert (response.status_code, response.json()) == (404, CLIENT_NOT_FOUND)


# --- POST /api/clients/{id}/reminders/consent ----------------------------------------------------


@pytest.mark.parametrize("action", ["opt_in", "opt_out"])
def test_recording_consent_appends_a_staff_row_naming_the_caller_and_sends_nothing(
    api: TestClient, db: Session, fake_twilio: FakeTwilio, action: str
) -> None:
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    manager = _make_user(db, role=UserRole.MANAGER, display_name=STAFF_NAME)

    response = api.post(
        f"/api/clients/{guardian.id}/reminders/consent",
        headers=_auth(manager),
        json={"action": action},
    )

    body = response.json()
    assert response.status_code == 201
    assert (body["consent"]["state"], body["consent"]["source"]) == (action, "staff")
    assert [(row["action"], row["who"]) for row in body["history"]] == [
        (action, STAFF_NAME),
        ("opt_in", "Guardian"),
    ]
    [row] = db.scalars(
        select(ReminderConsent).where(
            ReminderConsent.guardian_id == guardian.id,
            ReminderConsent.source == ConsentSource.STAFF,
        )
    ).all()
    assert (row.action.value, row.set_by_user_id, row.message_id) == (action, manager.id, None)
    assert fake_twilio.sent == []


def test_staff_may_not_opt_in_a_guardian_whatsapp_reported_as_blocking_us(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.SYSTEM, at=LATER)
    headers = _auth(_make_user(db))

    status = api.get(f"/api/clients/{guardian.id}/reminders", headers=headers).json()
    response = api.post(
        f"/api/clients/{guardian.id}/reminders/consent", headers=headers, json={"action": "opt_in"}
    )

    # The screen hides Record opt-in from this flag.
    assert status["consent"]["blocked_by_whatsapp"] is True
    assert (response.status_code, response.json()) == (409, {"detail": SYSTEM_OPT_OUT_ERROR})
    assert _staff_rows(db, guardian) == []


def test_staff_may_still_record_an_opt_out_over_a_system_opt_out(
    api: TestClient, db: Session
) -> None:
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.SYSTEM, at=LATER)

    response = api.post(
        f"/api/clients/{guardian.id}/reminders/consent",
        headers=_auth(_make_user(db)),
        json={"action": "opt_out"},
    )

    assert response.status_code == 201
    assert response.json()["consent"]["blocked_by_whatsapp"] is True
    assert [row.action for row in _staff_rows(db, guardian)] == [ConsentAction.OPT_OUT]


def test_a_staff_opt_out_on_top_of_a_system_opt_out_does_not_lift_the_block(
    api: TestClient, db: Session
) -> None:
    """Staff rows never lift WhatsApp's opt-out: an opt-out then an opt-in is still a 409."""
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.INTAKE, at=INTAKE_AT)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.SYSTEM, at=LATER)
    headers = _auth(_make_user(db))
    path = f"/api/clients/{guardian.id}/reminders/consent"

    opt_out = api.post(path, headers=headers, json={"action": "opt_out"})
    status = api.get(f"/api/clients/{guardian.id}/reminders", headers=headers).json()
    opt_in = api.post(path, headers=headers, json={"action": "opt_in"})

    assert opt_out.status_code == 201
    assert (status["consent"]["source"], status["consent"]["blocked_by_whatsapp"]) == (
        "staff",
        True,
    )
    assert (opt_in.status_code, opt_in.json()) == (409, {"detail": SYSTEM_OPT_OUT_ERROR})
    assert [row.action for row in _staff_rows(db, guardian)] == [ConsentAction.OPT_OUT]


def test_staff_may_opt_in_once_the_latest_consent_is_no_longer_the_system_opt_out(
    api: TestClient, db: Session
) -> None:
    """A Guardian who restarted by message after WhatsApp's opt-out is no longer blocked, so
    Staff may record later changes as usual."""
    guardian = _make_guardian(db)
    _consent(db, guardian, ConsentAction.OPT_OUT, ConsentSource.SYSTEM, at=INTAKE_AT)
    _consent(db, guardian, ConsentAction.OPT_IN, ConsentSource.MESSAGE, at=LATER)
    headers = _auth(_make_user(db))

    status = api.get(f"/api/clients/{guardian.id}/reminders", headers=headers).json()
    response = api.post(
        f"/api/clients/{guardian.id}/reminders/consent", headers=headers, json={"action": "opt_in"}
    )

    assert status["consent"]["blocked_by_whatsapp"] is False
    assert response.status_code == 201


@pytest.mark.parametrize(
    "body",
    [{"action": "maybe"}, {"action": None}, {}],
    ids=["unknown", "null", "missing"],
)
def test_recording_an_action_that_is_not_opt_in_or_opt_out_is_400(
    api: TestClient, db: Session, body: dict[str, str | None]
) -> None:
    guardian = _make_guardian(db)

    response = api.post(
        f"/api/clients/{guardian.id}/reminders/consent", headers=_auth(_make_user(db)), json=body
    )

    assert response.status_code == 400
    assert (
        db.scalars(select(ReminderConsent).where(ReminderConsent.guardian_id == guardian.id)).all()
        == []
    )


def test_recording_consent_for_an_unknown_client_is_404(api: TestClient, db: Session) -> None:
    response = api.post(
        f"/api/clients/{uuid.uuid4()}/reminders/consent",
        headers=_auth(_make_user(db)),
        json={"action": "opt_in"},
    )

    assert (response.status_code, response.json()) == (404, CLIENT_NOT_FOUND)


def test_a_tutor_may_neither_read_nor_record_consent(api: TestClient, db: Session) -> None:
    guardian = _make_guardian(db)
    headers = _auth(_make_tutor_user(db))

    read = api.get(f"/api/clients/{guardian.id}/reminders", headers=headers)
    record = api.post(
        f"/api/clients/{guardian.id}/reminders/consent", headers=headers, json={"action": "opt_in"}
    )

    assert (read.status_code, record.status_code) == (403, 403)


# --- helpers -------------------------------------------------------------------------------------


def _staff_rows(db: Session, guardian: Guardian) -> list[ReminderConsent]:
    return list(
        db.scalars(
            select(ReminderConsent).where(
                ReminderConsent.guardian_id == guardian.id,
                ReminderConsent.source == ConsentSource.STAFF,
            )
        ).all()
    )


def _at(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value)


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _make_user(
    db: Session,
    *,
    role: UserRole = UserRole.ADMIN,
    display_name: str = "Test User",
    tutor_id: uuid.UUID | None = None,
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        display_name=display_name,
        hashed_password="unused",
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_tutor_user(db: Session) -> User:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}", phone_number=f"+1{suffix[:10]}", email=f"t-{suffix}@example.com"
    )
    db.add(tutor)
    db.flush()
    return _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)


def _make_guardian(db: Session) -> Guardian:
    guardian = Guardian(
        name=f"Guardian {uuid.uuid4().hex[:8]}",
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
        is_active=True,
    )
    db.add(guardian)
    db.flush()
    return guardian


def _consent(
    db: Session,
    guardian: Guardian,
    action: ConsentAction,
    source: ConsentSource,
    *,
    at: datetime.datetime,
    set_by: User | None = None,
) -> ReminderConsent:
    consent = ReminderConsent(
        guardian_id=guardian.id,
        action=action,
        source=source,
        # Staff rows speak for no number; every other row came from the Guardian's.
        phone_number=None if source is ConsentSource.STAFF else guardian.phone_number,
        set_by_user_id=None if set_by is None else set_by.id,
        created_at=at,
    )
    db.add(consent)
    db.flush()
    return consent


def _reminder(
    db: Session,
    guardian: Guardian,
    *,
    week_start: datetime.date,
    status: ReminderStatus,
    error_code: str | None = None,
    skip_reason: ReminderSkipReason | None = None,
) -> BookingReminder:
    reminder = BookingReminder(
        guardian_id=guardian.id,
        week_start=week_start,
        language=Language.EN,
        child_ids=[],
        status=status,
        error_code=error_code,
        skip_reason=skip_reason,
    )
    db.add(reminder)
    db.flush()
    return reminder
