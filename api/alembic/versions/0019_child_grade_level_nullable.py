"""child grade_level nullable

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-01 00:00:00.000000

A child can now exist with no grade: the WhatsApp bot stops asking for it, and an admin sets it
by hand after the child's first session. Every existing row keeps the grade it has.

The downgrade **refuses** while any child has a NULL grade rather than backfilling one. There
is no grade that is right to invent for a child nobody has graded, and a guessed grade would
silently change which tutors that child can be booked with (rule 5's ceiling). Set those
grades by hand, then downgrade.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0019'
down_revision: str | None = '0018'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column('children', 'grade_level', existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    ungraded = op.get_bind().execute(
        sa.text('SELECT count(*) FROM children WHERE grade_level IS NULL')
    ).scalar_one()
    if ungraded:
        raise RuntimeError(
            f'Cannot downgrade 0019: {ungraded} children have no grade_level. '
            'Set their grades by hand, then downgrade.'
        )

    op.alter_column('children', 'grade_level', existing_type=sa.Integer(), nullable=False)
