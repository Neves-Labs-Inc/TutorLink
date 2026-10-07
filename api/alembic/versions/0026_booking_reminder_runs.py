"""booking reminder runs

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-06 00:00:00.000000

A marker per week whose reminder run finished, so the Staff Reminders page can tell "ran and
reminded nobody" from "never ran" (the process was down on run day). `booking_reminders` rows
cannot: a run with nobody due writes none.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0026'
down_revision: str | None = '0025'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'booking_reminder_runs',
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column(
            'ran_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('week_start'),
    )


def downgrade() -> None:
    op.drop_table('booking_reminder_runs')
