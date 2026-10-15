"""Rename homes.access_code to directions: optional, up to 500 characters

Revision ID: 0043
Revises: 0042
Create Date: 2026-10-15 00:00:00.000000

A Home's `access_code` was a required 64-character code, so a Home without one stored the
placeholder "none". It becomes `directions`: optional free text for Staff on how to get in
(gate or door code, parking, which entrance). The placeholder and blank values become `NULL`
(#219).

The downgrade writes "none" back for `NULL`, cuts longer directions to 64 characters, and
restores the NOT NULL column under its old name.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0043'
down_revision: str | None = '0042'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'homes'
OLD_COLUMN = 'access_code'
NEW_COLUMN = 'directions'
OLD_LENGTH = 64
NEW_LENGTH = 500
NO_ACCESS_CODE = 'none'


def upgrade() -> None:
    op.alter_column(
        TABLE,
        OLD_COLUMN,
        new_column_name=NEW_COLUMN,
        type_=sa.String(NEW_LENGTH),
        existing_type=sa.String(OLD_LENGTH),
        nullable=True,
        existing_nullable=False,
    )
    op.execute(
        f"UPDATE {TABLE} SET {NEW_COLUMN} = NULL"
        f" WHERE lower(trim({NEW_COLUMN})) = '{NO_ACCESS_CODE}' OR trim({NEW_COLUMN}) = ''"
    )


def downgrade() -> None:
    op.execute(
        f"UPDATE {TABLE} SET {NEW_COLUMN} = coalesce(left({NEW_COLUMN}, {OLD_LENGTH}),"
        f" '{NO_ACCESS_CODE}')"
    )
    op.alter_column(
        TABLE,
        NEW_COLUMN,
        new_column_name=OLD_COLUMN,
        type_=sa.String(OLD_LENGTH),
        existing_type=sa.String(NEW_LENGTH),
        nullable=False,
        existing_nullable=True,
    )
