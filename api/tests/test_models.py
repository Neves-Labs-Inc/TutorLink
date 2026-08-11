"""Metadata-level assertions about the ERD schema. No live database required."""

from app.db import Base

EXPECTED_TABLES = {
    "users",
    "parents",
    "children",
    "subjects",
    "tutors",
    "tutor_subjects",
    "tutor_availability",
    "tutor_availability_exceptions",
    "bookings",
}


def test_all_erd_tables_registered() -> None:
    import app.models  # noqa: F401  — import registers every model on Base.metadata

    assert EXPECTED_TABLES <= set(Base.metadata.tables)


def test_nine_tables_exactly() -> None:
    import app.models  # noqa: F401

    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_partial_unique_index_on_bookings() -> None:
    import app.models  # noqa: F401

    bookings = Base.metadata.tables["bookings"]
    index = next(i for i in bookings.indexes if i.name == "uq_booking_live_slot")

    assert index.unique is True
    assert [c.name for c in index.columns] == ["tutor_id", "scheduled_date", "start_time"]
    where = index.dialect_options["postgresql"]["where"]
    assert "pending" in str(where) and "confirmed" in str(where)


def test_enum_types_are_not_implicitly_created() -> None:
    from app.models.enums import booking_status_enum, user_role_enum

    assert user_role_enum.create_type is False
    assert booking_status_enum.create_type is False
