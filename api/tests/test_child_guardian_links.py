"""`POST /api/children/{id}/guardians` over HTTP — REQ-103, how an admin fulfils a
`guardian_link_request` flag.

"Nothing written" is asserted against the same `Session` the request ran in, before the
fixture's rollback: a row the service flushed before refusing would still be visible here, so
these counts prove every check ran before the first insert rather than that a rollback undid it.

The duplicate-link 409 is asserted twice, once with the pre-check live and once with it stubbed
out so only `UNIQUE (child_id, guardian_id)` can produce it — the race two admins clicking at
once would hit.

Every phone number below is a real, dialable US number in the 555-01xx fictional range.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import FlagReason, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import child_guardians, children, clients
from app.security import create_access_token, hash_password
from app.services import guardian_link_service

PASSWORD = "correct horse battery staple"
FIRST_PHONE = "+12025550123"
SECOND_PHONE = "+12025550187"
NEW_PHONE = "+12025550199"
CHOICE_ERROR = "Send exactly one of guardian_id or guardian"
HOMES_ERROR = "home_ids must name active homes of this child"
ALREADY_LINKED_ERROR = "That guardian is already linked to this child"
PHONE_TAKEN_ERROR = "A client with that phone number already exists"


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password(PASSWORD),
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
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()
    return _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _make_guardian(
    db: Session, *, name: str, phone_number: str, is_active: bool = True
) -> Guardian:
    guardian = Guardian(name=name, phone_number=phone_number, is_active=is_active)
    db.add(guardian)
    db.flush()
    return guardian


def _make_home(db: Session, *, label: str, is_active: bool = True) -> Home:
    home = Home(label=label, address=f"{label} Street", access_code="1234", is_active=is_active)
    db.add(home)
    db.flush()
    return home


def _make_child(
    db: Session, *, guardians: list[Guardian], homes: list[Home], is_active: bool = True
) -> Child:
    child = Child(
        name="Tommy Doe",
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Lincoln Middle School",
        is_active=is_active,
    )
    db.add(child)
    db.flush()
    for guardian in guardians:
        db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
    for home in homes:
        db.add(ChildHome(child_id=child.id, home_id=home.id))
    db.flush()
    return child


def _family(db: Session) -> tuple[Child, Guardian, Home, Home]:
    """A child with one guardian and two active homes, both the first guardian's."""
    first = _make_guardian(db, name="Jane Doe", phone_number=FIRST_PHONE)
    mums, dads = _make_home(db, label="Mum's"), _make_home(db, label="Dad's")
    for home in (mums, dads):
        db.add(GuardianHome(guardian_id=first.id, home_id=home.id))
    child = _make_child(db, guardians=[first], homes=[mums, dads])
    return child, first, mums, dads


def _link(
    api: TestClient, user: User, child_id: uuid.UUID, body: dict[str, object]
) -> tuple[int, dict[str, object]]:
    response = api.post(f"/api/children/{child_id}/guardians", headers=_auth(user), json=body)
    return response.status_code, response.json()


def _count(db: Session, model: type[Guardian] | type[ChildGuardian] | type[GuardianHome]) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def _guardian_home_ids(db: Session, guardian_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(select(GuardianHome.home_id).where(GuardianHome.guardian_id == guardian_id))
    )


def _child_home_ids(db: Session, child_id: uuid.UUID) -> set[uuid.UUID]:
    return set(db.scalars(select(ChildHome.home_id).where(ChildHome.child_id == child_id)))


# --- the shared literals ------------------------------------------------------------------


def test_repeated_literals_equal_their_owning_routers() -> None:
    assert child_guardians.PHONE_NUMBER_TAKEN_ERROR == clients.PHONE_NUMBER_TAKEN_ERROR
    assert child_guardians.INVALID_PHONE_NUMBER_ERROR == clients.INVALID_PHONE_NUMBER_ERROR
    assert child_guardians.CHILD_NOT_FOUND_ERROR == children.CHILD_NOT_FOUND_ERROR


# --- the two success paths ----------------------------------------------------------------


