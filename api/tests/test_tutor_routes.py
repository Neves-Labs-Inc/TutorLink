"""`/api/tutors` over HTTP — REQ-035, and the phase's authorisation showpiece.

Two auth shapes on one resource, and most of what is below exists to keep them apart.
`GET /api/tutors` **lists**, so it takes `TutorScope` and a tutor sees exactly one row — their
own. `GET /api/tutors/{id}` **loads one row by id**, so it takes `Principal` and calls
`assert_can_access_tutor` with the *path* id before the row is read: a tutor reaching for
another tutor's id, or for an id that does not exist at all, gets **403 — never 404, and never
an empty 200** (`CONSTITUTION.md:15`). A 404 there would answer the question of whether the id
exists, which is the disclosure the ordering exists to prevent.

`?grade_level=` is a **ceiling** comparison against `tutor_subjects.max_grade_level`, never a
membership test, and `total` counts tutors rather than assignment rows. Both are ways the
filter can look right against a one-subject fixture and be wrong against a real one, so the
fixtures here deliberately carry over-qualified tutors and tutors holding several subjects.

Every phone number comes from the reserved `202-555-01xx` range, per `03-RESEARCH.md`'s
normative fixture table. `normalize_phone_number` calls `phonenumbers.is_valid_number`, so
`555-123-4567` — and `+1987654321`, which `docs/api-design.md`'s own Tutors examples use — is a
400 in this system by design. `_phone_number` hands out `0100`…`0179`; a test needing a literal
takes one from `0180`…`0199`, which the generator never reaches.
"""

import itertools
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services import tutor_service

PASSWORD = "correct horse battery staple"
ALLOWED_FAILURE_CODES = frozenset({400, 401, 403, 404, 409})

_serials = itertools.count()


def _phone_number() -> str:
    return f"+1202555{100 + next(_serials) % 80:04d}"


