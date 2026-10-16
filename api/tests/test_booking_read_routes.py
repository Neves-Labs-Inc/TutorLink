"""`GET /api/bookings` and `GET /api/bookings/{id}`, exercised over HTTP.

`GET /api/bookings` is the one Phase-4 route where `TutorScope` is correct: a tutor sees only
their own bookings and a populated response for a tutor caller proves the scope was actually
read (`TutorScopeNotApplied` would otherwise 500 it). `GET /api/bookings/{id}` takes
`Principal` instead and checks ownership after loading, per every negative case asserting the
exact `{"detail": "..."}` body, as in `test_exception_routes.py`.
"""

import datetime
import uuid
from collections.abc import Callable
from datetime import UTC
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ExceptionStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.bookings import BOOKING_NOT_FOUND_ERROR
from app.security import create_access_token, hash_password

DATE = datetime.date(2026, 9, 7)
LATER = datetime.date(2026, 9, 8)
LATEST = datetime.date(2026, 9, 9)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)

ONE_DAY = datetime.timedelta(days=1)
# Before every fixture date, so nothing is yet not completed.
BEFORE_DATE = datetime.datetime(2026, 9, 1, 9, 0)


@dataclass(frozen=True, slots=True)
class Family:
    guardian: Guardian
    co_guardian: Guardian
    child: Child
    tutor: Tutor
    other_tutor: Tutor
    subject: Subject
    home: Home
    other_home: Home
    availability_id: uuid.UUID
    other_availability_id: uuid.UUID


# --- the #130 read shape: Staff, kind, Location ----------------------------------------------


