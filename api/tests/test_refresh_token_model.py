"""Metadata-level assertions about the refresh_tokens table. No live database required."""

from app.db import Base

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
    import app.models  # noqa: F401  — import registers every model on Base.metadata

    assert "refresh_tokens" in Base.metadata.tables


def test_refresh_tokens_columns_exact() -> None:
    import app.models  # noqa: F401

    table = Base.metadata.tables["refresh_tokens"]
    assert set(table.columns.keys()) == EXPECTED_COLUMNS


def test_revoked_at_nullable_expires_at_not() -> None:
    import app.models  # noqa: F401

    table = Base.metadata.tables["refresh_tokens"]
    assert table.columns["revoked_at"].nullable is True
    assert table.columns["expires_at"].nullable is False


def test_user_id_and_family_id_indexed() -> None:
    import app.models  # noqa: F401

    table = Base.metadata.tables["refresh_tokens"]
    indexed_columns = {c.name for index in table.indexes for c in index.columns}
    assert "user_id" in indexed_columns
    assert "family_id" in indexed_columns


def test_two_foreign_keys() -> None:
    import app.models  # noqa: F401

    table = Base.metadata.tables["refresh_tokens"]
    assert len(table.foreign_keys) == 2
    targets = {fk.target_fullname for fk in table.foreign_keys}
    assert targets == {"users.id", "refresh_tokens.id"}
