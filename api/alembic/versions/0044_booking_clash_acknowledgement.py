"""Add the Time off clash acknowledgement to bookings: who kept it, and when

Revision ID: 0044
Revises: 0043
Create Date: 2026-10-15 00:00:00.000000

An Admin may keep a Booking over approved Time off on purpose (#209). The acknowledgement is
the pair `clash_acknowledged_by` / `clash_acknowledged_at`, both NULL or both set, in the same
paired-null style as `children.evaluated_*`. Every existing Booking starts unacknowledged.

The downgrade drops the check and both columns, and with them every acknowledgement.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0044'
down_revision: str | None = '0043'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'bookings'
PAIR_CONSTRAINT = 'ck_bookings_clash_acknowledgement_pair'


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column('clash_acknowledged_by', sa.UUID(), sa.ForeignKey('users.id'), nullable=True),
    )
    op.add_column(
        TABLE, sa.Column('clash_acknowledged_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        PAIR_CONSTRAINT,
        TABLE,
        '(clash_acknowledged_by IS NULL) = (clash_acknowledged_at IS NULL)',
    )


def downgrade() -> None:
    op.drop_constraint(PAIR_CONSTRAINT, TABLE, type_='check')
    op.drop_column(TABLE, 'clash_acknowledged_at')
    op.drop_column(TABLE, 'clash_acknowledged_by')
