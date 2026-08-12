from app.models import metadata

EXPECTED_COLUMNS = {
    "id",
    "user_id",
    "family_id",
    "issued_at",
    "expires_at",
    "revoked_at",
    "replaced_by_id",
}


def test_refresh_tokens_table_registered() -> None:
    assert "refresh_tokens" in metadata.tables


def test_refresh_tokens_columns_exact() -> None:
    table = metadata.tables["refresh_tokens"]

    assert set(table.columns.keys()) == EXPECTED_COLUMNS


def test_revoked_at_nullable_expires_at_not() -> None:
    table = metadata.tables["refresh_tokens"]

    assert table.columns["revoked_at"].nullable is True
    assert table.columns["expires_at"].nullable is False


def test_user_id_and_family_id_indexed() -> None:
    table = metadata.tables["refresh_tokens"]
    indexed_columns = {c.name for index in table.indexes for c in index.columns}

    assert "user_id" in indexed_columns
    assert "family_id" in indexed_columns


def test_two_foreign_keys() -> None:
    table = metadata.tables["refresh_tokens"]
    targets = {fk.target_fullname for fk in table.foreign_keys}

    assert len(table.foreign_keys) == 2
    assert targets == {"users.id", "refresh_tokens.id"}