def test_linking_an_existing_guardian_to_one_of_two_homes(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, first, mums, dads = _family(db)
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)
    child_homes_before = _child_home_ids(db, child.id)

    status_code, body = _link(
        api, admin, child.id, {"guardian_id": str(second.id), "home_ids": [str(dads.id)]}
    )

    assert status_code == 201
    assert "is_active" in body
    assert set(body["guardian_ids"]) == {str(first.id), str(second.id)}
    assert set(body["home_ids"]) == {str(mums.id), str(dads.id)}
    assert _guardian_home_ids(db, second.id) == [dads.id]
    assert _child_home_ids(db, child.id) == child_homes_before

    detail = api.get(f"/api/clients/{second.id}", headers=_auth(admin)).json()

    assert [one["id"] for one in detail["children"]] == [str(child.id)]
    assert [one["id"] for one in detail["homes"]] == [str(dads.id)]


def test_linking_a_new_guardian_with_no_homes(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, first, _, _ = _family(db)

    status_code, body = _link(
        api,
        admin,
        child.id,
        {"guardian": {"name": "John Doe", "phone_number": "(202) 555-0199"}, "home_ids": []},
    )

    created = db.scalars(select(Guardian).where(Guardian.phone_number == NEW_PHONE)).one()

    assert status_code == 201
    assert set(body["guardian_ids"]) == {str(first.id), str(created.id)}
    assert created.name == "John Doe"
    assert created.is_active is True
    assert _guardian_home_ids(db, created.id) == []


def test_linking_to_an_inactive_child_is_allowed(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    first = _make_guardian(db, name="Jane Doe", phone_number=FIRST_PHONE)
    child = _make_child(
        db, guardians=[first], homes=[_make_home(db, label="Mum's")], is_active=False
    )
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)

    status_code, body = _link(api, admin, child.id, {"guardian_id": str(second.id)})

    assert status_code == 201
    assert body["is_active"] is False
    assert str(second.id) in body["guardian_ids"]


def test_a_home_the_guardian_already_holds_is_not_duplicated(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, _, mums, dads = _family(db)
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)
    db.add(GuardianHome(guardian_id=second.id, home_id=dads.id))
    db.flush()

    status_code, _ = _link(
        api,
        admin,
        child.id,
        {"guardian_id": str(second.id), "home_ids": [str(dads.id), str(dads.id), str(mums.id)]},
    )

    assert status_code == 201
    assert sorted(_guardian_home_ids(db, second.id)) == sorted([dads.id, mums.id])


def test_a_new_guardian_is_found_by_the_bots_recognition_query(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child, _, _, _ = _family(db)
    flagged = Conversation(
        phone_number=NEW_PHONE,
        flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        flagged_at=datetime.datetime.now(tz=datetime.UTC),
    )
    db.add(flagged)
    db.flush()

    status_code, _ = _link(
        api,
        admin,
        child.id,
        {"guardian": {"name": "John Doe", "phone_number": "202-555-0199"}},
    )

    recognised = db.scalars(
        select(Guardian).where(Guardian.phone_number == flagged.phone_number)
    ).one()
    link = db.scalars(
        select(ChildGuardian).where(
            ChildGuardian.guardian_id == recognised.id, ChildGuardian.child_id == child.id
        )
    ).one_or_none()

    assert status_code == 201
    assert link is not None


# --- refusals, each writing nothing -------------------------------------------------------


def test_a_new_guardian_with_a_deactivated_clients_phone_is_409(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child, _, _, _ = _family(db)
    _make_guardian(db, name="Old Client", phone_number=NEW_PHONE, is_active=False)
    guardians_before, links_before = _count(db, Guardian), _count(db, ChildGuardian)

    status_code, body = _link(
        api, admin, child.id, {"guardian": {"name": "John Doe", "phone_number": NEW_PHONE}}
    )

    assert status_code == 409
    assert body == {"detail": PHONE_TAKEN_ERROR}
    assert _count(db, Guardian) == guardians_before
    assert _count(db, ChildGuardian) == links_before


def test_an_undialable_new_guardian_phone_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, _, _, _ = _family(db)

    status_code, body = _link(
        api, admin, child.id, {"guardian": {"name": "John Doe", "phone_number": "+15551234567"}}
    )

    assert status_code == 400
    assert body == {"detail": clients.INVALID_PHONE_NUMBER_ERROR}


@pytest.mark.parametrize("sent", ["both", "neither"])
def test_both_or_neither_guardian_choice_is_400(api: TestClient, db: Session, sent: str) -> None:
    admin = _make_user(db)
    child, _, _, _ = _family(db)
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)
    body_sent: dict[str, object] = {"home_ids": []}
    if sent == "both":
        body_sent |= {
            "guardian_id": str(second.id),
            "guardian": {"name": "Someone", "phone_number": NEW_PHONE},
        }
    guardians_before, links_before = _count(db, Guardian), _count(db, ChildGuardian)

    status_code, body = _link(api, admin, child.id, body_sent)

    assert status_code == 400
    assert body == {"detail": CHOICE_ERROR}
    assert _count(db, Guardian) == guardians_before
    assert _count(db, ChildGuardian) == links_before


def test_linking_an_already_linked_guardian_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, first, _, dads = _family(db)
    links_before, homes_before = _count(db, ChildGuardian), _count(db, GuardianHome)

    status_code, body = _link(
        api, admin, child.id, {"guardian_id": str(first.id), "home_ids": [str(dads.id)]}
    )

    assert status_code == 409
    assert body == {"detail": ALREADY_LINKED_ERROR}
    assert _count(db, ChildGuardian) == links_before
    assert _count(db, GuardianHome) == homes_before


def test_the_link_constraint_alone_still_answers_409(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = _make_user(db)
    child, first, _, _ = _family(db)
    links_before = _count(db, ChildGuardian)
    monkeypatch.setattr(
        guardian_link_service,
        "_linkable_guardian",
        lambda session, *, child_id, guardian_id: session.get(Guardian, guardian_id),
    )

    status_code, body = _link(api, admin, child.id, {"guardian_id": str(first.id)})

    assert status_code == 409
    assert body == {"detail": ALREADY_LINKED_ERROR}
    assert _count(db, ChildGuardian) == links_before


@pytest.mark.parametrize("bad_home", ["deactivated home of the child", "home of another child"])
@pytest.mark.parametrize("guardian_kind", ["existing", "new"])
def test_a_home_outside_the_childs_active_homes_is_400(
    api: TestClient, db: Session, bad_home: str, guardian_kind: str
) -> None:
    admin = _make_user(db)
    child, first, mums, _ = _family(db)
    if bad_home == "deactivated home of the child":
        target = _make_home(db, label="Old", is_active=False)
        db.add(ChildHome(child_id=child.id, home_id=target.id))
        db.flush()
    else:
        target = _make_home(db, label="Elsewhere")
        _make_child(db, guardians=[first], homes=[target])
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)
    choice: dict[str, object] = (
        {"guardian_id": str(second.id)}
        if guardian_kind == "existing"
        else {"guardian": {"name": "New Person", "phone_number": NEW_PHONE}}
    )
    guardians_before, links_before = _count(db, Guardian), _count(db, ChildGuardian)
    homes_before = _count(db, GuardianHome)

    status_code, body = _link(
        api, admin, child.id, choice | {"home_ids": [str(mums.id), str(target.id)]}
    )

    assert status_code == 400
    assert body == {"detail": HOMES_ERROR}
    assert _count(db, Guardian) == guardians_before
    assert _count(db, ChildGuardian) == links_before
    assert _count(db, GuardianHome) == homes_before


def test_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)

    status_code, body = _link(api, admin, uuid.uuid4(), {"guardian_id": str(second.id)})

    assert status_code == 404
    assert body == {"detail": "Child not found"}


def test_an_unknown_guardian_id_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, _, _, _ = _family(db)

    status_code, body = _link(api, admin, child.id, {"guardian_id": str(uuid.uuid4())})

    assert status_code == 400
    assert body == {"detail": "guardian_id does not name an existing client"}


def test_a_malformed_body_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child, _, _, _ = _family(db)

    status_code, body = _link(api, admin, child.id, {"guardian_id": "not-a-uuid"})

    assert status_code == 400
    assert isinstance(body["detail"], str)


# --- the RBAC gate ------------------------------------------------------------------------


def test_a_tutor_is_refused(api: TestClient, db: Session) -> None:
    child, _, _, _ = _family(db)
    second = _make_guardian(db, name="John Doe", phone_number=SECOND_PHONE)
    links_before = _count(db, ChildGuardian)

    status_code, body = _link(api, _make_tutor_user(db), child.id, {"guardian_id": str(second.id)})

    assert status_code == 403
    assert isinstance(body["detail"], str)
    assert _count(db, ChildGuardian) == links_before


def test_no_token_is_401(api: TestClient, db: Session) -> None:
    child, _, _, _ = _family(db)

    response = api.post(f"/api/children/{child.id}/guardians", json={"guardian_id": None})

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)
