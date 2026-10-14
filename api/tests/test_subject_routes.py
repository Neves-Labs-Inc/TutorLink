"""`/api/subjects` — REQ-031, the correlated-subquery `tutor_count` and the page envelope."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.schemas.common import MAX_PAGE_SIZE
from app.security import create_access_token, hash_password
from app.services import subject_service

PASSWORD = "correct horse battery staple"


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=role,
        is_archived=False,
    )
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _make_subject(
    db: Session, *, name: str | None = None, is_archived: bool = False, name_es: str | None = None
) -> Subject:
    subject = Subject(
        name=name or f"Subject {uuid.uuid4().hex[:12]}", name_es=name_es, is_archived=is_archived
    )
    db.add(subject)
    db.flush()
    return subject


def _make_tutor(db: Session, *, is_archived: bool = False) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(
            email=f"tutor-{suffix}@example.com",
            name=f"Tutor {suffix}",
            role=UserRole.TUTOR,
            is_archived=is_archived,
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _assign(db: Session, *, tutor: Tutor, subject: Subject, max_grade_level: int = 12) -> None:
    db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=max_grade_level))
    db.flush()


# --- the envelope and the RBAC gate ---------------------------------------------------------


def test_list_returns_the_page_envelope_never_a_bare_array(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_subject(db)

    body = api.get("/api/subjects", headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_total_counts_subjects_not_returned_rows(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    for _ in range(5):
        _make_subject(db)

    body = api.get("/api/subjects?page_size=2", headers=_auth(admin)).json()

    assert len(body["items"]) == 2
    assert body["total"] == 5
    assert body["page_size"] == 2


def test_deactivated_subjects_are_hidden_until_asked_for(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    dormant = _make_subject(db, is_archived=True)
    headers = _auth(admin)

    default = api.get("/api/subjects", headers=headers).json()
    asked = api.get("/api/subjects?is_active=false", headers=headers).json()

    assert dormant.name not in [row["name"] for row in default["items"]]
    assert [row["name"] for row in asked["items"]] == [dormant.name]


def test_malformed_is_active_query_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/subjects?is_active=maybe", headers=_auth(admin))

    assert response.status_code == 400
    assert "is_active" in response.json()["detail"]


def test_a_tutor_may_read_the_list(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db).user
    tutor.hashed_password = hash_password(PASSWORD)
    db.flush()
    _make_subject(db)

    response = api.get("/api/subjects", headers=_auth(tutor))

    assert response.status_code == 200
    assert "tutor_count" in response.json()["items"][0]


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
def test_a_tutor_is_refused_every_write(api: TestClient, db: Session, method: str) -> None:
    tutor = _make_tutor(db).user
    tutor.hashed_password = hash_password(PASSWORD)
    db.flush()
    subject = _make_subject(db)
    headers = _auth(tutor)

    if method == "post":
        response = api.post("/api/subjects", headers=headers, json={"name": "New"})
    elif method == "patch":
        response = api.patch(
            f"/api/subjects/{subject.id}", headers=headers, json={"name": "Renamed"}
        )
    else:
        response = api.delete(f"/api/subjects/{subject.id}", headers=headers)

    assert response.status_code == 403


def test_no_token_is_401_not_403(api: TestClient) -> None:
    response = api.get("/api/subjects")

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_a_developer_token_reaches_every_write_route(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    headers = _auth(developer)

    created = api.post("/api/subjects", headers=headers, json={"name": "Physics"})
    subject_id = created.json()["id"]
    updated = api.patch(
        f"/api/subjects/{subject_id}", headers=headers, json={"description": "core"}
    )
    deleted = api.delete(f"/api/subjects/{subject_id}", headers=headers)

    assert created.status_code == 201
    assert updated.status_code == 200
    assert deleted.status_code == 200


# --- REQ-031.2/.3: `tutor_count` -------------------------------------------------------------


def test_tutor_count_counts_only_active_tutors(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)
    _assign(db, tutor=_make_tutor(db), subject=subject)
    _assign(db, tutor=_make_tutor(db), subject=subject)
    _assign(db, tutor=_make_tutor(db, is_archived=True), subject=subject)

    body = api.get("/api/subjects", headers=_auth(admin)).json()

    assert body["items"][0]["tutor_count"] == 2


def test_tutor_count_ignores_max_grade_level(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)
    _assign(db, tutor=_make_tutor(db), subject=subject, max_grade_level=1)

    body = api.get("/api/subjects", headers=_auth(admin)).json()

    assert body["items"][0]["tutor_count"] == 1


def test_tutor_count_is_zero_and_present_with_no_assignments(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_subject(db)

    body = api.get("/api/subjects", headers=_auth(admin)).json()

    assert body["items"][0]["tutor_count"] == 0


def test_a_deactivated_subject_still_reports_its_real_tutor_count(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)
    _assign(db, tutor=_make_tutor(db), subject=subject)
    headers = _auth(admin)

    api.delete(f"/api/subjects/{subject.id}", headers=headers)
    body = api.get("/api/subjects?is_active=false", headers=headers).json()

    assert body["items"][0]["tutor_count"] == 1


def test_total_is_a_count_of_subjects_when_several_tutors_are_assigned(
    api: TestClient, db: Session
) -> None:
    """The join-row regression test: a `LEFT JOIN` would inflate `total` to a count of rows in
    the join, one per tutor assignment, rather than one per subject."""
    admin = _make_user(db)
    subject = _make_subject(db)
    _assign(db, tutor=_make_tutor(db), subject=subject)
    _assign(db, tutor=_make_tutor(db), subject=subject)
    _assign(db, tutor=_make_tutor(db), subject=subject)

    body = api.get("/api/subjects", headers=_auth(admin)).json()

    assert body["total"] == 1


# --- REQ-031.5/.6: duplicate names and soft delete -------------------------------------------


def test_post_duplicate_name_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_subject(db, name="Math")

    response = api.post("/api/subjects", headers=_auth(admin), json={"name": "Math"})

    assert response.status_code == 409
    assert response.json()["detail"] == "A subject with that name already exists"


def test_patch_to_a_taken_name_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_subject(db, name="Math")
    other = _make_subject(db, name="Science")

    response = api.patch(f"/api/subjects/{other.id}", headers=_auth(admin), json={"name": "Math"})

    assert response.status_code == 409


def test_patch_echoing_a_subjects_own_name_back_is_not_a_self_conflict(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name="Math")

    response = api.patch(f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name": "Math"})

    assert response.status_code == 200


def test_the_constraint_answers_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = _make_user(db)
    _make_subject(db, name="Math")
    headers = _auth(admin)

    monkeypatch.setattr(subject_service, "_name_taken", lambda *_, **__: False)

    response = api.post("/api/subjects", headers=headers, json={"name": "Math"})

    assert response.status_code == 409
    assert response.json()["detail"] == "A subject with that name already exists"
    assert api.get("/api/subjects", headers=headers).status_code == 200


def test_the_constraint_answers_a_patch_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The `POST` sibling above, on the update path — a `PATCH` racing a `POST` onto the same
    name loses to the constraint, and the savepoint has to unwind the edit it was refused."""
    admin = _make_user(db)
    _make_subject(db, name="Math")
    other = _make_subject(db, name="Science")
    headers = _auth(admin)

    monkeypatch.setattr(subject_service, "_name_taken", lambda *_, **__: False)

    response = api.patch(f"/api/subjects/{other.id}", headers=headers, json={"name": "Math"})

    assert response.status_code == 409
    assert response.json()["detail"] == "A subject with that name already exists"
    # The savepoint's whole purpose: the session is still usable afterwards.
    assert api.get("/api/subjects", headers=headers).status_code == 200


