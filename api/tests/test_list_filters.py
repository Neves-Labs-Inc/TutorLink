"""The list filters and row counts amendments A-1 and A-2 add — REQ-051.2, REQ-053.1,
REQ-053.2, REQ-054.2.

Three fixture shapes, one per resource under test. `roster` is a set of tutors named to make
`?q=` discriminate — two share a surname fragment, two carry a LIKE wildcard in the name, and
each is assigned a different subject so `q` can be composed with `subject_id`. `household` is
one guardian with two active homes, one deactivated home and three children, beside a guardian
with nothing linked: that asymmetry is what separates a scalar-subquery count from a join, and
what makes `total` a count of guardians rather than of `guardian_homes` rows. `schedule` is one
client's child booked three times across two subjects, two tutors, three dates and two statuses,
so `?subject_id=` can be shown to compose with every filter already defined beside it.

Phone numbers that reach `?phone_number=` are real dialable US numbers in the 555-01xx fictional
range, because `phone_service` validates with `is_valid_number`. The rows inserted directly are
deliberately not all in it: `?q=555` can only be shown to exclude anything if some stored number
lacks those digits.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ConsentAction,
    ConsentSource,
    Language,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.reminder_consent import ReminderConsent
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"

PHONE = "+12025550123"
FOREIGN_PHONE = "+441632960111"

DATE = datetime.date(2026, 9, 7)
LATER = datetime.date(2026, 9, 8)
LATEST = datetime.date(2026, 9, 9)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)


@dataclass(frozen=True, slots=True)
class Roster:
    marsh: Tutor
    brook: Tutor
    maths: Subject
    french: Subject


@dataclass(frozen=True, slots=True)
class Household:
    full: Guardian
    empty: Guardian


@dataclass(frozen=True, slots=True)
class Languages:
    """Five Guardians, one per language and reminder state the filters tell apart."""

    undetected: Guardian
    english: Guardian
    spanish: Guardian
    silent: Guardian
    spanish_out: Guardian


@dataclass(frozen=True, slots=True)
class Schedule:
    client: Guardian
    child: Child
    maths: Subject
    french: Subject
    tutor: Tutor
    other_tutor: Tutor
    maths_early: Booking
    french_middle: Booking
    maths_late: Booking


@pytest.fixture
def roster(db: Session) -> Roster:
    maths = _make_subject(db)
    french = _make_subject(db)
    marsh = _make_tutor(db, name="Nadia Marsh")
    brook = _make_tutor(db, name="Nadia Brook")
    _assign(db, marsh, maths)
    _assign(db, brook, french)

    return Roster(marsh=marsh, brook=brook, maths=maths, french=french)


@pytest.fixture
def household(db: Session) -> Household:
    full = _make_client(db, name="Full House", phone_number=PHONE)
    empty = _make_client(db, name="Empty Nest", phone_number=FOREIGN_PHONE)
    for _ in range(2):
        _make_home(db, guardian=full)
    _make_home(db, guardian=full, is_archived=True)
    for _ in range(3):
        _make_child(db, guardians=[full])

    return Household(full=full, empty=empty)


@pytest.fixture
def schedule(db: Session) -> Schedule:
    client = _make_client(db)
    child = _make_child(db, guardians=[client])
    maths = _make_subject(db)
    french = _make_subject(db)
    tutor = _make_tutor(db)
    other_tutor = _make_tutor(db)
    home = _make_home(db, guardian=client)

    return Schedule(
        client=client,
        child=child,
        maths=maths,
        french=french,
        tutor=tutor,
        other_tutor=other_tutor,
        maths_early=_book(db, child=child, tutor=tutor, subject=maths, home=home, on=DATE),
        french_middle=_book(db, child=child, tutor=tutor, subject=french, home=home, on=LATER),
        maths_late=_book(
            db,
            child=child,
            tutor=other_tutor,
            subject=maths,
            home=home,
            on=LATEST,
            status=BookingStatus.CONFIRMED,
        ),
    )


def _archived_and_live(db: Session, kind: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Ids of one archived and one live row of the resource behind `kind`."""
    if kind == "users":
        archived, live = _make_user(db), _make_user(db)
        archived.is_archived = True
    elif kind == "tutors":
        archived, live = _make_tutor(db), _make_tutor(db)
        archived.user.is_archived = True
    elif kind == "children":
        archived, live = (_make_child(db, guardians=[]) for _ in range(2))
        archived.is_archived = True
    elif kind == "clients":
        archived, live = _make_client(db), _make_client(db)
        archived.is_archived = True
    else:
        archived, live = _make_subject(db), _make_subject(db)
        archived.is_archived = True
    db.flush()

    return archived.id, live.id


