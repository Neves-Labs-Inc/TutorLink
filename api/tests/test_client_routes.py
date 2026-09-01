"""`/api/clients` over HTTP — REQ-032.

Two things here are worth more than the rest: the duplicate-phone 409 is asserted twice, once
with the pre-check live and once with it stubbed out so that only the `UNIQUE (phone_number)`
constraint can produce it, and `?phone_number=` is asserted to be a filter — an empty page —
rather than an address that 404s.

Every phone number below is a real, dialable US number in the 555-01xx fictional range:
`phone_service` validates with `is_valid_number`, so `+15551234567` is *not* one.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services import client_service

PASSWORD = "correct horse battery staple"
PHONE = "+12025550123"
OTHER_PHONE = "+12025550187"
PHONE_TAKEN_ERROR = "A client with that phone number already exists"


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
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


def _make_client(
    db: Session, *, name: str = "Jane Doe", phone_number: str = PHONE, is_active: bool = True
) -> Guardian:
    client = Guardian(name=name, phone_number=phone_number, is_active=is_active)
    db.add(client)
    db.flush()
    return client


def _make_home(db: Session, *, client: Guardian, label: str | None = "Mum's") -> Home:
    home = Home(label=label, address="123 Main St", access_code="1234")
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=client.id, home_id=home.id))
    db.flush()
    return home


def _make_child(db: Session, *, guardians: list[Guardian], name: str = "Tommy Doe") -> Child:
    child = Child(name=name, age=12, grade_level=7, school_name="Lincoln Middle School")
    db.add(child)
    db.flush()
    for guardian in guardians:
        db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
    db.flush()
    return child


# --- the envelope and the RBAC gate ---------------------------------------------------------


def test_list_returns_the_page_envelope_never_a_bare_array(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_client(db)

    body = api.get("/api/clients", headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_total_counts_matches_not_returned_rows(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    for index in range(5):
        _make_client(db, name=f"Client {index}", phone_number=f"+120255501{10 + index:02d}")

    body = api.get("/api/clients?page_size=2", headers=_auth(admin)).json()

    assert len(body["items"]) == 2
    assert body["total"] == 5
    assert body["page_size"] == 2


def test_deactivated_clients_are_hidden_until_asked_for(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_client(db, name="Active One", phone_number=PHONE)
    dormant = _make_client(db, name="Dormant One", phone_number=OTHER_PHONE, is_active=False)
    headers = _auth(admin)

    default = api.get("/api/clients", headers=headers).json()
    asked = api.get("/api/clients?is_active=false", headers=headers).json()

    assert [row["name"] for row in default["items"]] == ["Active One"]
    assert [row["id"] for row in asked["items"]] == [str(dormant.id)]
    assert asked["total"] == 1


def test_malformed_is_active_query_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/clients?is_active=maybe", headers=_auth(admin))

    assert response.status_code == 400
    assert "is_active" in response.json()["detail"]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/api/clients", None),
        ("get", "/api/clients/{client_id}", None),
        ("post", "/api/clients", {"name": "Jane Doe", "phone_number": OTHER_PHONE}),
        ("patch", "/api/clients/{client_id}", {"name": "Renamed"}),
    ],
)
def test_a_tutor_is_refused_on_every_client_route(
    api: TestClient, db: Session, method: str, path: str, body: dict[str, str] | None
) -> None:
    """Clients are admin-or-above in the RBAC table. A 403 rather than a 500 also proves no
    route here depends on `TutorScope`, which would arm the unapplied-scope guard."""
    tutor = _make_tutor_user(db)
    client = _make_client(db)

    response = api.request(
        method, path.format(client_id=client.id), headers=_auth(tutor), json=body
    )

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


def test_no_token_is_401_not_403(api: TestClient) -> None:
    response = api.get("/api/clients")

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_use_the_client_routes(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    created = api.post(
        "/api/clients",
        headers=_auth(developer),
        json={"name": "Jane Doe", "phone_number": PHONE},
    )

    assert created.status_code == 201
    assert api.get("/api/clients", headers=_auth(developer)).status_code == 200


# --- REQ-032.1-.3: `?phone_number=` is a filter, not an address ------------------------------


def test_unknown_phone_number_is_an_empty_page_not_a_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_client(db)

    response = api.get(f"/api/clients?phone_number={OTHER_PHONE}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


@pytest.mark.parametrize(
    "typed", ["+1 (202) 555-0123", "202-555-0123", "2025550123", "12025550123", "+12025550123"]
)
def test_phone_number_lookup_normalises_before_it_queries(
    api: TestClient, db: Session, typed: str
) -> None:
    """D-E. Without this the bot's "look up, then create" flow misses the canonical row and
    creates the duplicate the UNIQUE constraint then refuses."""
    admin = _make_user(db)
    client = _make_client(db, phone_number=PHONE)

    body = api.get("/api/clients", params={"phone_number": typed}, headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(client.id)]


def test_an_unparseable_phone_number_filter_is_400_not_an_empty_page(
    api: TestClient, db: Session
) -> None:
    """A malformed input is a validation failure, not "no match" — answering it with an empty
    page tells the caller to go ahead and create a client."""
    admin = _make_user(db)

    response = api.get("/api/clients", params={"phone_number": "banana"}, headers=_auth(admin))

    assert response.status_code == 400
    assert "phone_number" in response.json()["detail"]


def test_phone_number_lookup_does_not_special_case_the_is_active_default(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    dormant = _make_client(db, phone_number=PHONE, is_active=False)
    headers = _auth(admin)

    default = api.get(f"/api/clients?phone_number={PHONE}", headers=headers).json()
    asked = api.get(f"/api/clients?phone_number={PHONE}&is_active=false", headers=headers).json()

    assert default["total"] == 0
    assert asked["total"] == 1
    assert [row["id"] for row in asked["items"]] == [str(dormant.id)]


# --- REQ-032.4: the by-id shape --------------------------------------------------------------


def test_get_by_id_nests_homes_and_children(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    child = _make_child(db, guardians=[client])

    body = api.get(f"/api/clients/{client.id}", headers=_auth(admin)).json()

    assert body["id"] == str(client.id)
    assert body["homes"] == [
        {
            "id": str(home.id),
            "label": "Mum's",
            "address": "123 Main St",
            "access_code": "1234",
            "is_active": True,
        }
    ]
    assert body["children"] == [
        {
            "id": str(child.id),
            "name": "Tommy Doe",
            "age": 12,
            "grade_level": 7,
            "school_name": "Lincoln Middle School",
        }
    ]


def test_a_child_with_two_guardians_appears_under_both(api: TestClient, db: Session) -> None:
    """The separated-guardians case the schema exists for: neither parent loses the child."""
    admin = _make_user(db)
    mother = _make_client(db, name="Jane Doe", phone_number=PHONE)
    father = _make_client(db, name="John Doe", phone_number=OTHER_PHONE)
    child = _make_child(db, guardians=[mother, father])
    headers = _auth(admin)

    hers = api.get(f"/api/clients/{mother.id}", headers=headers).json()
    his = api.get(f"/api/clients/{father.id}", headers=headers).json()

    assert [row["id"] for row in hers["children"]] == [str(child.id)]
    assert [row["id"] for row in his["children"]] == [str(child.id)]


def test_a_deactivated_client_is_still_readable_by_id(api: TestClient, db: Session) -> None:
    """A 404 would make a soft delete indistinguishable from a hard one, and `is_active` is on
    the body because the bot's documented 409 recovery has to decide whether to reactivate."""
    admin = _make_user(db)
    dormant = _make_client(db, is_active=False)

    response = api.get(f"/api/clients/{dormant.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_an_unknown_client_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/clients/{uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json()["detail"] == "Client not found"


# --- REQ-032.5-.6, .10: creating a client ----------------------------------------------------


def test_post_creates_the_client_and_normalises_the_number(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/clients",
        headers=_auth(admin),
        json={"name": "Jane Doe", "phone_number": "(202) 555-0123"},
    )

    assert response.status_code == 201
    assert response.json()["phone_number"] == PHONE
    assert response.json()["is_active"] is True
    stored = db.scalars(select(Guardian).where(Guardian.phone_number == PHONE)).one()
    assert stored.name == "Jane Doe"


def test_post_with_a_home_creates_the_home_and_the_link(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.post(
        "/api/clients",
        headers=_auth(admin),
        json={
            "name": "Jane Doe",
            "phone_number": PHONE,
            "home": {"label": "Mum's", "address": "123 Main St", "access_code": "1234"},
        },
    ).json()

    client_id = uuid.UUID(body["id"])
    links = db.scalars(select(GuardianHome).where(GuardianHome.guardian_id == client_id)).all()
    assert len(links) == 1
    assert body["homes"] == [
        {
            "id": str(links[0].home_id),
            "label": "Mum's",
            "address": "123 Main St",
            "access_code": "1234",
            "is_active": True,
        }
    ]


def test_post_without_a_home_creates_neither_row(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.post(
        "/api/clients", headers=_auth(admin), json={"name": "Jane Doe", "phone_number": PHONE}
    ).json()

    client_id = uuid.UUID(body["id"])
    assert body["homes"] == []
    assert db.scalars(select(Home)).all() == []
    assert db.scalars(select(GuardianHome).where(GuardianHome.guardian_id == client_id)).all() == []


@pytest.mark.parametrize("is_active", [True, False])
def test_post_is_never_an_upsert(api: TestClient, db: Session, is_active: bool) -> None:
    """Active or deactivated, the number is taken. Upserting here would overwrite a real
    guardian's name with whatever was just typed into WhatsApp."""
    admin = _make_user(db)
    existing = _make_client(db, name="Jane Doe", phone_number=PHONE, is_active=is_active)

    response = api.post(
        "/api/clients",
        headers=_auth(admin),
        json={"name": "Someone Else", "phone_number": "202-555-0123"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == PHONE_TAKEN_ERROR
    db.refresh(existing)
    assert existing.name == "Jane Doe"
    assert len(db.scalars(select(Guardian).where(Guardian.phone_number == PHONE)).all()) == 1


def test_the_constraint_answers_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-check produces the message; the constraint is what survives a race.

    Stubbing the pre-check out is how the second layer becomes reachable at all — under two
    real concurrent requests it is the database that answers, and there is no way to stage that
    against a harness whose requests share one `Session`. Without the stub this assertion would
    still pass with the constraint dropped.
    """
    admin = _make_user(db)
    payload = {"name": "Jane Doe", "phone_number": PHONE}
    assert api.post("/api/clients", json=payload, headers=_auth(admin)).status_code == 201

    monkeypatch.setattr(client_service, "_phone_number_taken", lambda *_, **__: False)

    response = api.post("/api/clients", json=payload, headers=_auth(admin))

    assert response.status_code == 409
    assert response.json()["detail"] == PHONE_TAKEN_ERROR
    # The savepoint's whole purpose: the session is still usable afterwards.
    assert api.get("/api/clients", headers=_auth(admin)).status_code == 200


@pytest.mark.parametrize("raw", ["banana", "", "+15551234567", "12345"])
def test_post_with_an_unusable_phone_number_is_400(api: TestClient, db: Session, raw: str) -> None:
    """Unparseable and parseable-but-not-dialable both fail: `+15551234567` has a valid shape
    and no such NANP area code, and writing it would put a number nobody can call in a UNIQUE
    column."""
    admin = _make_user(db)

    response = api.post(
        "/api/clients", headers=_auth(admin), json={"name": "Jane Doe", "phone_number": raw}
    )

    assert response.status_code == 400
    assert "phone_number" in response.json()["detail"]
    assert db.scalars(select(Guardian)).all() == []


# --- REQ-032.7-.9: updating a client ---------------------------------------------------------


def test_patch_updates_the_name(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = api.patch(
        f"/api/clients/{client.id}", headers=_auth(admin), json={"name": "Jane Roe"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Jane Roe"


@pytest.mark.parametrize("echoed", [PHONE, "202-555-0123", "+1 (202) 555-0123"])
def test_patch_echoing_the_clients_own_number_is_a_200_no_op(
    api: TestClient, db: Session, echoed: str
) -> None:
    """The contract's "another client" excludes this one. A name-only PATCH that sends the
    existing number back — in any format, since both sides are normalised — must not conflict
    with itself."""
    admin = _make_user(db)
    client = _make_client(db, phone_number=PHONE)

    response = api.patch(
        f"/api/clients/{client.id}",
        headers=_auth(admin),
        json={"name": "Jane Roe", "phone_number": echoed},
    )

    assert response.status_code == 200
    assert response.json()["phone_number"] == PHONE
    assert response.json()["name"] == "Jane Roe"


@pytest.mark.parametrize("is_active", [True, False])
def test_patch_to_another_clients_number_is_the_same_409(
    api: TestClient, db: Session, is_active: bool
) -> None:
    admin = _make_user(db)
    client = _make_client(db, name="Jane Doe", phone_number=PHONE)
    _make_client(db, name="John Doe", phone_number=OTHER_PHONE, is_active=is_active)

    response = api.patch(
        f"/api/clients/{client.id}",
        headers=_auth(admin),
        json={"phone_number": "202-555-0187"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == PHONE_TAKEN_ERROR
    db.refresh(client)
    assert client.phone_number == PHONE


def test_the_constraint_answers_a_patch_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The `POST` sibling above, on the update path — a `PATCH` racing a `POST` onto the same
    number loses to the constraint, and a 500 there would be the bot's retry storm."""
    admin = _make_user(db)
    _make_client(db, name="Jane Doe", phone_number=PHONE)
    client = _make_client(db, name="John Doe", phone_number=OTHER_PHONE)

    monkeypatch.setattr(client_service, "_phone_number_taken", lambda *_, **__: False)

    response = api.patch(
        f"/api/clients/{client.id}", headers=_auth(admin), json={"phone_number": PHONE}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == PHONE_TAKEN_ERROR
    # The savepoint's whole purpose: the session is still usable afterwards.
    assert api.get("/api/clients", headers=_auth(admin)).status_code == 200


def test_patching_the_phone_number_moves_that_column_and_nothing_else(
    api: TestClient, db: Session
) -> None:
    """REQ-032.8. Phase 7's `conversations` row stays on the number the thread was held with;
    when that table exists, this test is what stops it being re-pointed here."""
    admin = _make_user(db)
    client = _make_client(db, name="Jane Doe", phone_number=PHONE)
    home = _make_home(db, client=client)
    child = _make_child(db, guardians=[client])

    body = api.patch(
        f"/api/clients/{client.id}", headers=_auth(admin), json={"phone_number": OTHER_PHONE}
    ).json()

    assert body["phone_number"] == OTHER_PHONE
    assert body["name"] == "Jane Doe"
    assert [row["id"] for row in body["homes"]] == [str(home.id)]
    assert [row["id"] for row in body["children"]] == [str(child.id)]


def test_patch_deactivates_and_reactivates(api: TestClient, db: Session) -> None:
    """The only deactivation path there is — REQ-032.9, and why there is no DELETE."""
    admin = _make_user(db)
    client = _make_client(db)
    headers = _auth(admin)

    deactivated = api.patch(f"/api/clients/{client.id}", headers=headers, json={"is_active": False})
    listed_while_dormant = api.get("/api/clients", headers=headers).json()
    reactivated = api.patch(f"/api/clients/{client.id}", headers=headers, json={"is_active": True})

    assert deactivated.json()["is_active"] is False
    assert listed_while_dormant["total"] == 0
    assert reactivated.json()["is_active"] is True
    assert api.get("/api/clients", headers=headers).json()["total"] == 1


def test_delete_is_not_offered(api: TestClient, db: Session) -> None:
    """Deactivation is `PATCH {"is_active": false}`; the frozen contract lists no DELETE."""
    admin = _make_user(db)
    client = _make_client(db)

    response = api.delete(f"/api/clients/{client.id}", headers=_auth(admin))

    assert response.status_code == 405


def test_patching_an_unknown_client_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/clients/{uuid.uuid4()}", headers=_auth(admin), json={"name": "Nobody"}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Client not found"
