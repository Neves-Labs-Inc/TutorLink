"""Add tutor_availability_exceptions.created_by: who entered a Time off row

Revision ID: 0046
Revises: 0045
Create Date: 2026-10-16 00:00:00.000000

Every create records its caller from now on: the person themselves for a request, an Admin role
for an entry made on someone's behalf. Existing rows stay null, since nothing recorded who wrote
them (and there is no real data yet). A plain foreign key, as `decided_by` and `cancelled_by`
are.

The downgrade drops the column, and with it who entered each row.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0046'
down_revision: str | None = '0045'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'tutor_availability_exceptions'
COLUMN = 'created_by'
CREATED_BY_FK = 'fk_tutor_availability_exceptions_created_by_users'


def upgrade() -> None:
    op.add_column(TABLE, sa.Column(COLUMN, sa.UUID(), nullable=True))
    op.create_foreign_key(CREATED_BY_FK, TABLE, 'users', [COLUMN], ['id'])


def downgrade() -> None:
    op.drop_constraint(CREATED_BY_FK, TABLE, type_='foreignkey')
    op.drop_column(TABLE, COLUMN)