def test_post_a_case_variant_of_a_taken_name_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_subject(db, name="Biology")

    response = api.post("/api/subjects", headers=_auth(admin), json={"name": "biology"})

    assert response.status_code == 409
    assert response.json()["detail"] == "A subject with that name already exists"


def test_patch_to_a_padded_case_variant_of_a_taken_name_is_409(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_subject(db, name="Biology")
    other = _make_subject(db, name="Science")

    response = api.patch(
        f"/api/subjects/{other.id}", headers=_auth(admin), json={"name": " BIOLOGY "}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A subject with that name already exists"


def test_renaming_a_subject_to_a_case_variant_of_its_own_name_succeeds(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name="Biology")

    response = api.patch(
        f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name": "biology"}
    )

    assert (response.status_code, response.json()["name"]) == (200, "biology")


def test_the_constraint_answers_a_case_variant_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = _make_user(db)
    _make_subject(db, name="Biology")
    headers = _auth(admin)

    monkeypatch.setattr(subject_service, "_name_taken", lambda *_, **__: False)

    response = api.post("/api/subjects", headers=headers, json={"name": "BIOLOGY"})

    assert response.status_code == 409
    assert response.json()["detail"] == "A subject with that name already exists"
    assert api.get("/api/subjects", headers=headers).status_code == 200


def test_delete_sets_is_active_false_and_the_row_survives(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)

    response = api.delete(f"/api/subjects/{subject.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert db.get(Subject, subject.id) is not None


def test_unknown_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/subjects/{uuid.uuid4()}", headers=_auth(admin), json={"name": "Anything"}
    )

    assert response.status_code == 404


# --- name_es: the Spanish name ------------------------------------------------------------------

SPANISH_NAME = "Matemáticas"
MAX_SPANISH_NAME_LENGTH = 128
# The Display name's rule: the bot sends this name to Guardians, so it may carry no control,
# invisible or line-separator character. NUL in particular must be a 4xx, not a 500 at flush.
HIDDEN_CHARACTER_NAMES = {
    "nul": "Mate\x00máticas",
    "newline": "Mate\nmáticas",
    "zero-width space": "Mate​máticas",
    "bidi override": "Mate‮máticas",
    "line separator": "Mate máticas",
    "paragraph separator": "Mate máticas",
}


@pytest.mark.parametrize("name_es", HIDDEN_CHARACTER_NAMES.values(), ids=HIDDEN_CHARACTER_NAMES)
def test_a_spanish_name_with_hidden_characters_is_400_on_create(
    api: TestClient, db: Session, name_es: str
) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/subjects",
        headers=_auth(admin),
        json={"name": f"Math {uuid.uuid4().hex[:8]}", "name_es": name_es},
    )

    assert response.status_code == 400
    assert "control or invisible characters" in response.json()["detail"]


@pytest.mark.parametrize("name_es", HIDDEN_CHARACTER_NAMES.values(), ids=HIDDEN_CHARACTER_NAMES)
def test_a_spanish_name_with_hidden_characters_is_400_on_update_and_changes_nothing(
    api: TestClient, db: Session, name_es: str
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name_es=SPANISH_NAME)

    response = api.patch(
        f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name_es": name_es}
    )

    assert response.status_code == 400
    db.refresh(subject)
    assert subject.name_es == SPANISH_NAME


def test_a_run_of_spaces_inside_the_spanish_name_is_stored_as_one(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)

    response = api.patch(
        f"/api/subjects/{subject.id}",
        headers=_auth(admin),
        json={"name_es": "  Ciencias      Naturales "},
    )

    assert response.json()["name_es"] == "Ciencias Naturales"


def test_a_subject_is_created_with_its_spanish_name_trimmed(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/subjects",
        headers=_auth(admin),
        json={"name": f"Math {uuid.uuid4().hex[:8]}", "name_es": f"  {SPANISH_NAME} "},
    )

    assert (response.status_code, response.json()["name_es"]) == (201, SPANISH_NAME)


def test_a_subject_created_without_a_spanish_name_reads_null(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/subjects", headers=_auth(admin), json={"name": f"Math {uuid.uuid4().hex[:8]}"}
    )

    assert (response.status_code, response.json()["name_es"]) == (201, None)


def test_a_manager_sets_the_spanish_name_and_the_list_reads_it(
    api: TestClient, db: Session
) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    # Sorts early, so the first page holds it whatever else the test database carries.
    subject = _make_subject(db, name=f"Aaa {uuid.uuid4().hex[:8]}")

    response = api.patch(
        f"/api/subjects/{subject.id}", headers=_auth(manager), json={"name_es": SPANISH_NAME}
    )
    listed = api.get(
        "/api/subjects", headers=_auth(manager), params={"page_size": MAX_PAGE_SIZE}
    ).json()["items"]

    assert (response.status_code, response.json()["name_es"]) == (200, SPANISH_NAME)
    assert {item["id"]: item["name_es"] for item in listed}[str(subject.id)] == SPANISH_NAME


@pytest.mark.parametrize("cleared", [None, "", "   "], ids=["null", "empty", "blank"])
def test_a_null_or_blank_spanish_name_clears_it(
    api: TestClient, db: Session, cleared: str | None
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name_es=SPANISH_NAME)

    response = api.patch(
        f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name_es": cleared}
    )

    assert (response.status_code, response.json()["name_es"]) == (200, None)
    db.refresh(subject)
    assert subject.name_es is None


def test_a_patch_that_omits_the_spanish_name_keeps_it(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name_es=SPANISH_NAME)

    response = api.patch(
        f"/api/subjects/{subject.id}", headers=_auth(admin), json={"description": "Numbers"}
    )

    assert response.json()["name_es"] == SPANISH_NAME


def test_a_spanish_name_over_128_characters_is_400_on_create(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/subjects",
        headers=_auth(admin),
        json={
            "name": f"Math {uuid.uuid4().hex[:8]}",
            "name_es": "x" * (MAX_SPANISH_NAME_LENGTH + 1),
        },
    )

    assert response.status_code == 400


def test_a_spanish_name_over_128_characters_is_400_on_update(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name_es=SPANISH_NAME)

    response = api.patch(
        f"/api/subjects/{subject.id}",
        headers=_auth(admin),
        json={"name_es": "x" * (MAX_SPANISH_NAME_LENGTH + 1)},
    )

    assert response.status_code == 400
    db.refresh(subject)
    assert subject.name_es == SPANISH_NAME


# --- name: normalized and never blank ----------------------------------------------------------

NORMALIZED_NAMES = {
    "padded": (" Biology ", "Biology"),
    "newline": ("Bio\nlogy", "Bio logy"),
    "zero-width space": ("Bio\u200blogy", "Biology"),
    "tab and line separator": ("Marine\t\u2028Biology", "Marine Biology"),
}
BLANK_NAMES = {
    "spaces": "   ",
    "invisible only": "\u200b\u200e\x00",
    "line breaks": "\n\r\n",
}


@pytest.mark.parametrize(("raw", "stored"), NORMALIZED_NAMES.values(), ids=NORMALIZED_NAMES)
def test_a_subject_name_is_stored_normalized(
    api: TestClient, db: Session, raw: str, stored: str
) -> None:
    admin = _make_user(db)

    response = api.post("/api/subjects", headers=_auth(admin), json={"name": raw})

    assert (response.status_code, response.json()["name"]) == (201, stored)
    assert db.get(Subject, uuid.UUID(response.json()["id"])).name == stored


def test_a_renamed_subject_name_is_stored_normalized(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)

    response = api.patch(
        f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name": "  Earth\n Science "}
    )

    assert (response.status_code, response.json()["name"]) == (200, "Earth Science")


@pytest.mark.parametrize("name", BLANK_NAMES.values(), ids=BLANK_NAMES)
def test_a_blank_name_is_400_on_create(api: TestClient, db: Session, name: str) -> None:
    admin = _make_user(db)

    response = api.post("/api/subjects", headers=_auth(admin), json={"name": name})

    assert response.status_code == 400
    assert response.json()["detail"].startswith("name:")


@pytest.mark.parametrize("name", BLANK_NAMES.values(), ids=BLANK_NAMES)
def test_a_blank_name_is_400_on_update_and_changes_nothing(
    api: TestClient, db: Session, name: str
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name="Chemistry")

    response = api.patch(f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name": name})

    assert response.status_code == 400
    assert response.json()["detail"].startswith("name:")
    db.refresh(subject)
    assert subject.name == "Chemistry"


def test_a_null_name_on_update_keeps_the_current_name(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name="Chemistry")

    response = api.patch(f"/api/subjects/{subject.id}", headers=_auth(admin), json={"name": None})

    assert (response.status_code, response.json()["name"]) == (200, "Chemistry")


MAX_NAME_LENGTH = 128


def test_a_name_over_128_characters_is_400_on_create(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/subjects", headers=_auth(admin), json={"name": "a" * (MAX_NAME_LENGTH + 1)}
    )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("name:")


def test_a_name_over_128_characters_is_400_on_update_and_changes_nothing(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db, name="Chemistry")

    response = api.patch(
        f"/api/subjects/{subject.id}",
        headers=_auth(admin),
        json={"name": "a" * (MAX_NAME_LENGTH + 1)},
    )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("name:")
    db.refresh(subject)
    assert subject.name == "Chemistry"


def test_padding_around_a_128_character_name_does_not_count_toward_the_limit(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    name = "a" * MAX_NAME_LENGTH

    response = api.post("/api/subjects", headers=_auth(admin), json={"name": f"  {name}\u200b  "})

    assert (response.status_code, response.json()["name"]) == (201, name)
