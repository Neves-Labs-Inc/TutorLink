"""partial-day availability exceptions

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-16 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0007'
down_revision: str | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A DATE-only exception forces a mid-day dentist appointment to block the entire day.
    # The window columns are nullable and NULL means the whole day, which is exactly what
    # every existing row already means — so this is purely additive: no backfill, no
    # rewrite, and no row changes meaning when the columns appear.
    op.add_column(
        'tutor_availability_exceptions', sa.Column('start_time', sa.Time(), nullable=True)
    )
    op.add_column(
        'tutor_availability_exceptions', sa.Column('end_time', sa.Time(), nullable=True)
    )

    # NULL has to be unambiguous for "whole day" to be readable off the row, so a half-set
    # pair is rejected rather than guessed at. `=` between two IS NULL tests is never itself
    # NULL, so the constraint cannot pass by evaluating to unknown.
    op.create_check_constraint(
        'ck_tutor_availability_exceptions_time_pair',
        'tutor_availability_exceptions',
        '(start_time IS NULL) = (end_time IS NULL)',
    )
    op.create_check_constraint(
        'ck_tutor_availability_exceptions_time_order',
        'tutor_availability_exceptions',
        'start_time IS NULL OR end_time > start_time',
    )


def downgrade() -> None:
    # Dropping the columns takes the constraints with them, but they are named and dropped
    # explicitly so the reverse of the upgrade reads as its mirror.
    #
    # This direction loses data: a partial-day exception becomes a whole-day one, which
    # blocks more than the tutor asked for. Losing availability is the safe direction of
    # that error — it never books someone who said no.
    op.drop_constraint(
        'ck_tutor_availability_exceptions_time_order',
        'tutor_availability_exceptions',
        type_='check',
    )
    op.drop_constraint(
        'ck_tutor_availability_exceptions_time_pair',
        'tutor_availability_exceptions',
        type_='check',
    )
    op.drop_column('tutor_availability_exceptions', 'end_time')
    op.drop_column('tutor_availability_exceptions', 'start_time')
