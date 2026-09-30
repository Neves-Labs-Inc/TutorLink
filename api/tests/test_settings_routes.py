"""`/api/settings` over the wire — issue #17's "refusal of a hand-crafted request", discharged.

The service-level suite proves the gate decides correctly; this one proves the decision survives
the HTTP boundary — that the router hands the caller's real role to the service, that a filtered
read and a refused write reach the client as such, and that the refusal is a 403 with its own
message rather than anything a caller could mistake for the route gate.

Three things here are easy to assert vacuously, and each is written to fail loudly instead:

- **The role filter.** Every row a migration seeds is `is_developer_only = FALSE`, so a filter
  that is silently a no-op is indistinguishable from a working one against real data. Every gate
  test below creates its own developer-only row, so making `_may_see_developer_only` return
  `True` unconditionally fails this file rather than passing it.
- **The fail-closed default.** `is_developer_only` is a `server_default` with no Python-side
  default (`app/models/system_setting.py:37-39`), so a freshly constructed `SystemSetting` reads
  `None`, and `None` is falsy. The test covering it flushes, refreshes, and asserts the value is
  `True` before it asserts anything about the gate.
- **The two 403s.** A tutor gets `ADMIN_REQUIRED_ERROR` from the route gate; an admin naming a
  developer-only key gets `SETTING_NOT_EDITABLE_ERROR` from the field-level one. Asserting only
  the status would let the two collapse into each other unnoticed, so the message is asserted
  and the distinctness is asserted separately.

Row counts are never asserted. The test database is built by `metadata.create_all`, which
reproduces no migration data, so only the four rate-limit rows exist here — migration 0004's
five settings do not. Tests create what they assert on, under a `uuid4`-suffixed key, and
compare key *sets* rather than sizes.

There is deliberately no HTTP test for `SettingValueTypeUnsupported`: `TestClient` re-raises
server exceptions, so such a test would measure the test client rather than the route. The
service suite covers it.
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.enums import UserRole
from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.settings import (
    DUPLICATE_KEY_ERROR,
    SETTING_NOT_EDITABLE_ERROR,
    SETTING_NOT_FOUND_ERROR,
    SETTING_VALUE_INVALID_ERROR,
)
from app.security import create_access_token, hash_password
from app.services.rate_limit_service import IP_MAX_ATTEMPTS_SETTING

PASSWORD = "correct horse battery staple"
SETTINGS_URL = "/api/settings"


# --- the envelope and the item shape ---------------------------------------------------------


def test_get_returns_the_page_envelope_never_a_bare_array(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_setting(db, key=_unique_key("envelope"), value="1")

    body = api.get(SETTINGS_URL, headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert body["page"] == 1
    assert body["page_size"] == body["total"] == len(body["items"])


def test_each_item_carries_exactly_the_four_setting_fields(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_setting(db, key=_unique_key("shape"), value="1")

    body = api.get(SETTINGS_URL, headers=_auth(admin)).json()

    assert body["items"]
    assert all(
        set(item) == {"key", "value", "value_type", "is_developer_only"} for item in body["items"]
    )


def test_items_are_ordered_by_key_ascending(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_setting(db, key=_unique_key("zzz"), value="1")
    _make_setting(db, key=_unique_key("aaa"), value="1")

    keys = _keys(api.get(SETTINGS_URL, headers=_auth(admin)).json())

    assert keys == sorted(keys)


def test_every_item_an_admin_receives_is_flagged_not_developer_only(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_setting(db, key=_unique_key("developer_only"), value="1", is_developer_only=True)

    body = api.get(SETTINGS_URL, headers=_auth(admin)).json()

    assert body["items"]
    assert all(item["is_developer_only"] is False for item in body["items"])


# --- the route gate --------------------------------------------------------------------------


@pytest.mark.parametrize("method", ["GET", "PATCH"])
def test_a_tutor_is_refused_on_both_endpoints(api: TestClient, db: Session, method: str) -> None:
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)

    response = api.request(
        method, SETTINGS_URL, headers=_auth(tutor), json=_updates(IP_MAX_ATTEMPTS_SETTING, "20")
    )

    assert response.status_code == 403
    # Never an empty envelope: a denial that looks like a successful empty list proves nothing
    # about whether the caller was denied (CONSTITUTION.md §4).
    assert response.json() == {"detail": ADMIN_REQUIRED_ERROR}


@pytest.mark.parametrize("method", ["GET", "PATCH"])
def test_no_token_is_401_not_403(api: TestClient, method: str) -> None:
    response = api.request(method, SETTINGS_URL, json=_updates(IP_MAX_ATTEMPTS_SETTING, "20"))

    assert response.status_code == 401
    assert response.json() == {"detail": CREDENTIALS_ERROR}


# --- the field-level gate --------------------------------------------------------------------


def test_a_developer_only_row_is_invisible_to_an_admin_and_visible_to_a_developer(
    api: TestClient, db: Session
) -> None:
    key = _unique_key("developer_only")
    _make_setting(db, key=key, value="1", is_developer_only=True)
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    admin_keys = set(_keys(api.get(SETTINGS_URL, headers=_auth(admin)).json()))
    developer_keys = set(_keys(api.get(SETTINGS_URL, headers=_auth(developer)).json()))

    assert developer_keys - admin_keys == {key}


def test_an_admin_patching_a_developer_only_key_is_refused_and_the_row_is_untouched(
    api: TestClient, db: Session
) -> None:
    key = _unique_key("developer_only")
    row = _make_setting(db, key=key, value="1", is_developer_only=True)
    admin = _make_user(db)

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_updates(key, "2"))

    assert response.status_code == 403
    assert response.json() == {"detail": SETTING_NOT_EDITABLE_ERROR}
    # The field-level refusal must stay tellable apart from the route gate's: they share a
    # status, and a caller who cannot tell them apart cannot tell "wrong role for this API" from
    # "wrong role for this one setting".
    assert SETTING_NOT_EDITABLE_ERROR != ADMIN_REQUIRED_ERROR
    assert _stored_value(db, row) == "1"


def test_a_developer_may_patch_a_developer_only_key(api: TestClient, db: Session) -> None:
    key = _unique_key("developer_only")
    row = _make_setting(db, key=key, value="1", is_developer_only=True)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.patch(SETTINGS_URL, headers=_auth(developer), json=_updates(key, "2"))

    assert response.status_code == 200
    assert _item(response.json(), key)["value"] == "2"
    assert _stored_value(db, row) == "2"


def test_a_row_left_to_the_server_default_is_gated_as_an_explicit_one_is(
    api: TestClient, db: Session
) -> None:
    key = _unique_key("defaulted")
    row = _make_setting(db, key=key, value="1", is_developer_only=None)
    db.refresh(row)
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    # Asserted, not assumed: unrefreshed the attribute is `None`, which is falsy, and everything
    # below would pass while demonstrating the opposite of fail-closed.
    assert row.is_developer_only is True

    refused = api.patch(SETTINGS_URL, headers=_auth(admin), json=_updates(key, "2"))
    allowed = api.patch(SETTINGS_URL, headers=_auth(developer), json=_updates(key, "3"))

    assert key not in _keys(api.get(SETTINGS_URL, headers=_auth(admin)).json())
    assert key in _keys(api.get(SETTINGS_URL, headers=_auth(developer)).json())
    assert refused.status_code == 403
    assert refused.json() == {"detail": SETTING_NOT_EDITABLE_ERROR}
    assert allowed.status_code == 200
    assert _stored_value(db, row) == "3"


# --- write semantics -------------------------------------------------------------------------


def test_patch_returns_exactly_what_get_returns_for_the_same_caller(
    api: TestClient, db: Session
) -> None:
    key = _unique_key("happy")
    _make_setting(db, key=key, value="1")
    headers = _auth(_make_user(db))

    patched = api.patch(SETTINGS_URL, headers=headers, json=_updates(key, "90"))
    fetched = api.get(SETTINGS_URL, headers=headers)

    assert patched.status_code == 200
    assert _item(patched.json(), key)["value"] == "90"
    assert patched.json() == fetched.json()


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_an_unknown_key_is_404_for_every_role(api: TestClient, db: Session, role: UserRole) -> None:
    # Same status and message for both, so the failure cannot be read as an oracle for which
    # keys a developer can see.
    user = _make_user(db, role=role)

    response = api.patch(SETTINGS_URL, headers=_auth(user), json=_updates("no_such_setting", "1"))

    assert response.status_code == 404
    assert response.json() == {"detail": SETTING_NOT_FOUND_ERROR}


def test_a_key_named_twice_in_one_request_is_refused(api: TestClient, db: Session) -> None:
    key = _unique_key("duplicate")
    row = _make_setting(db, key=key, value="1")
    admin = _make_user(db)
    payload = {"updates": [{"key": key, "value": "2"}, {"key": key, "value": "3"}]}

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": DUPLICATE_KEY_ERROR}
    assert _stored_value(db, row) == "1"


def test_an_empty_update_list_is_refused(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json={"updates": []})

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_a_numeric_value_is_refused_rather_than_coerced(api: TestClient, db: Session) -> None:
    # `value` is a string on the wire for every setting or for none: a client that may send 90
    # here and "90" there is a client whose settings form works by accident.
    key = _unique_key("numeric")
    row = _make_setting(db, key=key, value="1")
    admin = _make_user(db)
    payload = {"updates": [{"key": key, "value": 90}]}

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert _stored_value(db, row) == "1"


@pytest.mark.parametrize("value", ["soon", "", " ", "12.5", "1_0"])
def test_a_value_that_is_not_an_integer_is_refused(
    api: TestClient, db: Session, value: str
) -> None:
    key = _unique_key("invalid")
    row = _make_setting(db, key=key, value="1")
    admin = _make_user(db)

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_updates(key, value))

    assert response.status_code == 400
    assert response.json() == {"detail": SETTING_VALUE_INVALID_ERROR}
    assert _stored_value(db, row) == "1"


def test_the_rate_limit_kill_switch_value_is_still_accepted(api: TestClient, db: Session) -> None:
    # "0" disables the limiter and is the documented escape hatch (D-009). Write validation
    # arriving must not have taken it away.
    admin = _make_user(db)

    response = api.patch(
        SETTINGS_URL, headers=_auth(admin), json=_updates(IP_MAX_ATTEMPTS_SETTING, "0")
    )

    assert response.status_code == 200
    assert _item(response.json(), IP_MAX_ATTEMPTS_SETTING)["value"] == "0"


def test_one_refused_update_leaves_the_rest_of_the_batch_unwritten(
    api: TestClient, db: Session
) -> None:
    good_key = _unique_key("writable")
    refused_key = _unique_key("developer_only")
    good = _make_setting(db, key=good_key, value="1")
    _make_setting(db, key=refused_key, value="1", is_developer_only=True)
    admin = _make_user(db)
    payload = {"updates": [{"key": good_key, "value": "90"}, {"key": refused_key, "value": "2"}]}

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=payload)

    assert response.status_code == 403
    assert response.json() == {"detail": SETTING_NOT_EDITABLE_ERROR}
    assert _stored_value(db, good) == "1"


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


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password(PASSWORD),
        role=role,
        tutor_id=tutor_id,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    return {"Authorization": f"Bearer {token}"}


def _make_setting(
    db: Session,
    *,
    key: str,
    value: str,
    value_type: str = SETTING_VALUE_TYPE_INTEGER,
    is_developer_only: bool | None = False,
) -> SystemSetting:
    """Insert one row through the rolled-back session; `is_developer_only=None` omits the
    column so the `server_default` decides, which is the fail-closed case."""
    columns: dict[str, Any] = {"key": key, "value": value, "value_type": value_type}

    if is_developer_only is not None:
        columns["is_developer_only"] = is_developer_only

    row = SystemSetting(**columns)
    db.add(row)
    db.flush()

    return row


def _unique_key(label: str) -> str:
    return f"{label}_{uuid.uuid4().hex}"


def _updates(key: str, value: str) -> dict[str, Any]:
    return {"updates": [{"key": key, "value": value}]}


def _keys(body: dict[str, Any]) -> list[str]:
    return [item["key"] for item in body["items"]]


def _item(body: dict[str, Any], key: str) -> dict[str, Any]:
    return next(item for item in body["items"] if item["key"] == key)


def _stored_value(db: Session, row: SystemSetting) -> str:
    db.refresh(row)

    return row.value