def test_a_summary_names_its_staff_member_kind_and_location(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["staff"] == {
        "id": str(family.tutor.user_id),
        "name": family.tutor.user.name,
        "role": "tutor",
    }
    assert item["kind"] == "regular"
    assert item["location"] == "home"
    assert item["subject"] == {"id": str(family.subject.id), "name": family.subject.name}
    assert datetime.datetime.fromisoformat(item["updated_at"]) == booking.updated_at
    assert "tutor" not in item


def test_the_detail_of_an_office_evaluation_has_no_subject_and_no_home(
    api: TestClient, db: Session, family: Family
) -> None:
    """The two nullable refs, on the one shape that nulls both; written by hand because the
    write path refuses it until ticket 05."""
    admin = _make_user(db)
    evaluation = _evaluation(db, family, staff=admin)

    body = api.get(f"/api/bookings/{evaluation.id}", headers=_auth(admin)).json()

    assert body["staff"] == {"id": str(admin.id), "name": admin.name, "role": "admin"}
    assert body["kind"] == "evaluation"
    assert body["location"] == "in_office"
    assert body["subject"] is None
    assert body["home"] is None
    assert datetime.datetime.fromisoformat(body["updated_at"]) == evaluation.updated_at


def test_an_office_evaluation_is_listed_with_a_null_subject(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _evaluation(db, family, staff=admin)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["subject"] is None
    assert item["staff"]["role"] == "admin"


def test_admin_filtering_by_tutor_id_reaches_the_profiles_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    """`?tutor_id=` is still the profile's id, resolved to the Staff member's user: the scope
    parameter did not change shape when the column did (#130)."""
    admin = _make_user(db)
    own = _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)

    body = api.get(f"/api/bookings?tutor_id={family.tutor.id}", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(own.id)]
    assert body["total"] == 1


# --- kind, Location and Staff filters; counts per kind (spec 02) ------------------------------


def test_kind_filters_split_evaluations_from_regular_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    regular = _book(db, family)
    evaluation = _evaluation(db, family, staff=admin)

    evaluations = api.get("/api/bookings?kind=evaluation", headers=_auth(admin)).json()
    regulars = api.get("/api/bookings?kind=regular", headers=_auth(admin)).json()

    assert [row["id"] for row in evaluations["items"]] == [str(evaluation.id)]
    assert [row["id"] for row in regulars["items"]] == [str(regular.id)]


def test_location_filters_split_home_from_in_office_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    at_home = _book(db, family)
    evaluation = _evaluation(db, family, staff=admin)
    regular_in_office = _book(db, family, start=TWELVE, end=TWELVE.replace(hour=13))
    regular_in_office.location = BookingLocation.IN_OFFICE
    regular_in_office.home_id = None
    db.flush()

    in_office = api.get("/api/bookings?location=in_office", headers=_auth(admin)).json()
    home = api.get("/api/bookings?location=home", headers=_auth(admin)).json()

    assert {row["id"] for row in in_office["items"]} == {
        str(evaluation.id),
        str(regular_in_office.id),
    }
    assert [row["id"] for row in home["items"]] == [str(at_home.id)]


def test_user_id_returns_that_staff_users_bookings_admin_evaluations_included(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    other_admin = _make_user(db)
    # One live Evaluation per child, so the other admin's is cancelled before ours is booked.
    _evaluation(db, family, staff=other_admin).status = BookingStatus.CANCELLED
    db.flush()
    evaluation = _evaluation(db, family, staff=admin)
    _book(db, family)

    body = api.get(f"/api/bookings?user_id={admin.id}", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(evaluation.id)]
    assert body["total"] == 1


def test_user_id_composes_with_status(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    staff = family.tutor.user
    pending = _book(db, family, status=BookingStatus.PENDING)
    _book(db, family, start=TWELVE, end=TWELVE.replace(hour=13), status=BookingStatus.CANCELLED)

    body = api.get(f"/api/bookings?user_id={staff.id}&status=pending", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(pending.id)]


def test_subject_id_never_returns_an_evaluation(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    regular = _book(db, family)
    _evaluation(db, family, staff=admin)

    body = api.get(f"/api/bookings?subject_id={family.subject.id}", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(regular.id)]


def test_a_tutor_naming_another_user_id_ands_with_their_scope_to_empty(
    api: TestClient, db: Session, family: Family
) -> None:
    """The Tutor scope wins: `user_id` can only narrow it, never widen it to someone else's rows."""
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family, tutor=family.tutor)
    other = _book(db, family, tutor=family.other_tutor)

    body = api.get(f"/api/bookings?user_id={other.user_id}", headers=_auth(user)).json()

    assert body["items"] == []
    assert body["total"] == 0
    assert body["counts_by_kind"] == {"regular": 0, "evaluation": 0}


# --- ?q=, repeatable ?kind= and ?user_id= (spec 05 ticket 02) ---------------------------------


def _ids(response: Response) -> set[str]:
    return {row["id"] for row in response.json()["items"]}


def test_q_matches_the_childs_name_or_the_staff_members_name_case_insensitively(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.child.name = "Alice"
    family.other_tutor.user.name = "Alina"
    family.tutor.user.name = "Zed"
    other_child = _make_child(db, guardians=[family.guardian])
    other_child.name = "Bob"
    by_child = _book(db, family)
    by_staff = _book(db, family, tutor=family.other_tutor, child=other_child)
    _book(db, family, child=other_child, start=TWELVE, end=TWELVE.replace(hour=13))
    db.flush()

    response = api.get("/api/bookings?q=ALI", headers=_auth(admin))

    assert _ids(response) == {str(by_child.id), str(by_staff.id)}
    assert response.json()["total"] == 2


def test_q_wildcards_match_only_literal_characters(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.child.name = "100% Sure"
    family.tutor.user.name = "Plain"
    underscore_child = _make_child(db, guardians=[family.guardian])
    underscore_child.name = "a_b"
    percent = _book(db, family)
    underscore = _book(
        db, family, child=underscore_child, start=TWELVE, end=TWELVE.replace(hour=13)
    )
    db.flush()

    percent_ids = _ids(api.get("/api/bookings?q=%25", headers=_auth(admin)))
    underscore_ids = _ids(api.get("/api/bookings?q=_", headers=_auth(admin)))

    assert percent_ids == {str(percent.id)}
    assert underscore_ids == {str(underscore.id)}


@pytest.mark.parametrize("blank", ["", "%20%20"])
def test_a_blank_q_is_ignored(api: TestClient, db: Session, family: Family, blank: str) -> None:
    admin = _make_user(db)
    _book(db, family)
    _book(db, family, start=TWELVE, end=TWELVE.replace(hour=13))

    body = api.get(f"/api/bookings?q={blank}", headers=_auth(admin)).json()

    assert body["total"] == 2


def test_q_ands_with_other_filters_and_never_duplicates_a_row(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.child.name = "Sam Child"
    family.tutor.user.name = "Sam Tutor"
    kept = _book(db, family, status=BookingStatus.PENDING)
    _book(db, family, start=TWELVE, end=TWELVE.replace(hour=13), status=BookingStatus.CANCELLED)
    _book(db, family, on=LATEST, status=BookingStatus.PENDING)
    db.flush()

    path = (
        f"/api/bookings?q=sam&status=pending&kind=regular&user_id={family.tutor.user_id}"
        f"&from={DATE}&to={LATER}"
    )
    body = api.get(path, headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(kept.id)]
    assert body["total"] == 1


def test_q_matches_an_archived_staff_member(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    family.tutor.user.name = "Retired Rita"
    family.tutor.user.is_archived = True
    booking = _book(db, family)
    db.flush()

    response = api.get("/api/bookings?q=rita", headers=_auth(admin))

    assert _ids(response) == {str(booking.id)}


def test_repeated_kind_returns_both_kinds_and_counts_keep_their_meaning(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    regular = _book(db, family)
    evaluation = _evaluation(db, family, staff=admin)

    both = api.get("/api/bookings?kind=regular&kind=evaluation", headers=_auth(admin)).json()
    one = api.get("/api/bookings?kind=regular", headers=_auth(admin)).json()

    assert {row["id"] for row in both["items"]} == {str(regular.id), str(evaluation.id)}
    assert both["total"] == 2
    assert one["total"] == 1
    assert both["counts_by_kind"] == one["counts_by_kind"] == {"regular": 1, "evaluation": 1}


def test_an_unknown_kind_is_a_400(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)

    response = api.get("/api/bookings?kind=regular&kind=bogus", headers=_auth(admin))

    assert response.status_code == 400


def test_repeated_user_id_returns_each_staff_members_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    first = _book(db, family)
    second = _book(db, family, tutor=family.other_tutor)
    third = _evaluation(db, family, staff=admin)

    path = f"/api/bookings?user_id={first.user_id}&user_id={second.user_id}"
    response = api.get(path, headers=_auth(admin))

    assert _ids(response) == {str(first.id), str(second.id)}
    assert str(third.id) not in _ids(response)


def test_a_tutors_q_naming_another_staff_member_still_sees_only_their_own(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    family.other_tutor.user.name = "Zelda Other"
    family.child.name = "Plain Child"
    _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)
    db.flush()

    body = api.get("/api/bookings?q=zelda", headers=_auth(user)).json()

    assert body["items"] == []
    assert body["total"] == 0


def test_counts_by_kind_equal_the_totals_of_the_same_request_per_kind(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family)
    _book(db, family, start=TWELVE, end=TWELVE.replace(hour=13))
    _evaluation(db, family, staff=admin)

    body = api.get("/api/bookings", headers=_auth(admin)).json()
    regular_total = api.get("/api/bookings?kind=regular", headers=_auth(admin)).json()["total"]
    evaluation_total = api.get("/api/bookings?kind=evaluation", headers=_auth(admin)).json()[
        "total"
    ]

    assert body["counts_by_kind"] == {"regular": 2, "evaluation": 1}
    assert body["counts_by_kind"] == {"regular": regular_total, "evaluation": evaluation_total}


def test_counts_by_kind_ignore_the_active_kind_filter(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family)
    _evaluation(db, family, staff=admin)

    body = api.get("/api/bookings?kind=regular", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert body["counts_by_kind"] == {"regular": 1, "evaluation": 1}


def test_counts_by_kind_respect_the_date_window_and_the_other_filters(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=DATE)
    _book(db, family, on=LATEST)
    _evaluation(db, family, staff=admin)

    windowed = api.get(f"/api/bookings?from={LATER}&to={LATEST}", headers=_auth(admin)).json()
    by_staff = api.get(f"/api/bookings?user_id={admin.id}", headers=_auth(admin)).json()

    assert windowed["counts_by_kind"] == {"regular": 1, "evaluation": 0}
    assert by_staff["counts_by_kind"] == {"regular": 0, "evaluation": 1}


def test_counts_by_kind_stay_inside_the_tutor_scope(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)
    _evaluation(db, family, staff=_make_user(db))

    body = api.get("/api/bookings", headers=_auth(user)).json()

    assert body["counts_by_kind"] == {"regular": 1, "evaluation": 0}


# --- subject_level, home on rows, guardians on the detail (bookings-reads 01) -----------------


def test_a_row_shows_the_childs_level_in_the_bookings_subject(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _set_level(db, family.child, family.subject, level=9, set_by=admin)
    booking = _book(db, family)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]
    detail = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert item["subject_level"] == 9
    assert detail["subject_level"] == 9


def test_a_child_with_no_level_in_the_subject_shows_a_null_level(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    other_subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(other_subject)
    db.flush()
    _set_level(db, family.child, other_subject, level=4, set_by=admin)
    booking = _book(db, family)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]
    detail = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert item["subject_level"] is None
    assert detail["subject_level"] is None


def test_an_evaluation_shows_a_null_level(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    _set_level(db, family.child, family.subject, level=9, set_by=admin)
    evaluation = _evaluation(db, family, staff=admin)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]
    detail = api.get(f"/api/bookings/{evaluation.id}", headers=_auth(admin)).json()

    assert item["subject_level"] is None
    assert detail["subject_level"] is None


def test_a_level_on_an_archived_subject_is_still_shown(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _set_level(db, family.child, family.subject, level=11, set_by=admin)
    booking = _book(db, family)
    family.subject.is_archived = True
    db.flush()

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]
    detail = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert item["subject_level"] == 11
    assert detail["subject_level"] == 11


def test_each_row_shows_its_own_childs_level(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    other_child = _make_child(db, guardians=[family.guardian])
    _set_level(db, family.child, family.subject, level=3, set_by=admin)
    _set_level(db, other_child, family.subject, level=8, set_by=admin)
    first = _book(db, family, start=NINE, end=TEN)
    second = _book(db, family, child=other_child, start=ELEVEN, end=TWELVE)

    items = api.get("/api/bookings", headers=_auth(admin)).json()["items"]

    assert {row["id"]: row["subject_level"] for row in items} == {
        str(first.id): 3,
        str(second.id): 8,
    }


def test_a_home_row_names_its_home(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    family.other_home.label = "Grandma's"
    db.flush()
    _book(db, family, home=family.other_home)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["home"] == {
        "id": str(family.other_home.id),
        "label": "Grandma's",
        "address": "2 Test Avenue",
        "directions": "1111",
    }


def test_an_in_office_row_has_a_null_home(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    _evaluation(db, family, staff=admin)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["home"] is None


def test_a_row_at_an_archived_home_still_names_it(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family)
    family.home.is_archived = True
    db.flush()

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["home"] == {
        "id": str(family.home.id),
        "label": None,
        "address": "1 Test Street",
        "directions": "0000",
    }


def test_the_detail_lists_the_childs_guardians_by_name(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.guardian.name = "Zoe Parent"
    family.co_guardian.name = "Amy Parent"
    db.flush()
    booking = _book(db, family)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["guardians"] == [
        {"id": str(family.co_guardian.id), "name": "Amy Parent", "conversation_id": None},
        {"id": str(family.guardian.id), "name": "Zoe Parent", "conversation_id": None},
    ]


def test_an_archived_guardian_is_left_off_the_detail(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.co_guardian.is_archived = True
    db.flush()
    booking = _book(db, family)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert [guardian["id"] for guardian in body["guardians"]] == [str(family.guardian.id)]


def test_a_guardians_conversation_is_their_latest_one(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.co_guardian.is_archived = True
    db.flush()
    _converse(db, family.guardian, last_message_at=datetime.datetime(2026, 9, 1, tzinfo=UTC))
    latest = _converse(
        db, family.guardian, last_message_at=datetime.datetime(2026, 9, 5, tzinfo=UTC)
    )
    _converse(db, family.guardian, last_message_at=datetime.datetime(2026, 9, 3, tzinfo=UTC))
    booking = _book(db, family)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["guardians"] == [
        {
            "id": str(family.guardian.id),
            "name": family.guardian.name,
            "conversation_id": str(latest.id),
        }
    ]


def test_another_guardians_conversation_is_not_borrowed(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.guardian.name = "Amy Parent"
    family.co_guardian.name = "Zoe Parent"
    db.flush()
    own = _converse(db, family.guardian, last_message_at=datetime.datetime(2026, 9, 1, tzinfo=UTC))
    booking = _book(db, family)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert [guardian["conversation_id"] for guardian in body["guardians"]] == [str(own.id), None]


def test_only_the_office_sees_a_guardians_conversation_id(
    api: TestClient, db: Session, family: Family
) -> None:
    """A conversation id opens the Office inbox; a Tutor reading their own Booking gets null."""
    admin = _make_user(db)
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    family.co_guardian.is_archived = True
    db.flush()
    conversation = _converse(
        db, family.guardian, last_message_at=datetime.datetime(2026, 9, 1, tzinfo=UTC)
    )
    booking = _book(db, family, tutor=family.tutor)

    office = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()
    tutor = api.get(f"/api/bookings/{booking.id}", headers=_auth(tutor_user)).json()

    assert office["guardians"][0]["conversation_id"] == str(conversation.id)
    assert tutor["guardians"] == [
        {"id": str(family.guardian.id), "name": family.guardian.name, "conversation_id": None}
    ]


def test_a_page_runs_the_same_statements_for_two_rows_or_six(
    api: TestClient, db: Session, family: Family
) -> None:
    """Levels, Homes and Staff of every row come batched, never one query per row."""
    admin = _make_user(db)
    for offset in range(6):
        child = _make_child(db, guardians=[family.guardian])
        subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
        db.add(subject)
        db.flush()
        _set_level(db, child, subject, level=offset, set_by=admin)
        booking = _book(db, family, child=child, on=DATE + datetime.timedelta(days=offset))
        booking.subject_id = subject.id
        booking.home_id = (family.home if offset % 2 else family.other_home).id
    db.flush()
    db.expire_all()
    headers = _auth(admin)
    counts = []

    for page_size in (2, 6):
        statements = _statements_for(
            db, lambda: api.get(f"/api/bookings?page_size={page_size}", headers=headers)
        )
        counts.append(len(statements))

    assert counts[0] == counts[1]


# --- Bookings to sort out: `sort_out_reasons` (spec 5, #209) ---------------------------------


def test_a_live_booking_from_yesterday_is_not_completed_and_todays_is_not(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    """Not completed from 00:00 the day after its date, even if today's has already ended."""
    admin = _make_user(db)
    freeze_business_clock(datetime.datetime.combine(LATER, NINE))
    yesterday = _book(db, family, on=DATE, status=BookingStatus.CONFIRMED)
    today = _book(db, family, on=LATER, start=datetime.time(7, 0), end=datetime.time(8, 0))

    rows = _reasons_by_id(api.get("/api/bookings", headers=_auth(admin)))

    assert rows == {str(yesterday.id): ["not_completed"], str(today.id): []}


def test_a_booking_is_not_completed_from_midnight_after_its_date_however_old(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(datetime.datetime.combine(LATEST, datetime.time(0, 0)))
    yesterday = _book(db, family, on=LATER, status=BookingStatus.CONFIRMED)
    a_year_ago = _book(db, family, on=LATER - datetime.timedelta(days=365))

    rows = _reasons_by_id(api.get("/api/bookings", headers=_auth(admin)))

    assert rows == {str(yesterday.id): ["not_completed"], str(a_year_ago.id): ["not_completed"]}


@pytest.mark.parametrize("closed", [BookingStatus.COMPLETED, BookingStatus.CANCELLED])
def test_completing_or_cancelling_a_not_completed_booking_clears_it(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
    closed: BookingStatus,
) -> None:
    admin = _make_user(db)
    freeze_business_clock(datetime.datetime.combine(LATER, NINE))
    booking = _book(db, family, on=DATE, status=BookingStatus.CONFIRMED)

    moved = api.patch(
        f"/api/bookings/{booking.id}", json={"status": closed.value}, headers=_auth(admin)
    )
    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert moved.status_code == 200
    assert body["sort_out_reasons"] == []


@pytest.mark.parametrize(
    ("window", "clashes"),
    [
        (None, True),
        ((NINE, datetime.time(10, 30)), True),
        ((datetime.time(10, 30), TWELVE), True),
        ((NINE, TEN), False),
        ((ELEVEN, TWELVE), False),
    ],
    ids=["whole-day", "overlapping-start", "overlapping-end", "ends-at-start", "starts-at-end"],
)
def test_approved_time_off_over_a_live_booking_is_a_clash_and_touching_is_not(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
    window: tuple[datetime.time, datetime.time] | None,
    clashes: bool,
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family)
    _time_off(db, family.tutor.user_id, window=window, start=DATE - ONE_DAY, end=LATER)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == (["time_off_clash"] if clashes else [])


@pytest.mark.parametrize(
    "inert", [ExceptionStatus.PENDING, ExceptionStatus.REJECTED, ExceptionStatus.CANCELLED]
)
def test_time_off_that_is_not_approved_never_clashes(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
    inert: ExceptionStatus,
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family)
    _time_off(db, family.tutor.user_id, status=inert)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == []


def test_another_staff_members_time_off_does_not_clash(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family, tutor=family.tutor)
    _time_off(db, family.other_tutor.user_id)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == []


def test_cancelling_the_time_off_or_the_booking_clears_the_clash(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    kept_by_time_off = _book(db, family, tutor=family.tutor)
    kept_by_booking = _book(db, family, tutor=family.other_tutor)
    time_off = _time_off(db, family.tutor.user_id)
    _time_off(db, family.other_tutor.user_id)

    cancelled_time_off = api.post(f"/api/exceptions/{time_off.id}/cancel", headers=_auth(admin))
    cancelled_booking = api.patch(
        f"/api/bookings/{kept_by_booking.id}", json={"status": "cancelled"}, headers=_auth(admin)
    )
    rows = _reasons_by_id(api.get("/api/bookings", headers=_auth(admin)))

    assert cancelled_time_off.status_code == 200
    assert cancelled_booking.status_code == 200
    assert rows == {str(kept_by_time_off.id): [], str(kept_by_booking.id): []}


def test_a_past_clashing_booking_carries_both_reasons_in_wire_order(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(datetime.datetime.combine(LATEST, NINE))
    booking = _book(db, family)
    _time_off(db, family.tutor.user_id)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == ["not_completed", "time_off_clash"]


def test_an_upcoming_booking_with_archived_staff_is_to_sort_out_until_restored(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family, status=BookingStatus.CONFIRMED)
    staff_id = family.tutor.user_id

    archived = _archive_staff(api, admin, staff_id)
    while_archived = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()
    restored = api.post(
        "/api/restore", json={"type": "staff", "id": str(staff_id)}, headers=_auth(admin)
    )
    after_restore = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert archived.status_code == 200
    assert while_archived["sort_out_reasons"] == ["archived_staff"]
    assert restored.status_code == 200
    assert after_restore["sort_out_reasons"] == []


def test_cancelling_a_booking_with_archived_staff_clears_it(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family, status=BookingStatus.CONFIRMED)
    _archive_staff(api, admin, family.tutor.user_id)

    api.patch(f"/api/bookings/{booking.id}", json={"status": "cancelled"}, headers=_auth(admin))
    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == []


def test_a_past_booking_with_archived_staff_is_only_not_completed(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(datetime.datetime.combine(LATER, NINE))
    booking = _book(db, family, status=BookingStatus.CONFIRMED)
    _archive_staff(api, admin, family.tutor.user_id)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == ["not_completed"]


# --- `?to_sort_out` and `?reason` --------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SortOutStage:
    """Frozen at LATER 09:00: one Booking per reason mix, plus one with none."""

    past: Booking
    past_clash: Booking
    archived: Booking
    clean: Booking


@pytest.fixture
def sort_out_stage(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> SortOutStage:
    freeze_business_clock(datetime.datetime.combine(LATER, NINE))
    past = _book(db, family, on=DATE, start=NINE, end=TEN)
    past_clash = _book(db, family, on=DATE, start=ELEVEN, end=TWELVE)
    _time_off(db, family.tutor.user_id, window=(ELEVEN, TWELVE))
    archived = _book(db, family, tutor=family.other_tutor, on=LATEST)
    clean = _book(db, family, on=LATEST)
    _archive_staff(api, _make_user(db), family.other_tutor.user_id)

    return SortOutStage(past=past, past_clash=past_clash, archived=archived, clean=clean)


def test_to_sort_out_lists_each_booking_with_a_reason_once(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)

    body = api.get("/api/bookings?to_sort_out=true", headers=_auth(admin)).json()

    assert _reasons_by_id_of(body) == {
        str(sort_out_stage.past.id): ["not_completed"],
        str(sort_out_stage.past_clash.id): ["not_completed", "time_off_clash"],
        str(sort_out_stage.archived.id): ["archived_staff"],
    }
    assert body["total"] == 3
    assert body["counts_by_kind"] == {"regular": 3, "evaluation": 0}


def test_to_sort_out_false_lists_only_bookings_with_no_reason(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)

    body = api.get("/api/bookings?to_sort_out=false", headers=_auth(admin)).json()

    assert _reasons_by_id_of(body) == {str(sort_out_stage.clean.id): []}
    assert body["total"] == 1


@pytest.mark.parametrize(
    ("reason", "expected"),
    [
        ("not_completed", {"past", "past_clash"}),
        ("time_off_clash", {"past_clash"}),
        ("archived_staff", {"archived"}),
    ],
)
def test_reason_narrows_to_the_bookings_carrying_it(
    api: TestClient,
    db: Session,
    sort_out_stage: SortOutStage,
    reason: str,
    expected: set[str],
) -> None:
    admin = _make_user(db)

    for query in (f"reason={reason}", f"reason={reason}&to_sort_out=true"):
        body = api.get(f"/api/bookings?{query}", headers=_auth(admin)).json()

        assert set(_reasons_by_id_of(body)) == {
            str(getattr(sort_out_stage, name).id) for name in expected
        }
        assert body["total"] == len(expected)


def test_a_reason_with_to_sort_out_false_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/bookings?to_sort_out=false&reason=not_completed", headers=_auth(admin))

    _assert_detail(response, 400, "reason can only be used with to_sort_out=true")


def test_an_unknown_reason_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/bookings?reason=bogus", headers=_auth(admin))

    assert response.status_code == 400


def test_a_manager_sorts_out_only_their_own_bookings_but_lists_everyones(
    api: TestClient, db: Session, family: Family, sort_out_stage: SortOutStage
) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    own = _book(db, family, on=DATE, start=TWELVE, end=TWELVE.replace(hour=13))
    own.user_id = manager.id
    own.availability_id = None
    db.flush()

    sorting_out = api.get("/api/bookings?to_sort_out=true", headers=_auth(manager)).json()
    by_reason = api.get("/api/bookings?reason=not_completed", headers=_auth(manager)).json()
    listing = api.get("/api/bookings", headers=_auth(manager)).json()

    assert set(_reasons_by_id_of(sorting_out)) == {str(own.id)}
    assert sorting_out["total"] == 1
    assert set(_reasons_by_id_of(by_reason)) == {str(own.id)}
    assert listing["total"] == 5


def test_an_admin_sorts_out_everyones_bookings(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)

    body = api.get("/api/bookings?to_sort_out=true", headers=_auth(admin)).json()

    assert body["total"] == 3


# --- acknowledging a Time off clash (#209) ------------------------------------------------------


def test_an_admin_acknowledging_a_clash_takes_it_off_to_sort_out(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)
    booking = sort_out_stage.past_clash

    response = api.post(_acknowledgement_url(booking), headers=_auth(admin))
    to_sort_out = api.get("/api/bookings?to_sort_out=true", headers=_auth(admin)).json()
    by_reason = api.get("/api/bookings?reason=time_off_clash", headers=_auth(admin)).json()

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(booking.id)
    assert body["clash_acknowledged_by"] == {"id": str(admin.id), "name": admin.name}
    acknowledged_at = datetime.datetime.fromisoformat(body["clash_acknowledged_at"])
    assert acknowledged_at.tzinfo is not None
    assert body["sort_out_reasons"] == ["not_completed"]
    assert _reasons_by_id_of(to_sort_out)[str(booking.id)] == ["not_completed"]
    assert by_reason["items"] == []


def test_acknowledging_again_keeps_the_first_acknowledgement(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    first_admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)
    booking = sort_out_stage.past_clash

    first = api.post(_acknowledgement_url(booking), headers=_auth(first_admin)).json()
    again = api.post(_acknowledgement_url(booking), headers=_auth(developer))

    assert again.status_code == 200
    assert again.json()["clash_acknowledged_by"] == {
        "id": str(first_admin.id),
        "name": first_admin.name,
    }
    assert again.json()["clash_acknowledged_at"] == first["clash_acknowledged_at"]


def test_a_developer_may_acknowledge_a_clash(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.post(_acknowledgement_url(sort_out_stage.past_clash), headers=_auth(developer))

    assert response.status_code == 200
    assert response.json()["clash_acknowledged_by"]["id"] == str(developer.id)


def test_acknowledging_neither_bumps_updated_at_nor_changes_anything_else(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)
    booking = sort_out_stage.past_clash
    # Older than the test transaction's `now()`, which a bump would write.
    booking.updated_at = datetime.datetime(2026, 1, 1, tzinfo=UTC)
    db.flush()
    before = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    acknowledged = api.post(_acknowledgement_url(booking), headers=_auth(admin)).json()
    withdrawn = api.delete(_acknowledgement_url(booking), headers=_auth(admin)).json()

    assert acknowledged["updated_at"] == before["updated_at"]
    assert withdrawn == before


@pytest.mark.parametrize(
    "setup",
    ["no_time_off", "pending_time_off", "cancelled_booking"],
)
def test_acknowledging_a_booking_with_no_clash_is_409(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
    setup: str,
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    status = BookingStatus.CANCELLED if setup == "cancelled_booking" else BookingStatus.PENDING
    booking = _book(db, family, status=status)
    if setup != "no_time_off":
        time_off_status = (
            ExceptionStatus.PENDING if setup == "pending_time_off" else ExceptionStatus.APPROVED
        )
        _time_off(db, family.tutor.user_id, status=time_off_status)

    response = api.post(_acknowledgement_url(booking), headers=_auth(admin))

    _assert_detail(response, 409, "This booking has no time off clash to acknowledge")


def test_acknowledging_again_after_the_time_off_is_cancelled_is_409(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family)
    time_off = _time_off(db, family.tutor.user_id)
    acknowledged = api.post(_acknowledgement_url(booking), headers=_auth(admin))
    api.post(f"/api/exceptions/{time_off.id}/cancel", headers=_auth(admin))

    response = api.post(_acknowledgement_url(booking), headers=_auth(admin))

    assert acknowledged.status_code == 200
    _assert_detail(response, 409, "This booking has no time off clash to acknowledge")


def test_withdrawing_an_acknowledgement_brings_the_clash_back(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)
    booking = sort_out_stage.past_clash
    api.post(_acknowledgement_url(booking), headers=_auth(admin))

    withdrawn = api.delete(_acknowledgement_url(booking), headers=_auth(admin))
    again = api.delete(_acknowledgement_url(booking), headers=_auth(admin))

    assert withdrawn.status_code == 200
    body = withdrawn.json()
    assert body["clash_acknowledged_by"] is None
    assert body["clash_acknowledged_at"] is None
    assert body["sort_out_reasons"] == ["not_completed", "time_off_clash"]
    assert again.status_code == 200
    assert again.json() == body


@pytest.mark.parametrize("method", ["post", "delete"])
def test_acknowledging_an_unknown_booking_is_404(api: TestClient, db: Session, method: str) -> None:
    admin = _make_user(db)

    response = api.request(
        method.upper(), f"/api/bookings/{uuid.uuid4()}/clash-acknowledgement", headers=_auth(admin)
    )

    _assert_detail(response, 404, BOOKING_NOT_FOUND_ERROR)


@pytest.mark.parametrize("method", ["post", "delete"])
@pytest.mark.parametrize("role", [UserRole.MANAGER, UserRole.TUTOR])
def test_only_an_admin_may_acknowledge_or_withdraw(
    api: TestClient,
    db: Session,
    family: Family,
    sort_out_stage: SortOutStage,
    method: str,
    role: UserRole,
) -> None:
    caller = _make_user(db, role=role, tutor_id=family.tutor.id)

    response = api.request(
        method.upper(), _acknowledgement_url(sort_out_stage.past_clash), headers=_auth(caller)
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)


def test_list_rows_carry_the_acknowledgement(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)
    acknowledged = api.post(
        _acknowledgement_url(sort_out_stage.past_clash), headers=_auth(admin)
    ).json()

    rows = {
        row["id"]: row for row in api.get("/api/bookings", headers=_auth(admin)).json()["items"]
    }

    assert rows[str(sort_out_stage.past_clash.id)]["clash_acknowledged_by"] == {
        "id": str(admin.id),
        "name": admin.name,
    }
    assert (
        rows[str(sort_out_stage.past_clash.id)]["clash_acknowledged_at"]
        == acknowledged["clash_acknowledged_at"]
    )
    assert rows[str(sort_out_stage.clean.id)]["clash_acknowledged_by"] is None
    assert rows[str(sort_out_stage.clean.id)]["clash_acknowledged_at"] is None


def test_an_archived_acknowledger_is_still_named(
    api: TestClient, db: Session, sort_out_stage: SortOutStage
) -> None:
    admin = _make_user(db)
    acknowledger = _make_user(db)
    api.post(_acknowledgement_url(sort_out_stage.past_clash), headers=_auth(acknowledger))
    acknowledger.is_archived = True
    db.flush()

    body = api.get(f"/api/bookings/{sort_out_stage.past_clash.id}", headers=_auth(admin)).json()

    assert body["clash_acknowledged_by"] == {"id": str(acknowledger.id), "name": acknowledger.name}


def test_a_page_of_acknowledged_rows_runs_the_same_statements_for_two_rows_or_six(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    """Each row acknowledged by a different Admin, so a per-row user load would show."""
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    for offset in range(6):
        day = DATE + datetime.timedelta(days=offset)
        booking = _book(db, family, on=day)
        _time_off(db, family.tutor.user_id, start=day, end=day)
        acknowledged = api.post(_acknowledgement_url(booking), headers=_auth(_make_user(db)))
        assert acknowledged.status_code == 200
    db.expire_all()
    headers = _auth(admin)
    counts = []

    for page_size in (2, 6):
        statements = _statements_for(
            db, lambda: api.get(f"/api/bookings?page_size={page_size}", headers=headers)
        )
        counts.append(len(statements))

    assert counts[0] == counts[1]


def _acknowledgement_url(booking: Booking) -> str:
    return f"/api/bookings/{booking.id}/clash-acknowledgement"


def _reasons_by_id(response: Response) -> dict[str, list[str]]:
    return _reasons_by_id_of(response.json())


def _reasons_by_id_of(body: dict[str, Any]) -> dict[str, list[str]]:
    return {row["id"]: row["sort_out_reasons"] for row in body["items"]}


def _time_off(
    db: Session,
    user_id: uuid.UUID,
    *,
    window: tuple[datetime.time, datetime.time] | None = None,
    start: datetime.date = DATE,
    end: datetime.date = DATE,
    status: ExceptionStatus = ExceptionStatus.APPROVED,
) -> TutorAvailabilityException:
    row = TutorAvailabilityException(
        user_id=user_id,
        start_date=start,
        end_date=end,
        start_time=None if window is None else window[0],
        end_time=None if window is None else window[1],
        status=status,
    )
    db.add(row)
    db.flush()

    return row


def _archive_staff(api: TestClient, admin: User, staff_id: uuid.UUID) -> Response:
    return api.post(
        "/api/archive",
        json={
            "type": "staff",
            "id": str(staff_id),
            "confirm_warnings": ["archived_staff_bookings"],
        },
        headers=_auth(admin),
    )


def test_a_page_reads_its_sort_out_reasons_in_one_statement(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    """Only the reasons read reaches Time off on an unfiltered list, so it is the one."""
    admin = _make_user(db)
    freeze_business_clock(datetime.datetime.combine(LATER, NINE))
    for offset in range(6):
        day = DATE + datetime.timedelta(days=offset)
        _book(db, family, on=day)
        _time_off(db, family.tutor.user_id, start=day, end=day)
    headers = _auth(admin)

    for page_size in (2, 6):
        statements = _statements_for(
            db, lambda: api.get(f"/api/bookings?page_size={page_size}", headers=headers)
        )

        assert sum("tutor_availability_exceptions" in one for one in statements) == 1


def _statements_for(db: Session, call: Callable[[], object]) -> list[str]:
    captured: list[str] = []

    def record(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        captured.append(statement)

    bind = db.get_bind()
    event.listen(bind, "before_cursor_execute", record)
    try:
        call()
    finally:
        event.remove(bind, "before_cursor_execute", record)

    return captured


def _converse(
    db: Session, guardian: Guardian, *, last_message_at: datetime.datetime
) -> Conversation:
    conversation = Conversation(
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
        guardian_id=guardian.id,
        last_message_at=last_message_at,
    )
    db.add(conversation)
    db.flush()

    return conversation


def _set_level(
    db: Session, child: Child, subject: Subject, *, level: int, set_by: User
) -> ChildSubjectLevel:
    row = ChildSubjectLevel(
        child_id=child.id, subject_id=subject.id, level=level, set_by_user_id=set_by.id
    )
    db.add(row)
    db.flush()

    return row


def _evaluation(db: Session, family: Family, *, staff: User) -> Booking:
    booking = Booking(
        child_id=family.child.id,
        user_id=staff.id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.IN_OFFICE,
        scheduled_date=DATE,
        start_time=TEN,
        end_time=ELEVEN,
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()

    return booking


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


def test_list_returns_the_page_envelope_never_a_bare_array(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family)

    body = api.get("/api/bookings", headers=_auth(user)).json()

    assert set(body) == {"items", "total", "page", "page_size", "counts_by_kind"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_tutor_sees_only_their_own_bookings(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    mine = _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)

    body = api.get("/api/bookings", headers=_auth(user)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_tutor_naming_another_tutor_id_is_403(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family, tutor=family.other_tutor)

    response = api.get(f"/api/bookings?tutor_id={family.other_tutor.id}", headers=_auth(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_tutor_naming_their_own_id_is_the_same_as_omitting_it(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    mine = _book(db, family, tutor=family.tutor)

    omitted = api.get("/api/bookings", headers=_auth(user)).json()
    named = api.get(f"/api/bookings?tutor_id={family.tutor.id}", headers=_auth(user)).json()

    assert [row["id"] for row in omitted["items"]] == [str(mine.id)]
    assert named == omitted


def test_admin_with_no_filter_sees_every_tutors_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    first = _book(db, family, tutor=family.tutor)
    second = _book(db, family, tutor=family.other_tutor)

    body = api.get("/api/bookings", headers=_auth(admin)).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {str(first.id), str(second.id)}


def test_repeated_status_values_are_ored(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    pending = _book(db, family, on=DATE, status=BookingStatus.PENDING)
    confirmed = _book(db, family, on=LATER, status=BookingStatus.CONFIRMED)
    _book(db, family, on=LATEST, status=BookingStatus.CANCELLED)

    body = api.get("/api/bookings?status=pending&status=confirmed", headers=_auth(admin)).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {str(pending.id), str(confirmed.id)}


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("", [DATE, LATER, LATEST]),
        ("?from=2026-09-08", [LATER, LATEST]),
        ("?to=2026-09-08", [DATE, LATER]),
        ("?from=2026-09-08&to=2026-09-08", [LATER]),
    ],
)
def test_the_date_bounds_are_inclusive_and_either_may_stand_alone(
    api: TestClient,
    db: Session,
    family: Family,
    query: str,
    expected: list[datetime.date],
) -> None:
    admin = _make_user(db)
    for on in (DATE, LATER, LATEST):
        _book(db, family, on=on)

    body = api.get(f"/api/bookings{query}", headers=_auth(admin)).json()

    assert [row["scheduled_date"] for row in body["items"]] == [str(on) for on in expected]
    assert body["total"] == len(expected)


def test_an_inverted_range_selects_nothing_and_is_not_an_error(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=DATE)

    response = api.get("/api/bookings?from=2026-09-09&to=2026-09-07", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
        "counts_by_kind": {"regular": 0, "evaluation": 0},
    }


def test_filtering_by_child_id_returns_only_that_childs_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    other_child = _make_child(db, guardians=[family.guardian])
    mine = _book(db, family)
    _book(db, family, child=other_child, start=ELEVEN, end=TWELVE)

    body = api.get(f"/api/bookings?child_id={family.child.id}", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_child_id_composes_with_status_and_date_range(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    other_child = _make_child(db, guardians=[family.guardian])
    matching = _book(db, family, on=LATER, status=BookingStatus.CONFIRMED)
    _book(db, family, on=LATER, status=BookingStatus.PENDING, start=ELEVEN, end=TWELVE)
    _book(
        db,
        family,
        child=other_child,
        on=LATER,
        status=BookingStatus.CONFIRMED,
        start=NINE,
        end=TEN,
    )

    query = f"?child_id={family.child.id}&status=confirmed&from=2026-09-08&to=2026-09-08"
    body = api.get(f"/api/bookings{query}", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(matching.id)]


def test_an_unknown_child_id_is_an_empty_page_not_an_error(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family)

    response = api.get(f"/api/bookings?child_id={uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
        "counts_by_kind": {"regular": 0, "evaluation": 0},
    }


def test_a_malformed_child_id_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/bookings?child_id=not-a-uuid", headers=_auth(admin))

    assert response.status_code == 400
    body = response.json()
    assert isinstance(body["detail"], str)


def test_tutor_filtering_by_child_id_sees_only_their_own_bookings_of_that_child(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    mine = _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)

    body = api.get(f"/api/bookings?child_id={family.child.id}", headers=_auth(user)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_tutor_naming_another_tutor_id_with_child_id_is_still_403(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family, tutor=family.other_tutor)

    response = api.get(
        f"/api/bookings?child_id={family.child.id}&tutor_id={family.other_tutor.id}",
        headers=_auth(user),
    )

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_bookings_are_ordered_by_date_then_start_time(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=LATER, start=TEN, end=ELEVEN)
    _book(db, family, on=DATE, start=ELEVEN, end=TWELVE)
    _book(db, family, on=DATE, start=NINE, end=TEN)

    body = api.get("/api/bookings", headers=_auth(admin)).json()

    assert [(row["scheduled_date"], row["start_time"]) for row in body["items"]] == [
        ("2026-09-07", "09:00:00"),
        ("2026-09-07", "11:00:00"),
        ("2026-09-08", "10:00:00"),
    ]


def test_get_by_id_returns_the_bookings_own_home_not_the_first_one(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family, home=family.other_home)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["home"]["address"] == family.other_home.address
    assert body["home"]["directions"] == family.other_home.directions
    assert "access_code" not in body["home"]


def test_get_by_id_with_no_booking_guardian_is_null(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family, booked_by=None)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["booked_by_guardian"] is None


def test_get_by_id_with_a_booking_guardian_names_them(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family, booked_by=family.guardian)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["booked_by_guardian"] == {
        "id": str(family.guardian.id),
        "name": family.guardian.name,
    }


def test_tutor_reading_their_own_booking_succeeds(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    booking = _book(db, family, tutor=family.tutor)

    response = api.get(f"/api/bookings/{booking.id}", headers=_auth(user))

    assert response.status_code == 200
    assert response.json()["id"] == str(booking.id)


def test_tutor_reading_another_tutors_booking_is_403(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    booking = _book(db, family, tutor=family.other_tutor)

    response = api.get(f"/api/bookings/{booking.id}", headers=_auth(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_an_unknown_booking_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/bookings/{uuid.uuid4()}", headers=_auth(admin))

    _assert_detail(response, 404, BOOKING_NOT_FOUND_ERROR)


def test_no_token_on_list_is_401(api: TestClient, db: Session) -> None:
    response = api.get("/api/bookings")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_no_token_on_get_by_id_is_401(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family)

    response = api.get(f"/api/bookings/{booking.id}")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_a_developer_may_list_and_read_any_booking(
    api: TestClient, db: Session, family: Family
) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    booking = _book(db, family)

    listed = api.get("/api/bookings", headers=_auth(developer))
    fetched = api.get(f"/api/bookings/{booking.id}", headers=_auth(developer))

    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()["items"]] == [str(booking.id)]
    assert fetched.status_code == 200


def _make_family(db: Session) -> Family:
    guardian = _make_guardian(db)
    co_guardian = _make_guardian(db)
    tutor = _make_tutor(db)
    other_tutor = _make_tutor(db)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    home = Home(address="1 Test Street", directions="0000")
    other_home = Home(address="2 Test Avenue", directions="1111")
    db.add_all([subject, home, other_home])
    db.flush()
    child = _make_child(db, guardians=[guardian, co_guardian])

    return Family(
        guardian=guardian,
        co_guardian=co_guardian,
        child=child,
        tutor=tutor,
        other_tutor=other_tutor,
        subject=subject,
        home=home,
        other_home=other_home,
        availability_id=_make_availability(db, tutor.id),
        other_availability_id=_make_availability(db, other_tutor.id),
    )


def _book(
    db: Session,
    family: Family,
    *,
    tutor: Tutor | None = None,
    home: Home | None = None,
    child: Child | None = None,
    on: datetime.date = DATE,
    start: datetime.time = TEN,
    end: datetime.time = ELEVEN,
    status: BookingStatus = BookingStatus.PENDING,
    booked_by: Guardian | None = None,
) -> Booking:
    booked_tutor = tutor or family.tutor
    booking = Booking(
        child_id=(child or family.child).id,
        user_id=booked_tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=family.subject.id,
        availability_id=(
            family.availability_id
            if booked_tutor.id == family.tutor.id
            else family.other_availability_id
        ),
        home_id=(home or family.home).id,
        booked_by_guardian_id=None if booked_by is None else booked_by.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_guardian(db: Session) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}")
    db.add(guardian)
    db.flush()

    return guardian


def _make_child(db: Session, *, guardians: list[Guardian]) -> Child:
    suffix = uuid.uuid4().hex[:12]
    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
    db.flush()

    return child


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()

    return tutor


def _make_availability(db: Session, tutor_id: uuid.UUID) -> uuid.UUID:
    availability = TutorAvailability(
        tutor_id=tutor_id, day_of_week=DATE.weekday(), start_time=NINE, end_time=TWELVE
    )
    db.add(availability)
    db.flush()

    return availability.id


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password("booking-read-password"),
            role=role,
            is_archived=False,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("booking-read-password")
        user.role = role
        user.is_archived = False
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)


# --- detail context and list fields (#228) ------------------------------------------------------


def test_the_detail_carries_its_availability_slot_id(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["availability_id"] == str(family.availability_id)


def test_a_booking_with_no_slot_has_a_null_availability_id(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family)
    booking.availability_id = None
    db.flush()

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["availability_id"] is None


def test_the_detail_lists_the_approved_time_off_over_it(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family)
    whole_day = _time_off(db, family.tutor.user_id, start=DATE - ONE_DAY, end=LATER)
    partial = _time_off(db, family.tutor.user_id, window=(NINE, TEN.replace(minute=30)))
    _time_off(db, family.tutor.user_id, window=(NINE, TEN))
    _time_off(db, family.tutor.user_id, status=ExceptionStatus.PENDING)
    _time_off(db, family.other_tutor.user_id)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert {row["id"]: row for row in body["clashing_time_off"]} == {
        str(whole_day.id): {
            "id": str(whole_day.id),
            "start_date": "2026-09-06",
            "end_date": "2026-09-08",
            "start_time": None,
            "end_time": None,
        },
        str(partial.id): {
            "id": str(partial.id),
            "start_date": "2026-09-07",
            "end_date": "2026-09-07",
            "start_time": "09:00:00",
            "end_time": "10:30:00",
        },
    }


def test_a_booking_with_no_time_off_over_it_has_an_empty_clashing_list(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["clashing_time_off"] == []


def test_an_acknowledged_clash_still_lists_its_time_off(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    admin = _make_user(db)
    freeze_business_clock(BEFORE_DATE)
    booking = _book(db, family)
    time_off = _time_off(db, family.tutor.user_id)
    api.post(_acknowledgement_url(booking), headers=_auth(admin))

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["sort_out_reasons"] == []
    assert [row["id"] for row in body["clashing_time_off"]] == [str(time_off.id)]


def test_a_list_row_carries_directions_child_notes_and_guardian_names_for_the_office(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.home.directions = "Side door"
    family.child.notes = "Likes diagrams"
    family.guardian.name = "Zoe Parent"
    family.co_guardian.name = "Amy Parent"
    db.flush()
    _converse(db, family.guardian, last_message_at=datetime.datetime(2026, 9, 1, tzinfo=UTC))
    _book(db, family)

    response = api.get("/api/bookings", headers=_auth(admin))

    item = response.json()["items"][0]
    assert item["home"]["directions"] == "Side door"
    assert item["child"]["notes"] == "Likes diagrams"
    assert item["guardians"] == [
        {"id": str(family.co_guardian.id), "name": "Amy Parent"},
        {"id": str(family.guardian.id), "name": "Zoe Parent"},
    ]
    assert "conversation_id" not in response.text


def test_a_tutors_list_row_carries_the_same_fields_and_no_conversation_id(
    api: TestClient, db: Session, family: Family
) -> None:
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    family.home.directions = "Side door"
    family.child.notes = "Likes diagrams"
    family.co_guardian.is_archived = True
    db.flush()
    _converse(db, family.guardian, last_message_at=datetime.datetime(2026, 9, 1, tzinfo=UTC))
    _book(db, family, tutor=family.tutor)

    response = api.get("/api/bookings", headers=_auth(tutor_user))

    item = response.json()["items"][0]
    assert item["home"]["directions"] == "Side door"
    assert item["child"]["notes"] == "Likes diagrams"
    assert item["guardians"] == [{"id": str(family.guardian.id), "name": family.guardian.name}]
    assert "conversation_id" not in response.text


def test_a_list_row_without_notes_or_directions_has_nulls(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    family.home.directions = None
    db.flush()
    _book(db, family)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["home"]["directions"] is None
    assert item["child"]["notes"] is None


def test_repeated_child_id_returns_each_childs_bookings_within_the_date_range(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    sibling = _make_child(db, guardians=[family.guardian])
    stranger = _make_child(db, guardians=[family.guardian])
    wanted = _book(db, family)
    wanted_sibling = _book(db, family, child=sibling, on=LATER)
    _book(db, family, child=sibling, on=LATEST)
    _book(db, family, child=stranger, start=TWELVE, end=TWELVE.replace(hour=13))

    response = api.get(
        f"/api/bookings?child_id={family.child.id}&child_id={sibling.id}&from={DATE}&to={LATER}",
        headers=_auth(admin),
    )

    assert response.status_code == 200
    assert _ids(response) == {str(wanted.id), str(wanted_sibling.id)}


def test_a_single_child_id_still_narrows_to_that_child(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    sibling = _make_child(db, guardians=[family.guardian])
    wanted = _book(db, family)
    _book(db, family, child=sibling, start=TWELVE, end=TWELVE.replace(hour=13))

    response = api.get(f"/api/bookings?child_id={family.child.id}", headers=_auth(admin))

    assert _ids(response) == {str(wanted.id)}
