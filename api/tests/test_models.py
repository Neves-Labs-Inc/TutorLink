import datetime

from app.models import metadata

EXPECTED_TABLES = {
    "users",
    "guardians",
    "homes",
    "child_guardians",
    "child_homes",
    "guardian_homes",
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


def test_grade_level_is_comparable_not_a_label() -> None:
    """The rule is an ordering — a tutor takes a student at or below their own grade — so
    both sides have to be numbers. Free text sorts 'Grade 10' before 'Grade 7'."""
    children = metadata.tables["children"]
    tutor_subjects = metadata.tables["tutor_subjects"]

    assert children.c.grade_level.type.python_type is int
    assert tutor_subjects.c.max_grade_level.type.python_type is int
    assert "grade_levels" not in tutor_subjects.c


def test_identity_and_location_are_separate_tables() -> None:
    """`parents` fused who the client is with where they live, which works only while a child
    has one of each. Separated guardians mean two of both."""
    guardians = metadata.tables["guardians"]

    assert "address" not in guardians.c
    assert "access_code" not in guardians.c
    assert "address" in metadata.tables["homes"].c


def test_a_child_has_many_guardians_and_many_homes() -> None:
    children = metadata.tables["children"]

    assert "parent_id" not in children.c
    for junction, columns in (
        ("child_guardians", {"child_id", "guardian_id"}),
        ("child_homes", {"child_id", "home_id"}),
        ("guardian_homes", {"guardian_id", "home_id"}),
    ):
        assert columns <= set(metadata.tables[junction].c.keys()), junction


def test_junctions_are_hard_delete() -> None:
    """No `is_active`, matching tutor_subjects. A link is not an entity, so unlinking a
    guardian after a custody change is a DELETE and takes effect immediately."""
    for junction in ("child_guardians", "child_homes", "guardian_homes"):
        assert "is_active" not in metadata.tables[junction].c, junction


def test_an_exception_may_block_part_of_a_day() -> None:
    """A dentist appointment at 09:00 does not cost the tutor the afternoon. NULL on both
    times means the whole day, so every row written before the columns existed still reads
    the same — and the pair constraint keeps that NULL unambiguous."""
    exceptions = metadata.tables["tutor_availability_exceptions"]

    assert exceptions.c.start_time.nullable is True
    assert exceptions.c.end_time.nullable is True
    assert exceptions.c.start_time.type.python_type is datetime.time
    assert exceptions.c.end_time.type.python_type is datetime.time

    names = {c.name for c in exceptions.constraints}
    assert "ck_tutor_availability_exceptions_time_pair" in names
    assert "ck_tutor_availability_exceptions_time_order" in names


def test_a_booking_names_its_home_and_may_name_who_booked_it() -> None:
    """home_id cannot be derived once a child has two homes, and a tutor with no address
    cannot work — so it is required. booked_by_guardian_id is NULL for admin bookings."""
    bookings = metadata.tables["bookings"]

    assert bookings.c.home_id.nullable is False
    assert bookings.c.booked_by_guardian_id.nullable is True
