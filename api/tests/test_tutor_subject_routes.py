"""`/api/tutors/{tutor_id}/subjects` over HTTP — assigning and removing which subjects a
tutor teaches, and at what grade ceiling.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services import tutor_subject_service

PASSWORD = "correct horse battery staple"


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


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


def _make_subject(db: Session, *, name: str | None = None) -> Subject:
    subject = Subject(name=name or f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()
    return subject


def test_assign_returns_201_with_the_embedded_shape(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db, name="Algebra")

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )

    assert response.status_code == 201
    assert response.json() == {
        "subject_id": str(subject.id),
        "name": "Algebra",
        "max_grade_level": 8,
    }


def test_assigning_the_same_pair_twice_conflicts_and_leaves_one_row(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    payload = {"subject_id": str(subject.id), "max_grade_level": 8}
    headers = _auth(admin)

    first = api.post(f"/api/tutors/{tutor.id}/subjects", headers=headers, json=payload)
    second = api.post(f"/api/tutors/{tutor.id}/subjects", headers=headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["detail"] == "That subject is already assigned to this tutor"
    rows = db.scalars(
        select(TutorSubject).where(
            TutorSubject.tutor_id == tutor.id, TutorSubject.subject_id == subject.id
        )
    ).all()
    assert len(rows) == 1


def test_the_constraint_answers_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    payload = {"subject_id": str(subject.id), "max_grade_level": 8}
    headers = _auth(admin)

    assert (
        api.post(f"/api/tutors/{tutor.id}/subjects", headers=headers, json=payload).status_code
        == 201
    )

    monkeypatch.setattr(tutor_subject_service, "_assignment_exists", lambda *_, **__: False)

    response = api.post(f"/api/tutors/{tutor.id}/subjects", headers=headers, json=payload)

    assert response.status_code == 409
    assert response.json()["detail"] == "That subject is already assigned to this tutor"
    assert db.scalars(select(Tutor).where(Tutor.id == tutor.id)).first() is not None


@pytest.mark.parametrize("max_grade_level", [0, 12])
def test_assign_accepts_a_ceiling_from_kindergarten_to_grade_12(
    api: TestClient, db: Session, max_grade_level: int
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id), "max_grade_level": max_grade_level},
    )

    assert response.status_code == 201
    assert response.json()["max_grade_level"] == max_grade_level


@pytest.mark.parametrize("max_grade_level", [-1, 13])
def test_assign_rejects_a_ceiling_outside_k_to_12(
    api: TestClient, db: Session, max_grade_level: int
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id), "max_grade_level": max_grade_level},
    )

    assert response.status_code == 400


def test_assign_requires_max_grade_level(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id)},
    )

    assert response.status_code == 400


def test_assign_with_unknown_subject_id_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(uuid.uuid4()), "max_grade_level": 8},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown subject_id"


def test_assign_with_a_retired_subject_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    subject.is_active = False
    db.flush()

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "That subject has been retired and cannot be assigned"
    rows = db.scalars(
        select(TutorSubject).where(
            TutorSubject.tutor_id == tutor.id, TutorSubject.subject_id == subject.id
        )
    ).all()
    assert rows == []


def test_assign_with_unknown_tutor_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)

    response = api.post(
        f"/api/tutors/{uuid.uuid4()}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Tutor not found"


def test_delete_returns_204_with_an_empty_body_and_removes_the_row(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    headers = _auth(admin)
    api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=headers,
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )

    response = api.delete(f"/api/tutors/{tutor.id}/subjects/{subject.id}", headers=headers)

    assert response.status_code == 204
    assert response.content == b""
    assert (
        db.scalars(
            select(TutorSubject).where(
                TutorSubject.tutor_id == tutor.id, TutorSubject.subject_id == subject.id
            )
        ).first()
        is None
    )


def test_delete_a_pair_that_was_never_assigned_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)

    response = api.delete(f"/api/tutors/{tutor.id}/subjects/{subject.id}", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json()["detail"] == "That subject is not assigned to this tutor"


def test_delete_still_works_after_the_subject_is_retired(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    headers = _auth(admin)
    api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=headers,
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )
    subject.is_active = False
    db.flush()

    response = api.delete(f"/api/tutors/{tutor.id}/subjects/{subject.id}", headers=headers)

    assert response.status_code == 204
    assert (
        db.scalars(
            select(TutorSubject).where(
                TutorSubject.tutor_id == tutor.id, TutorSubject.subject_id == subject.id
            )
        ).first()
        is None
    )


def test_delete_with_unknown_tutor_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.delete(
        f"/api/tutors/{uuid.uuid4()}/subjects/{uuid.uuid4()}", headers=_auth(admin)
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Tutor not found"


def test_delete_does_not_deactivate_or_delete_the_tutor_or_subject(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    headers = _auth(admin)
    api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=headers,
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )

    api.delete(f"/api/tutors/{tutor.id}/subjects/{subject.id}", headers=headers)

    db.refresh(tutor)
    db.refresh(subject)
    assert tutor.is_active is True
    assert subject.is_active is True


def test_a_subject_may_be_assigned_to_two_tutors_and_a_tutor_may_hold_two_subjects(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    tutor_a = _make_tutor(db)
    tutor_b = _make_tutor(db)
    subject_a = _make_subject(db)
    subject_b = _make_subject(db)
    headers = _auth(admin)

    responses = [
        api.post(
            f"/api/tutors/{tutor.id}/subjects",
            headers=headers,
            json={"subject_id": str(subject.id), "max_grade_level": 8},
        )
        for tutor, subject in [
            (tutor_a, subject_a),
            (tutor_b, subject_a),
            (tutor_a, subject_b),
        ]
    ]

    assert [response.status_code for response in responses] == [201, 201, 201]


def test_a_tutor_token_is_refused_on_both_routes(api: TestClient, db: Session) -> None:
    tutor_profile = _make_tutor(db)
    subject = _make_subject(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR)
    tutor_user.tutor_id = tutor_profile.id
    db.flush()
    headers = _auth(tutor_user)

    post_response = api.post(
        f"/api/tutors/{tutor_profile.id}/subjects",
        headers=headers,
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )
    delete_response = api.delete(
        f"/api/tutors/{tutor_profile.id}/subjects/{subject.id}", headers=headers
    )

    assert post_response.status_code == 403
    assert delete_response.status_code == 403


def test_no_token_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    subject = _make_subject(db)

    post_response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )
    delete_response = api.delete(f"/api/tutors/{tutor.id}/subjects/{subject.id}")

    assert post_response.status_code == 401
    assert delete_response.status_code == 401


def test_a_developer_is_allowed(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    tutor = _make_tutor(db)
    subject = _make_subject(db)

    response = api.post(
        f"/api/tutors/{tutor.id}/subjects",
        headers=_auth(developer),
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )

    assert response.status_code == 201