@pytest.mark.parametrize("kind", ["users", "tutors", "children", "clients", "subjects"])
def test_a_list_hides_archived_rows_unless_archived_is_true(
    api: TestClient, db: Session, kind: str
) -> None:
    admin = _make_user(db)
    archived_id, live_id = _archived_and_live(db, kind)
    params = {"page_size": 100}

    default = api.get(f"/api/{kind}", params=params, headers=_auth(admin)).json()
    archived = api.get(
        f"/api/{kind}", params={**params, "archived": "true"}, headers=_auth(admin)
    ).json()

    default_ids = {row["id"] for row in default["items"]}
    archived_ids = {row["id"] for row in archived["items"]}
    assert (str(live_id) in default_ids, str(archived_id) in default_ids) == (True, False)
    assert (str(archived_id) in archived_ids, str(live_id) in archived_ids) == (True, False)
    assert all(row["archived"] is True for row in archived["items"])
    assert all("is_active" not in row for row in default["items"])


@pytest.mark.parametrize("kind", ["users", "tutors", "children", "clients", "subjects"])
def test_a_list_no_longer_recognises_is_active(api: TestClient, db: Session, kind: str) -> None:
    admin = _make_user(db)
    archived_id, live_id = _archived_and_live(db, kind)

    body = api.get(
        f"/api/{kind}", params={"is_active": "false", "page_size": 100}, headers=_auth(admin)
    ).json()

    ids = {row["id"] for row in body["items"]}
    assert (str(live_id) in ids, str(archived_id) in ids) == (True, False)


def test_tutor_q_matches_a_case_differing_substring_of_the_name(
    api: TestClient, db: Session, roster: Roster
) -> None:
    admin = _make_user(db)

    body = api.get("/api/tutors", params={"q": "mARSh"}, headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(roster.marsh.id)]


def test_tutor_q_excludes_a_name_it_is_not_a_substring_of(
    api: TestClient, db: Session, roster: Roster
) -> None:
    admin = _make_user(db)

    body = api.get("/api/tutors", params={"q": "Fontaine"}, headers=_auth(admin)).json()

    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_tutor_q_is_the_same_as_omitting_it(
    api: TestClient, db: Session, roster: Roster, blank: str
) -> None:
    admin = _make_user(db)
    headers = _auth(admin)

    unfiltered = api.get("/api/tutors", headers=headers).json()
    blanked = api.get("/api/tutors", params={"q": blank}, headers=headers).json()

    assert unfiltered["total"] == 2
    assert blanked["total"] == unfiltered["total"]
    assert [row["id"] for row in blanked["items"]] == [row["id"] for row in unfiltered["items"]]


@pytest.mark.parametrize(
    ("q", "expected"),
    [("50%", "Rate 50% Off"), ("Alpha_One", "Alpha_One")],
)
def test_tutor_q_treats_a_like_wildcard_as_a_literal_character(
    api: TestClient, db: Session, q: str, expected: str
) -> None:
    """Unescaped, `%` and `_` are wildcards: `50%` would also match `Rate 5010 Off` and
    `Alpha_One` would also match `AlphaXOne`."""
    admin = _make_user(db)
    for name in ("Rate 50% Off", "Rate 5010 Off", "Alpha_One", "AlphaXOne"):
        _make_tutor(db, name=name)

    body = api.get("/api/tutors", params={"q": q}, headers=_auth(admin)).json()

    assert [row["name"] for row in body["items"]] == [expected]
    assert body["total"] == 1


def test_tutor_q_composes_with_subject_id(api: TestClient, db: Session, roster: Roster) -> None:
    admin = _make_user(db)

    body = api.get(
        "/api/tutors",
        params={"q": "nadia", "subject_id": str(roster.maths.id)},
        headers=_auth(admin),
    ).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(roster.marsh.id)]


