"""One canonical phone number format, produced by one function (#55, REQ-037).

`guardians.phone_number` is UNIQUE, and the bot resolves a returning client by looking that
column up. So `+1 (555) 123-4567`, `555-123-4567`, `15551234567` and `+15551234567` have to
become the same string before they reach the database — otherwise the same guardian is four
rows that no constraint objects to, and the lookup that was supposed to find them finds none.
Every write path and the `?phone_number=` filter call this, so both sides of that comparison
are produced by the same code.

**E.164** (`+15551234567`) is the canonical form: it is unambiguous without a region, it is
what WhatsApp addresses a handset with, and at 16 characters it fits `VARCHAR(32)` with room
to spare.

**A service function, not a Pydantic validator.** The parsing region is a `system_settings`
row, and a validator has no `Session` to read it with. `user_service.py:85` already sets the
precedent — inbound email is lowercased in the service, not in the schema — and REQ-037.2
fixes it for this value.

**The region is read on every call, with no module-level cache.** `settings_service`'s
docstring states the rule and the reason; both apply unchanged here. An admin moving the
default country code takes effect on the next request, and a cached region would be a
canonical form that quietly disagrees with the rows already stored under the old one.

**Nothing silently passes through.** An input this module cannot parse or cannot validate
raises; it never returns the string it was handed. A passthrough would write a non-canonical
number into a UNIQUE column, which is the duplicate-row hole this whole module exists to
close, reopened on exactly the inputs that need it most.

Phase 7's `conversations.phone_number` is keyed on this same canonical form (`docs/erd.md`
§conversations). A thread stays on the number it was actually held with, so when a guardian
changes handset the new number opens a second thread and the old thread is **never**
re-pointed. Nothing here or downstream may rewrite an existing conversation's key.

This module knows nothing about FastAPI; it raises the domain exceptions below and the caller
decides what they mean. Nothing here writes or commits.
"""

import phonenumbers
from sqlalchemy.orm import Session

from app.services.settings_service import get_int_setting

DEFAULT_COUNTRY_CODE_SETTING = "default_phone_country_code"


class PhoneNumberError(Exception):
    """Base class for every failure this module reports."""


class InvalidPhoneNumber(PhoneNumberError):
    """The input is not a phone number this module can canonicalise."""


class PhoneRegionNotConfigured(PhoneNumberError):
    """`default_phone_country_code` names a calling code no region owns.

    A deploy error rather than a client error, in the shape of `settings_service`'s
    `SettingValueTypeUnsupported`: an admin set the setting to something
    `phonenumbers` cannot map to a region, so a bare national number cannot be
    parsed through no fault of the caller's. Deliberately a sibling of
    `InvalidPhoneNumber`, not a subclass, so it propagates past the router's
    `except InvalidPhoneNumber` and surfaces as a 500 — a 400 here would send an
    admin hunting a phone number that was never the problem.
    """


def normalize_phone_number(db: Session, *, raw: str) -> str:
    country_code = get_int_setting(db, key=DEFAULT_COUNTRY_CODE_SETTING)
    region = phonenumbers.region_code_for_country_code(country_code)

    if region == "ZZ" and not raw.strip().startswith("+"):
        raise PhoneRegionNotConfigured(
            f"country code {country_code!r} for {DEFAULT_COUNTRY_CODE_SETTING!r} "
            "does not map to a region"
        )

    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException as exc:
        raise InvalidPhoneNumber(f"cannot parse {raw!r} as a phone number") from exc

    if not phonenumbers.is_valid_number(parsed):
        raise InvalidPhoneNumber(f"{raw!r} is not a valid phone number")

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
