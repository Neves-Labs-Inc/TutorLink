"""`slot_service`'s pure Location rule: the tutor's range decides, the Guardian's wish second."""

import pytest

from app.models.enums import AvailabilityMode, BookingLocation
from app.services.slot_service import resolve_location

HOME = BookingLocation.HOME
OFFICE = BookingLocation.IN_OFFICE


@pytest.mark.parametrize(
    ("mode", "requested", "resolved"),
    [
        (AvailabilityMode.ONLY_OFFICE, HOME, OFFICE),
        (AvailabilityMode.ONLY_OFFICE, OFFICE, OFFICE),
        (AvailabilityMode.ONLY_OFFICE, None, OFFICE),
        (AvailabilityMode.ANYWHERE, HOME, HOME),
        (AvailabilityMode.ANYWHERE, OFFICE, OFFICE),
        (AvailabilityMode.ANYWHERE, None, HOME),
        (AvailabilityMode.TRAVELER, HOME, HOME),
        (AvailabilityMode.TRAVELER, OFFICE, None),
        (AvailabilityMode.TRAVELER, None, HOME),
    ],
)
def test_a_range_holds_its_slots_where_its_mode_and_the_request_resolve(
    mode: AvailabilityMode, requested: BookingLocation | None, resolved: BookingLocation | None
) -> None:
    assert resolve_location(mode, requested) is resolved
