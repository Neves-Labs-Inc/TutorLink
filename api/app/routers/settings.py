"""`/api/settings` — the one resource whose gate is per field rather than per route.

Both endpoints are `AdminPrincipal`, so a tutor reaches neither, and a developer reaches both
exactly as an admin does — constitution §5's rule that a route gate asks "admin or above" is
unaffected here. What differs between the two roles is which rows come back and which rows may
be written, and that decision belongs to `settings_service`, which is handed `user.role` and
answers it in SQL (D-010). This router never asks "is this caller a developer".

**A read filters silently; a write refuses loudly.** The asymmetry reads like an inconsistency
until it is stated, so it is stated here. A read asks "what may I see", and a list containing
only what the caller may see is a complete and honest answer to that question — there is
nothing to refuse. A write asks "change this specific thing", and quietly not changing it is a
lie the caller cannot detect; `docs/api-design.md:255` requires it be "refused rather than
silently ignored". Hence `GET` omits a developer-only row and `PATCH` naming one is a 403.

That refusal is **403, not a 404 that hides the key's existence** (D-006, `STATE.md` OQ-1).
Three reasons, and the first is the project's own rule: a denial disguised as a 404 "looks
correct in a browser while proving nothing about whether the caller was actually denied"
(`dependencies.py:49-52`). Second, the developer boundary exists to stop an admin *escalating*
— an admin already reads every client, child, booking, and user account, so learning that a key
they may not write exists grants no path to escalation, while being able to write it does.
Third, a test asserting 404 cannot tell "the gate refused me" apart from "the seed row is
missing", which is the failure mode that makes the acceptance criterion untestable. The cost
accepted is that an admin can enumerate developer-only key names by guessing them.

`PATCH` returns the same envelope `GET` would return for the same caller (D-011): the resource
is a singleton, so a write returns the singleton's new state and the dashboard's cache settles
in one round trip. The whole batch applies or none of it does — the service validates every
update before assigning any, so a partial write is impossible by construction rather than by
this module remembering where to put its `commit()`.

Neither route takes `TutorScope`. `system_settings` has no `tutor_id`, so the unapplied-scope
guard is never armed here, and taking the dependency would give a tutorless resource a
`?tutor_id=` query parameter that means nothing.
"""

from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.models.system_setting import SystemSetting
from app.schemas.settings import SettingRead, SettingsPage, SettingsUpdate
from app.services import clock
from app.services.settings_service import (
    BUSINESS_TIMEZONE_SETTING,
    BusinessTimezoneUnknown,
    SettingKeyDuplicated,
    SettingLocked,
    SettingNotEditable,
    SettingNotFound,
    SettingUpdate,
    SettingValueInvalid,
    apply_setting_updates,
    list_settings,
    read_settings_flags,
)

BUSINESS_TIMEZONE_INVALID_ERROR = (
    "That is not a known IANA time zone; use a name like America/New_York"
)
BUSINESS_TIMEZONE_LOCKED_ERROR = (
    "The business time zone is locked once a booking exists; only a developer can change it"
)
DUPLICATE_KEY_ERROR = "A setting may appear only once in one request"
SETTING_VALUE_INVALID_ERROR = "That value is not valid for this setting's type"
SETTING_NOT_FOUND_ERROR = "No such setting"
SETTING_NOT_EDITABLE_ERROR = "That setting is not editable with your role"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsPage)
def read_all(user: AdminPrincipal, db: DbSession) -> SettingsPage:
    return _page(db, list_settings(db, actor_role=user.role))


@router.patch("", response_model=SettingsPage)
def update_many(payload: SettingsUpdate, user: AdminPrincipal, db: DbSession) -> SettingsPage:
    try:
        rows = apply_setting_updates(
            db,
            actor_role=user.role,
            updates=[SettingUpdate(key=item.key, value=item.value) for item in payload.updates],
        )
    except SettingKeyDuplicated as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_KEY_ERROR
        ) from exc
    except SettingNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=SETTING_NOT_FOUND_ERROR
        ) from exc
    except SettingLocked as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=BUSINESS_TIMEZONE_LOCKED_ERROR
        ) from exc
    except SettingNotEditable as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=SETTING_NOT_EDITABLE_ERROR
        ) from exc
    except BusinessTimezoneUnknown as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=BUSINESS_TIMEZONE_INVALID_ERROR
        ) from exc
    except SettingValueInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=SETTING_VALUE_INVALID_ERROR
        ) from exc

    # `SettingValueTypeUnsupported` is absent on purpose and must stay absent: a `value_type`
    # this codebase has no validator for is a migration that shipped without its validator, not
    # something the caller did. Mapping it to a 4xx would tell an admin they sent a bad request
    # and leave the unvalidatable row quietly writable (REQ-176).

    db.commit()

    # After the commit, so the cache never holds a zone that a failed commit rolled back.
    if any(item.key == BUSINESS_TIMEZONE_SETTING for item in payload.updates):
        clock.refresh_business_zone(db)

    return _page(db, rows)


def _page(db: Session, rows: Sequence[SystemSetting]) -> SettingsPage:
    # Built field by field rather than with `model_validate(row)`: the constitution forbids an
    # ORM instance crossing the HTTP boundary, and an explicit constructor is what makes adding
    # a column to the table a decision to expose it rather than an accident.
    items = [
        SettingRead(
            key=row.key,
            value=row.value,
            value_type=row.value_type,
            is_developer_only=row.is_developer_only,
        )
        for row in rows
    ]

    # `page_size == total`, honestly reporting that this page held everything: the endpoint
    # takes no paging parameters, because a settings form that renders only some of its fields
    # is a defect (D-012).
    flags = read_settings_flags(db)

    return SettingsPage(
        items=items,
        total=len(items),
        page=1,
        page_size=len(items),
        business_timezone_locked=flags.business_timezone_locked,
        reminders_paused=flags.reminders_paused,
    )
