"""is_active to is_archived

"Active" becomes "archived" in storage on the five archivable tables. `tutors.is_active` and
`tutor_availability.is_active` are not archivable records and keep their flag.

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0037'
down_revision: str | None = '0036'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ('users', 'children', 'guardians', 'homes', 'subjects')


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column('is_archived', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        )
        op.execute(f'UPDATE {table} SET is_archived = NOT is_active')
        op.drop_column(table, 'is_active')


def downgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        )
        op.execute(f'UPDATE {table} SET is_active = NOT is_archived')
        op.drop_column(table, 'is_archived')
