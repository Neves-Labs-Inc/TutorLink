from app.models import metadata

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
    "system_settings",
}

NON_ERD_TABLES = {
    "refresh_tokens",
}


def test_all_erd_tables_registered() -> None:
    assert EXPECTED_TABLES <= set(metadata.tables)


def test_no_unexpected_tables() -> None:
    assert set(metadata.tables) == EXPECTED_TABLES | NON_ERD_TABLES


def test_partial_unique_index_on_bookings() -> None:
    bookings = metadata.tables["bookings"]
    index = next(i for i in bookings.indexes if i.name == "uq_booking_live_slot")

    assert index.unique is True
    assert [c.name for c in index.columns] == ["tutor_id", "scheduled_date", "start_time"]
    where = index.dialect_options["postgresql"]["where"]
    assert "pending" in str(where) and "confirmed" in str(where)


def test_enum_types_are_not_implicitly_created() -> None:
    from app.models.enums import booking_status_enum, user_role_enum

    assert user_role_enum.create_type is False
    assert booking_status_enum.create_type is False


def test_system_setting_hides_from_admins_unless_told_otherwise() -> None:
    """`is_developer_only` defaults TRUE so a setting inserted without an explicit flag hides
    from admins rather than leaking to them. The five seeded rows each say FALSE out loud."""
    system_settings = metadata.tables["system_settings"]

    assert system_settings.c.is_developer_only.nullable is False
    assert "true" in str(system_settings.c.is_developer_only.server_default.arg).lower()


def test_system_setting_key_is_unique() -> None:
    system_settings = metadata.tables["system_settings"]
    constraint = next(c for c in system_settings.constraints if c.name == "uq_system_settings_key")

    assert [c.name for c in constraint.columns] == ["key"]