def _make_user(
    db: Session,
    *,
    role: UserRole = UserRole.ADMIN,
    tutor_id: uuid.UUID | None = None,
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


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _make_tutor(
    db: Session,
    *,
    name: str | None = None,
    phone_number: str | None = None,
    is_active: bool = True,
) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=name or f"Tutor {suffix}",
        phone_number=phone_number or _phone_number(),
        email=f"tutor-{suffix}@example.com",
        is_active=is_active,
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_subject(db: Session, *, name: str | None = None) -> Subject:
    subject = Subject(name=name or f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()
    return subject


def _assign(db: Session, tutor: Tutor, subject: Subject, max_grade_level: int) -> TutorSubject:
    assignment = TutorSubject(
        tutor_id=tutor.id, subject_id=subject.id, max_grade_level=max_grade_level
    )
    db.add(assignment)
    db.flush()
    return assignment


def _payload(**overrides: object) -> dict[str, object]:
    suffix = uuid.uuid4().hex[:12]
    body: dict[str, object] = {
        "name": f"Tutor {suffix}",
        "email": f"tutor-{suffix}@example.com",
        "phone_number": _phone_number(),
    }
    body.update(overrides)
    return body


def _ids(body: dict[str, Any]) -> list[str]:
    return [str(row["id"]) for row in body["items"]]


# --- the envelope, soft delete, and the 400-not-422 rule -------------------------------------


def test_list_returns_the_page_envelope_never_a_bare_array(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_tutor(db)

    body = api.get("/api/tutors", headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_total_counts_matches_not_returned_rows(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    for _ in range(5):
        _make_tutor(db)

    body = api.get("/api/tutors?page_size=2", headers=_auth(admin)).json()

    assert len(body["items"]) == 2
    assert body["total"] == 5
    assert body["page_size"] == 2


def test_deactivated_tutors_are_hidden_until_asked_for(api: TestClient, db: Session) -> None:
    """`is_active` is one state or the other and never both — there is no "all" value."""
    admin = _make_user(db)
    live = _make_tutor(db)
    dormant = _make_tutor(db, is_active=False)
    headers = _auth(admin)

    default = api.get("/api/tutors", headers=headers).json()
    asked = api.get("/api/tutors?is_active=false", headers=headers).json()

    assert _ids(default) == [str(live.id)]
    assert _ids(asked) == [str(dormant.id)]


def test_total_respects_the_is_active_filter_even_when_the_page_truncates(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_tutor(db)
    for _ in range(3):
        _make_tutor(db, is_active=False)

    asked = api.get("/api/tutors?is_active=false&page_size=1", headers=_auth(admin)).json()

    assert len(asked["items"]) == 1
    assert asked["total"] == 3


def test_paging_over_tutors_sharing_one_name_repeats_nothing_and_loses_nothing(
    api: TestClient, db: Session
) -> None:
    """`tutors.name` is not unique, so `ORDER BY name` alone leaves the tie order up to the
    plan — and `LIMIT/OFFSET` is a different plan from the unpaged scan. Without `Tutor.id` as
    the final sort key one of these namesakes can land on two pages and another on none."""
    admin = _make_user(db)
    expected = {str(_make_tutor(db, name="Sarah Miller").id) for _ in range(7)}
    headers = _auth(admin)

    paged = [
        tutor_id
        for page in (1, 2, 3)
        for tutor_id in _ids(
            api.get(f"/api/tutors?page={page}&page_size=3", headers=headers).json()
        )
    ]
    unpaged = _ids(api.get("/api/tutors?page_size=100", headers=headers).json())

    assert len(paged) == len(expected)
    assert set(paged) == expected
    assert paged == unpaged


def test_a_deactivated_tutor_is_still_readable_by_id(api: TestClient, db: Session) -> None:
    """The by-id path takes no `?is_active` and deliberately does not filter: the surface that
    deactivated a row has to be able to open it in order to reactivate it."""
    admin = _make_user(db)
    dormant = _make_tutor(db, is_active=False)

    response = api.get(f"/api/tutors/{dormant.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["is_active"] is False


@pytest.mark.parametrize(
    ("query", "field"),
    [
        ("is_active=maybe", "is_active"),
        ("grade_level=eight", "grade_level"),
        ("subject_id=not-a-uuid", "subject_id"),
        ("page=0", "page"),
        ("page_size=101", "page_size"),
    ],
)
def test_a_malformed_query_parameter_is_400_never_422(
    api: TestClient, db: Session, query: str, field: str
) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/tutors?{query}", headers=_auth(admin))

    assert response.status_code == 400
    assert field in response.json()["detail"]


def test_a_missing_body_field_is_400_never_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post("/api/tutors", headers=_auth(admin), json={"name": "Nameless"})

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


# --- the scope split: a list is filtered, a row by id is checked ------------------------------


def test_a_tutor_listing_sees_only_their_own_profile(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    for _ in range(3):
        _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    body = api.get("/api/tutors", headers=_auth(tutor_user)).json()

    assert body["total"] == 1
    assert _ids(body) == [str(own.id)]


def test_a_tutor_asking_the_list_for_another_tutor_is_403(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    other = _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.get(f"/api/tutors?tutor_id={other.id}", headers=_auth(tutor_user))

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


def test_a_tutor_asking_the_list_for_their_own_id_is_allowed(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    body = api.get(f"/api/tutors?tutor_id={own.id}", headers=_auth(tutor_user)).json()

    assert _ids(body) == [str(own.id)]


def test_a_tutor_reads_their_own_profile_by_id(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.get(f"/api/tutors/{own.id}", headers=_auth(tutor_user))

    assert response.status_code == 200
    assert response.json()["id"] == str(own.id)


def test_a_tutor_reading_another_tutors_id_is_403_never_404_and_never_empty(
    api: TestClient, db: Session
) -> None:
    own = _make_tutor(db)
    other = _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.get(f"/api/tutors/{other.id}", headers=_auth(tutor_user))

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


def test_a_tutor_reading_an_id_that_does_not_exist_is_403_not_404(
    api: TestClient, db: Session
) -> None:
    """The ordering inside the route is the whole point: `assert_can_access_tutor` runs on the
    path id before the row is loaded, so the answer cannot disclose whether the id exists. A
    load-then-check route answers 404 here and leaks exactly that."""
    own = _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.get(f"/api/tutors/{uuid.uuid4()}", headers=_auth(tutor_user))

    assert response.status_code == 403


def test_an_admin_reading_an_id_that_does_not_exist_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/tutors/{uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json()["detail"] == "Tutor not found"


def test_a_tutor_account_without_a_profile_is_refused(api: TestClient, db: Session) -> None:
    """`users.tutor_id` is NULL because admins have no profile; a *tutor* in that state is a
    data error, and `dependencies.py:217-218` refuses rather than scoping to NULL."""
    orphan = _make_user(db, role=UserRole.TUTOR, tutor_id=None)
    profile = _make_tutor(db)
    headers = _auth(orphan)

    listed = api.get("/api/tutors", headers=headers)
    read = api.get(f"/api/tutors/{profile.id}", headers=headers)

    assert listed.status_code == 403
    assert read.status_code == 403


def test_no_tutor_token_request_reaches_the_unapplied_scope_guard(
    api: TestClient, db: Session
) -> None:
    """The `TutorScopeNotApplied` regression, which is a 500 and only fires on a tutor-scoped
    request that actually queries a tutor-owned table — hence the data present here."""
    own = _make_tutor(db)
    other = _make_tutor(db)
    subject = _make_subject(db)
    _assign(db, own, subject, 8)
    _assign(db, other, subject, 12)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)
    headers = _auth(tutor_user)

    statuses = [
        api.get("/api/tutors", headers=headers).status_code,
        api.get(f"/api/tutors?subject_id={subject.id}&grade_level=8", headers=headers).status_code,
        api.get(f"/api/tutors?tutor_id={own.id}", headers=headers).status_code,
        api.get("/api/tutors?is_active=false", headers=headers).status_code,
        api.get(f"/api/tutors/{own.id}", headers=headers).status_code,
        api.get(f"/api/tutors/{other.id}", headers=headers).status_code,
        api.post("/api/tutors", headers=headers, json=_payload()).status_code,
        api.patch(f"/api/tutors/{own.id}", headers=headers, json={"bio": "self-serve"}).status_code,
        api.delete(f"/api/tutors/{own.id}", headers=headers).status_code,
    ]

    assert statuses == [200, 200, 200, 200, 200, 403, 403, 403, 403]


def test_no_failure_escapes_the_agreed_status_codes(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    profile = _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=profile.id)

    responses = [
        api.get("/api/tutors"),
        api.get("/api/tutors?is_active=maybe", headers=_auth(admin)),
        api.get(f"/api/tutors/{uuid.uuid4()}", headers=_auth(admin)),
        api.get(f"/api/tutors/{uuid.uuid4()}", headers=_auth(tutor_user)),
        api.post("/api/tutors", headers=_auth(admin), json=_payload(phone_number="12345")),
        api.post("/api/tutors", headers=_auth(admin), json=_payload(email=profile.email)),
        api.post("/api/tutors", headers=_auth(tutor_user), json=_payload()),
        api.patch(f"/api/tutors/{uuid.uuid4()}", headers=_auth(admin), json={"bio": "x"}),
        api.delete(f"/api/tutors/{uuid.uuid4()}", headers=_auth(admin)),
    ]

    assert {response.status_code for response in responses} <= ALLOWED_FAILURE_CODES
    assert all(isinstance(response.json()["detail"], str) for response in responses)


# --- the grade filter is a ceiling, and `total` counts tutors ---------------------------------


def test_grade_level_is_a_ceiling_not_a_membership_test(api: TestClient, db: Session) -> None:
    """A ceiling of 12 covers grade 8. An `== grade_level` implementation passes an
    exact-match fixture and silently excludes every over-qualified tutor."""
    admin = _make_user(db)
    subject = _make_subject(db)
    exactly = _make_tutor(db, name="Exactly Eight")
    above = _make_tutor(db, name="Up To Twelve")
    below = _make_tutor(db, name="Only To Seven")
    _assign(db, exactly, subject, 8)
    _assign(db, above, subject, 12)
    _assign(db, below, subject, 7)

    body = api.get("/api/tutors?grade_level=8", headers=_auth(admin)).json()

    assert set(_ids(body)) == {str(exactly.id), str(above.id)}
    assert body["total"] == 2


@pytest.mark.parametrize("grade_level", ["0", "-1", "-12"])
def test_grade_level_below_one_is_400_not_the_whole_roster(
    api: TestClient, db: Session, grade_level: str
) -> None:
    """`max_grade_level >= 0` is true of every assignment, so an unbounded parameter turns the
    filter into "list everyone". `TutorSubjectCreate` already carries `Field(ge=1)`; this is
    the same floor on the read side."""
    admin = _make_user(db)
    tutor = _make_tutor(db)
    _assign(db, tutor, _make_subject(db), 12)

    response = api.get(f"/api/tutors?grade_level={grade_level}", headers=_auth(admin))

    assert response.status_code == 400
    assert "grade_level" in response.json()["detail"]


def test_grade_level_one_is_the_lowest_accepted_grade(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    _assign(db, tutor, _make_subject(db), 1)

    body = api.get("/api/tutors?grade_level=1", headers=_auth(admin)).json()

    assert _ids(body) == [str(tutor.id)]
    assert body["total"] == 1


def test_a_ceiling_of_eight_matches_a_request_for_grade_seven(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    _assign(db, tutor, _make_subject(db), 8)

    body = api.get("/api/tutors?grade_level=7", headers=_auth(admin)).json()

    assert _ids(body) == [str(tutor.id)]


def test_grade_level_alone_matches_any_qualifying_assignment(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    french = _make_subject(db, name="French")
    maths = _make_subject(db, name="Maths")
    qualified = _make_tutor(db)
    unqualified = _make_tutor(db)
    _assign(db, qualified, french, 4)
    _assign(db, qualified, maths, 12)
    _assign(db, unqualified, french, 4)

    body = api.get("/api/tutors?grade_level=9", headers=_auth(admin)).json()

    assert _ids(body) == [str(qualified.id)]
    assert body["total"] == 1


def test_a_tutor_with_several_qualifying_subjects_appears_once(
    api: TestClient, db: Session
) -> None:
    """The regression a `JOIN` implementation fails: three qualifying assignment rows, one
    tutor, `total: 1`. `total` counts tutors, never join rows."""
    admin = _make_user(db)
    tutor = _make_tutor(db)
    for name, ceiling in [("Algebra", 9), ("Biology", 10), ("Chemistry", 12)]:
        _assign(db, tutor, _make_subject(db, name=name), ceiling)

    body = api.get("/api/tutors?grade_level=8", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert _ids(body) == [str(tutor.id)]
    assert [row["name"] for row in body["items"][0]["subjects"]] == [
        "Algebra",
        "Biology",
        "Chemistry",
    ]


def test_subject_id_alone_matches_at_any_ceiling(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    maths = _make_subject(db, name="Maths")
    french = _make_subject(db, name="French")
    low = _make_tutor(db)
    high = _make_tutor(db)
    elsewhere = _make_tutor(db)
    _assign(db, low, maths, 2)
    _assign(db, high, maths, 12)
    _assign(db, elsewhere, french, 12)

    body = api.get(f"/api/tutors?subject_id={maths.id}", headers=_auth(admin)).json()

    assert set(_ids(body)) == {str(low.id), str(high.id)}
    assert body["total"] == 2


def test_subject_id_and_grade_level_compose(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    maths = _make_subject(db, name="Maths")
    french = _make_subject(db, name="French")
    qualified = _make_tutor(db)
    wrong_subject = _make_tutor(db)
    too_low = _make_tutor(db)
    _assign(db, qualified, maths, 12)
    _assign(db, wrong_subject, french, 12)
    _assign(db, too_low, maths, 8)

    body = api.get(f"/api/tutors?subject_id={maths.id}&grade_level=9", headers=_auth(admin)).json()

    assert _ids(body) == [str(qualified.id)]
    assert body["total"] == 1


def test_the_composed_filter_must_be_satisfied_by_one_assignment(
    api: TestClient, db: Session
) -> None:
    """Two independent predicates would match this tutor — Maths from one assignment, the
    ceiling from the other. One correlated `EXISTS` does not."""
    admin = _make_user(db)
    maths = _make_subject(db, name="Maths")
    french = _make_subject(db, name="French")
    split = _make_tutor(db)
    _assign(db, split, maths, 4)
    _assign(db, split, french, 12)

    body = api.get(f"/api/tutors?subject_id={maths.id}&grade_level=9", headers=_auth(admin)).json()

    assert body["items"] == []
    assert body["total"] == 0


def test_the_grade_filter_still_hides_deactivated_tutors(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)
    live = _make_tutor(db)
    dormant = _make_tutor(db, is_active=False)
    _assign(db, live, subject, 12)
    _assign(db, dormant, subject, 12)

    body = api.get("/api/tutors?grade_level=8", headers=_auth(admin)).json()

    assert _ids(body) == [str(live.id)]
    assert body["total"] == 1


# --- the embedded body ------------------------------------------------------------------------


def test_read_one_embeds_the_documented_subject_shape(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db, name="Algebra")
    _assign(db, tutor, subject, 8)

    body = api.get(f"/api/tutors/{tutor.id}", headers=_auth(admin)).json()

    assert body["subjects"] == [
        {"subject_id": str(subject.id), "name": "Algebra", "max_grade_level": 8}
    ]


def test_read_one_does_not_embed_availability(api: TestClient, db: Session) -> None:
    """OQ-5: `GET /api/tutors/{id}/availability` owns that item schema and lands in Phase 4, so
    this body deliberately carries no `availability` key."""
    admin = _make_user(db)
    tutor = _make_tutor(db)

    body = api.get(f"/api/tutors/{tutor.id}", headers=_auth(admin)).json()

    assert set(body) == {"id", "name", "email", "phone_number", "bio", "is_active", "subjects"}


# --- writes: normalisation, the two UNIQUE columns, and soft delete ----------------------------


def test_create_returns_201_and_canonicalises_email_and_phone(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/tutors",
        headers=_auth(admin),
        json={
            "name": "Ada Lovelace",
            "email": "  ADA@Example.COM ",
            "phone_number": "(202) 555-0187",
            "bio": "Analytical engines",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "ada@example.com"
    assert body["phone_number"] == "+12025550187"
    assert body["bio"] == "Analytical engines"
    assert body["is_active"] is True
    assert body["subjects"] == []
    assert db.get(Tutor, uuid.UUID(body["id"])) is not None


@pytest.mark.parametrize(
    "phone_number",
    ["+15551234567", "555-123-4567", "+1987654321", "12345", "not a phone", ""],
)
def test_create_rejects_a_number_that_cannot_be_dialled(
    api: TestClient, db: Session, phone_number: str
) -> None:
    """`555-123-4567` and `+1987654321` read like placeholders and are not dialable numbers.
    `docs/api-design.md` uses the latter in its Tutors examples; those bodies are illustrative
    JSON, not a validity contract, and this system refuses them."""
    admin = _make_user(db)

    response = api.post(
        "/api/tutors", headers=_auth(admin), json=_payload(phone_number=phone_number)
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("email", ["", "   ", "\t\n", "nobody-at-example.com"])
def test_create_rejects_an_email_the_shared_rule_refuses(
    api: TestClient, db: Session, email: str
) -> None:
    """`TutorCreate.email` carries the same `Email` annotation `UserCreate` does. Without it a
    blank address survives `email.strip().lower()` and lands in `UNIQUE (email)` as `''`, which
    then 409s every later blank create and can never be matched by a `users` row."""
    admin = _make_user(db)

    response = api.post("/api/tutors", headers=_auth(admin), json=_payload(email=email))

    assert response.status_code == 400
    assert "email" in response.json()["detail"]
    assert db.scalars(select(Tutor)).first() is None


@pytest.mark.parametrize("email", ["", "   ", "\t\n", "nobody-at-example.com"])
def test_patch_rejects_an_email_the_shared_rule_refuses(
    api: TestClient, db: Session, email: str
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    original = tutor.email

    response = api.patch(f"/api/tutors/{tutor.id}", headers=_auth(admin), json={"email": email})

    assert response.status_code == 400
    assert "email" in response.json()["detail"]
    db.refresh(tutor)
    assert tutor.email == original


def test_create_with_a_duplicate_email_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    existing = _make_tutor(db)

    response = api.post(
        "/api/tutors", headers=_auth(admin), json=_payload(email=existing.email.upper())
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A tutor with that email already exists"


def test_create_with_a_duplicate_phone_number_in_another_format_is_409(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_tutor(db, phone_number="+12025550182")

    response = api.post(
        "/api/tutors", headers=_auth(admin), json=_payload(phone_number="(202) 555-0182")
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A tutor with that phone number already exists"


def test_the_email_constraint_answers_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With `_email_taken` stubbed out, only `UNIQUE (email)` can produce this 409 — which is
    what the pre-check test cannot prove, since it passes with the constraint dropped. The
    final assertion is the one that distinguishes a correct `begin_nested` from a missing one:
    without the savepoint the 409 still arrives and the next statement on the session breaks.
    """
    admin = _make_user(db)
    headers = _auth(admin)
    taken = "collision@example.com"
    first = api.post(
        "/api/tutors", headers=headers, json=_payload(email=taken, phone_number="+12025550183")
    )
    assert first.status_code == 201

    monkeypatch.setattr(tutor_service, "_email_taken", lambda *_, **__: False)

    response = api.post(
        "/api/tutors", headers=headers, json=_payload(email=taken, phone_number="+12025550184")
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A tutor with that email or phone number already exists"
    assert api.get("/api/tutors", headers=headers).status_code == 200


def test_the_phone_number_constraint_answers_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The twin of the test above on the other UNIQUE column. `tutors` is the one table here
    where a single insert can violate two independent constraints, so the race path cannot know
    which collided and must not guess — hence the joint message."""
    admin = _make_user(db)
    headers = _auth(admin)
    first = api.post("/api/tutors", headers=headers, json=_payload(phone_number="+12025550188"))
    assert first.status_code == 201

    monkeypatch.setattr(tutor_service, "_phone_number_taken", lambda *_, **__: False)

    response = api.post("/api/tutors", headers=headers, json=_payload(phone_number="202-555-0188"))

    assert response.status_code == 409
    assert response.json()["detail"] == "A tutor with that email or phone number already exists"
    assert api.get("/api/tutors", headers=headers).status_code == 200


def test_patch_echoing_the_tutors_own_email_and_phone_back_is_200(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db, phone_number="+12025550185")

    response = api.patch(
        f"/api/tutors/{tutor.id}",
        headers=_auth(admin),
        json={"email": tutor.email, "phone_number": "202-555-0185", "bio": "Unchanged"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == tutor.email
    assert body["phone_number"] == "+12025550185"
    assert body["bio"] == "Unchanged"


def test_patch_taking_another_tutors_email_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    incumbent = _make_tutor(db)
    challenger = _make_tutor(db)

    response = api.patch(
        f"/api/tutors/{challenger.id}", headers=_auth(admin), json={"email": incumbent.email}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A tutor with that email already exists"


def test_the_constraint_answers_a_patch_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The two `POST` siblings above, on the update path — a `PATCH` racing a `POST` onto the
    same email loses to the constraint, and a 500 there would be the bot's retry storm. The
    final assertion is the one those tests cannot borrow: the `UPDATE` has to be issued *inside*
    the savepoint, because `begin_nested` flushes whatever is already dirty before it emits the
    SAVEPOINT, and a violation flushed outside it leaves the `Session` unusable for everything
    the request does next.
    """
    admin = _make_user(db)
    headers = _auth(admin)
    incumbent = _make_tutor(db)
    challenger = _make_tutor(db)

    monkeypatch.setattr(tutor_service, "_email_taken", lambda *_, **__: False)

    response = api.patch(
        f"/api/tutors/{challenger.id}", headers=headers, json={"email": incumbent.email}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A tutor with that email or phone number already exists"
    assert api.get("/api/tutors", headers=headers).status_code == 200


def test_patch_with_an_unparseable_phone_number_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)

    response = api.patch(
        f"/api/tutors/{tutor.id}", headers=_auth(admin), json={"phone_number": "555-123-4567"}
    )

    assert response.status_code == 400


def test_patch_can_reactivate_a_deactivated_tutor(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    dormant = _make_tutor(db, is_active=False)

    response = api.patch(
        f"/api/tutors/{dormant.id}", headers=_auth(admin), json={"is_active": True}
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is True


def test_patch_an_unknown_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/tutors/{uuid.uuid4()}", headers=_auth(admin), json={"bio": "Nobody"}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Tutor not found"


def test_delete_is_a_soft_delete_that_keeps_the_row_and_its_assignments(
    api: TestClient, db: Session
) -> None:
    """Deactivation must stay reversible, so nothing but `is_active` moves — `tutor_count` on
    `GET /api/subjects` already accounts for it (REQ-031.3)."""
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db, name="Algebra")
    _assign(db, tutor, subject, 8)

    response = api.delete(f"/api/tutors/{tutor.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert [row["name"] for row in response.json()["subjects"]] == ["Algebra"]
    db.refresh(tutor)
    assert tutor.is_active is False
    assert (
        db.scalars(select(TutorSubject).where(TutorSubject.tutor_id == tutor.id)).first()
        is not None
    )


def test_delete_an_unknown_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.delete(f"/api/tutors/{uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json()["detail"] == "Tutor not found"


# --- RBAC on the write routes ------------------------------------------------------------------


def test_a_tutor_token_is_refused_on_every_write(api: TestClient, db: Session) -> None:
    profile = _make_tutor(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=profile.id)
    headers = _auth(tutor_user)

    created = api.post("/api/tutors", headers=headers, json=_payload())
    patched = api.patch(f"/api/tutors/{profile.id}", headers=headers, json={"bio": "self-serve"})
    deleted = api.delete(f"/api/tutors/{profile.id}", headers=headers)

    assert [response.status_code for response in (created, patched, deleted)] == [403, 403, 403]
    db.refresh(profile)
    assert profile.is_active is True
    assert profile.bio is None


def test_no_token_is_401_not_403(api: TestClient, db: Session) -> None:
    profile = _make_tutor(db)

    listed = api.get("/api/tutors")
    read = api.get(f"/api/tutors/{profile.id}")
    created = api.post("/api/tutors", json=_payload())

    assert [response.status_code for response in (listed, read, created)] == [401, 401, 401]


def test_a_developer_may_do_all_of_it(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    headers = _auth(developer)

    created = api.post("/api/tutors", headers=headers, json=_payload())
    tutor_id = created.json()["id"]
    listed = api.get("/api/tutors", headers=headers)
    patched = api.patch(f"/api/tutors/{tutor_id}", headers=headers, json={"bio": "Rewritten"})
    deleted = api.delete(f"/api/tutors/{tutor_id}", headers=headers)

    statuses = [response.status_code for response in (created, listed, patched, deleted)]

    assert statuses == [201, 200, 200, 200]