def test_tutor_q_composes_with_the_is_active_filter(
    api: TestClient, db: Session, roster: Roster
) -> None:
    admin = _make_user(db)
    roster.brook.user.is_archived = True
    db.flush()

    body = api.get("/api/tutors", params={"q": "nadia"}, headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(roster.marsh.id)]


def test_client_q_matches_a_name_substring(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    priya = _make_client(db, name="Priya Raman", phone_number=PHONE)
    _make_client(db, name="Tomas Silva", phone_number=FOREIGN_PHONE)

    body = api.get("/api/clients", params={"q": "raman"}, headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(priya.id)]


def test_client_q_matches_a_phone_number_substring(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    priya = _make_client(db, name="Priya Raman", phone_number=PHONE)
    _make_client(db, name="Tomas Silva", phone_number=FOREIGN_PHONE)

    body = api.get("/api/clients", params={"q": "5550123"}, headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(priya.id)]


def test_a_client_q_that_is_not_a_dialable_number_is_a_search_not_a_400(
    api: TestClient, db: Session
) -> None:
    """`555` cannot be parsed as a phone number. Running `q` through `normalize_phone_number`
    would answer a reasonable search with `InvalidPhoneNumber`, which the router turns into a
    400."""
    admin = _make_user(db)
    priya = _make_client(db, name="Priya Raman", phone_number=PHONE)
    _make_client(db, name="Tomas Silva", phone_number=FOREIGN_PHONE)

    response = api.get("/api/clients", params={"q": "555"}, headers=_auth(admin))

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["items"]] == [str(priya.id)]


def test_the_exact_phone_number_filter_still_normalises_before_it_queries(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    priya = _make_client(db, name="Priya Raman", phone_number=PHONE)

    body = api.get(
        "/api/clients", params={"phone_number": "(202) 555-0123"}, headers=_auth(admin)
    ).json()

    assert [row["id"] for row in body["items"]] == [str(priya.id)]


def test_the_exact_phone_number_filter_still_400s_on_an_unparseable_value(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_client(db, name="Priya Raman", phone_number=PHONE)

    response = api.get("/api/clients", params={"phone_number": "555"}, headers=_auth(admin))

    assert response.status_code == 400
    assert "phone_number" in response.json()["detail"]


def test_client_q_composes_with_the_exact_phone_number_filter(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_client(db, name="Priya Raman", phone_number=PHONE)

    body = api.get(
        "/api/clients", params={"phone_number": PHONE, "q": "Tomas"}, headers=_auth(admin)
    ).json()

    assert body["total"] == 0
    assert body["items"] == []


def test_client_items_carry_the_home_and_child_counts(
    api: TestClient, db: Session, household: Household
) -> None:
    admin = _make_user(db)

    items = api.get("/api/clients", headers=_auth(admin)).json()["items"]
    counts = {row["name"]: (row["home_count"], row["child_count"]) for row in items}

    assert counts == {"Empty Nest": (0, 0), "Full House": (2, 3)}


def test_neither_a_deactivated_home_nor_an_archived_child_is_counted(
    api: TestClient, db: Session, household: Household
) -> None:
    admin = _make_user(db)
    _make_child(db, guardians=[household.full], is_archived=True)

    body = api.get("/api/clients", params={"q": "Full House"}, headers=_auth(admin)).json()

    assert body["items"][0]["home_count"] == 2
    assert body["items"][0]["child_count"] == 3


def test_the_by_id_response_returns_every_home_and_reports_the_flag_the_count_filtered_on(
    api: TestClient, db: Session, household: Household
) -> None:
    """`docs/api-design.md:69` keeps nested homes outside the collection `is_active` rule, so the
    two numbers differ by design; `HomeRead.archived` is what makes three cards above a count of
    two readable rather than a §11 drift."""
    admin = _make_user(db)
    headers = _auth(admin)

    listed = api.get("/api/clients", params={"q": "Full House"}, headers=headers).json()
    detail = api.get(f"/api/clients/{household.full.id}", headers=headers).json()
    flags = sorted(home["archived"] for home in detail["homes"])

    assert listed["items"][0]["home_count"] == 2
    assert flags == [False, False, True]


def test_total_counts_guardians_not_the_rows_their_links_multiply_into(
    api: TestClient, db: Session
) -> None:
    """A `LEFT JOIN` onto `guardian_homes` and `child_guardians` would make this guardian three
    rows, or nine, and `total` a number no pager can use."""
    admin = _make_user(db)
    crowded = _make_client(db, name="Crowded House", phone_number=PHONE)
    for _ in range(3):
        _make_home(db, guardian=crowded)
        _make_child(db, guardians=[crowded])
    _make_client(db, name="Second Guardian", phone_number=FOREIGN_PHONE)
    headers = _auth(admin)

    whole = api.get("/api/clients", headers=headers).json()
    first = api.get("/api/clients", params={"page_size": 1}, headers=headers).json()

    assert whole["total"] == 2
    assert len(whole["items"]) == 2
    assert first["total"] == 2
    assert len(first["items"]) == 1


def test_the_counts_survive_paging_onto_the_second_page(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_client(db, name="Alpha Guardian", phone_number=PHONE)
    later = _make_client(db, name="Beta Guardian", phone_number=FOREIGN_PHONE)
    _make_home(db, guardian=later)
    _make_child(db, guardians=[later])

    body = api.get("/api/clients", params={"page": 2, "page_size": 1}, headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(later.id)]
    assert body["items"][0]["home_count"] == 1
    assert body["items"][0]["child_count"] == 1


def test_bookings_subject_id_returns_only_that_subjects_bookings(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    body = api.get(
        "/api/bookings", params={"subject_id": str(schedule.maths.id)}, headers=_auth(admin)
    ).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {
        str(schedule.maths_early.id),
        str(schedule.maths_late.id),
    }


def test_bookings_subject_id_composes_with_status(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    body = api.get(
        f"/api/bookings?subject_id={schedule.maths.id}&status=pending&status=confirmed",
        headers=_auth(admin),
    ).json()
    confirmed = api.get(
        f"/api/bookings?subject_id={schedule.maths.id}&status=confirmed", headers=_auth(admin)
    ).json()

    assert body["total"] == 2
    assert [row["id"] for row in confirmed["items"]] == [str(schedule.maths_late.id)]


def test_bookings_subject_id_composes_with_the_date_bounds(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    body = api.get(
        "/api/bookings",
        params={"subject_id": str(schedule.maths.id), "from": "2026-09-08", "to": "2026-09-09"},
        headers=_auth(admin),
    ).json()

    assert [row["id"] for row in body["items"]] == [str(schedule.maths_late.id)]


def test_bookings_subject_id_composes_with_tutor_id(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    body = api.get(
        "/api/bookings",
        params={"subject_id": str(schedule.maths.id), "tutor_id": str(schedule.tutor.id)},
        headers=_auth(admin),
    ).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(schedule.maths_early.id)]


def test_client_bookings_subject_id_narrows_within_that_client(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)
    stranger = _make_client(db)
    stranger_child = _make_child(db, guardians=[stranger])
    _book(
        db,
        child=stranger_child,
        tutor=schedule.other_tutor,
        subject=schedule.maths,
        home=_make_home(db, guardian=stranger),
        on=DATE,
    )

    body = api.get(
        f"/api/clients/{schedule.client.id}/bookings",
        params={"subject_id": str(schedule.maths.id)},
        headers=_auth(admin),
    ).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {
        str(schedule.maths_early.id),
        str(schedule.maths_late.id),
    }


def test_client_bookings_subject_id_composes_with_the_other_filters(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    body = api.get(
        f"/api/clients/{schedule.client.id}/bookings"
        f"?subject_id={schedule.maths.id}&status=confirmed&from=2026-09-09"
        f"&tutor_id={schedule.other_tutor.id}",
        headers=_auth(admin),
    ).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(schedule.maths_late.id)]


def test_an_unknown_booking_subject_id_is_an_empty_page_not_an_error(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    response = api.get(
        "/api/bookings", params={"subject_id": str(uuid.uuid4())}, headers=_auth(admin)
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 20,
        "counts_by_kind": {"regular": 0, "evaluation": 0},
    }


def test_a_malformed_booking_subject_id_is_400_not_422(
    api: TestClient, db: Session, schedule: Schedule
) -> None:
    admin = _make_user(db)

    response = api.get("/api/bookings", params={"subject_id": "sideways"}, headers=_auth(admin))

    assert response.status_code == 400
    assert "subject_id" in response.json()["detail"]


# --- the Guardians list's language and reminders filters ------------------------------------


@pytest.fixture
def languages(db: Session) -> Languages:
    undetected = _make_client(db, name="Ana Undetected")
    _make_conversation(db, guardian=undetected, language=None)
    english = _make_client(db, name="Ben English")
    _make_conversation(db, guardian=english, language=Language.EN)
    spanish = _make_client(db, name="Carla Spanish")
    _make_conversation(db, guardian=spanish, language=Language.ES)
    _consent(db, guardian=spanish, action=ConsentAction.OPT_IN)
    silent = _make_client(db, name="Dan Silent")
    spanish_out = _make_client(db, name="Eva Spanish")
    _make_conversation(db, guardian=spanish_out, language=Language.ES)
    _consent(db, guardian=spanish_out, action=ConsentAction.OPT_OUT)

    return Languages(
        undetected=undetected,
        english=english,
        spanish=spanish,
        silent=silent,
        spanish_out=spanish_out,
    )


def _listed(api: TestClient, headers: dict[str, str], params: dict[str, object]) -> list[str]:
    body = api.get("/api/clients", params=params, headers=headers).json()
    names = [row["name"] for row in body["items"]]
    assert body["total"] == len(names)

    return names


def test_language_en_returns_undetected_and_english_guardians(
    api: TestClient, db: Session, languages: Languages
) -> None:
    names = _listed(api, _auth(_make_user(db)), {"language": "en"})

    assert names == ["Ana Undetected", "Ben English", "Dan Silent"]


def test_two_languages_return_guardians_in_either(
    api: TestClient, db: Session, languages: Languages
) -> None:
    names = _listed(api, _auth(_make_user(db)), {"language": ["en", "es"]})

    assert names == ["Ana Undetected", "Ben English", "Carla Spanish", "Dan Silent", "Eva Spanish"]


def test_two_reminder_states_return_guardians_in_either(
    api: TestClient, db: Session, languages: Languages
) -> None:
    names = _listed(api, _auth(_make_user(db)), {"reminders": ["never", "opt_out"]})

    assert names == ["Ana Undetected", "Ben English", "Dan Silent", "Eva Spanish"]


def test_language_and_reminders_must_both_match(
    api: TestClient, db: Session, languages: Languages
) -> None:
    names = _listed(api, _auth(_make_user(db)), {"language": "es", "reminders": "opt_in"})

    assert names == ["Carla Spanish"]


def test_the_state_filters_compose_with_archived_and_q(
    api: TestClient, db: Session, languages: Languages
) -> None:
    languages.english.is_archived = True
    db.flush()
    headers = _auth(_make_user(db))

    # "ana" is no hex fragment, so it can't match the generated phone numbers.
    assert _listed(api, headers, {"language": "en", "q": "ana"}) == ["Ana Undetected"]
    assert _listed(api, headers, {"language": "en", "archived": True}) == ["Ben English"]


@pytest.mark.parametrize("params", [{"language": "fr"}, {"reminders": "maybe"}])
def test_an_unknown_language_or_reminder_state_is_a_validation_error(
    api: TestClient, db: Session, params: dict[str, str]
) -> None:
    """The app answers every request validation error 400 (`main.handle_validation_error`)."""
    response = api.get("/api/clients", params=params, headers=_auth(_make_user(db)))
    [name] = params

    assert response.status_code == 400
    assert name in response.json()["detail"]


def test_client_q_finds_a_guardian_by_a_childs_name(api: TestClient, db: Session) -> None:
    guardian = _make_client(db, name="Priya Raman", phone_number=PHONE)
    _make_child(db, guardians=[guardian], name="Kiran Raman")
    _make_client(db, name="Tomas Silva", phone_number=FOREIGN_PHONE)

    body = api.get("/api/clients", params={"q": "kiran"}, headers=_auth(_make_user(db))).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(guardian.id)]


def test_client_q_does_not_match_an_archived_childs_name(api: TestClient, db: Session) -> None:
    guardian = _make_client(db, name="Priya Raman", phone_number=PHONE)
    _make_child(db, guardians=[guardian], name="Kiran Raman", is_archived=True)

    body = api.get("/api/clients", params={"q": "kiran"}, headers=_auth(_make_user(db))).json()

    assert (body["total"], body["items"]) == (0, [])


def test_a_guardian_with_two_matching_children_is_counted_once(
    api: TestClient, db: Session
) -> None:
    guardian = _make_client(db, name="Priya Raman", phone_number=PHONE)
    _make_child(db, guardians=[guardian], name="Kiran Twin")
    _make_child(db, guardians=[guardian], name="Kavya Twin")

    body = api.get("/api/clients", params={"q": "twin"}, headers=_auth(_make_user(db))).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(guardian.id)]


def test_a_client_page_reads_in_the_same_number_of_statements_whatever_its_size(
    api: TestClient, db: Session
) -> None:
    headers = _auth(_make_user(db))
    for _ in range(4):
        guardian = _make_client(db)
        _make_home(db, guardian=guardian)
        _make_child(db, guardians=[guardian])
        _make_conversation(db, guardian=guardian, language=Language.ES)
        _consent(db, guardian=guardian, action=ConsentAction.OPT_IN)

    small = _statements_for(db, lambda: api.get("/api/clients?page_size=1", headers=headers))
    large = _statements_for(db, lambda: api.get("/api/clients?page_size=4", headers=headers))

    assert small
    assert len(large) == len(small)


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


def _make_subject(db: Session, *, name: str | None = None) -> Subject:
    subject = Subject(name=name or f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    return subject


def _make_tutor(db: Session, *, name: str | None = None) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(
            email=f"tutor-{suffix}@example.com", name=name or f"Tutor {suffix}", role=UserRole.TUTOR
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    db.add(
        TutorAvailability(
            tutor_id=tutor.id, day_of_week=DATE.weekday(), start_time=NINE, end_time=TWELVE
        )
    )
    db.flush()

    return tutor


def _assign(db: Session, tutor: Tutor, subject: Subject, max_grade_level: int = 12) -> None:
    db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=max_grade_level))
    db.flush()


def _make_client(
    db: Session, *, name: str | None = None, phone_number: str | None = None
) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(
        name=name or f"Client {suffix}", phone_number=phone_number or f"+1{suffix[:10]}"
    )
    db.add(guardian)
    db.flush()

    return guardian


def _make_home(db: Session, *, guardian: Guardian, is_archived: bool = False) -> Home:
    home = Home(address="1 Test Street", access_code="0000", is_archived=is_archived)
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=guardian.id, home_id=home.id))
    db.flush()

    return home


def _make_child(
    db: Session, *, guardians: list[Guardian], name: str | None = None, is_archived: bool = False
) -> Child:
    child = Child(
        name=name or f"Child {uuid.uuid4().hex[:12]}",
        grade_level=7,
        school_name="Test School",
        is_archived=is_archived,
    )
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
    db.flush()

    return child


def _make_conversation(db: Session, *, guardian: Guardian, language: Language | None) -> None:
    db.add(
        Conversation(
            phone_number=guardian.phone_number,
            guardian_id=guardian.id,
            last_message_at=datetime.datetime(2026, 9, 1, 15, 0, tzinfo=datetime.UTC),
            language=language,
        )
    )
    db.flush()


def _consent(db: Session, *, guardian: Guardian, action: ConsentAction) -> None:
    db.add(
        ReminderConsent(
            guardian_id=guardian.id,
            action=action,
            source=ConsentSource.INTAKE,
            phone_number=guardian.phone_number,
        )
    )
    db.flush()


def _book(
    db: Session,
    *,
    child: Child,
    tutor: Tutor,
    subject: Subject,
    home: Home,
    on: datetime.date,
    start: datetime.time = TEN,
    end: datetime.time = ELEVEN,
    status: BookingStatus = BookingStatus.PENDING,
) -> Booking:
    availability_id = db.scalars(
        select(TutorAvailability.id).where(TutorAvailability.tutor_id == tutor.id)
    ).one()
    booking = Booking(
        child_id=child.id,
        user_id=tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=subject.id,
        availability_id=availability_id,
        home_id=home.id,
        booked_by_guardian_id=None,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking
