"""child is_active

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-23 00:00:00.000000

`docs/api-design.md:71` says children carry no `is_active` flag; the user's decision (P7C
amendment P7C-1) reverses that: a child can now be deactivated without being deleted, the same
soft-delete shape `guardians` and `homes` already have. Deactivation is not deletion — a
deactivated child's history, links and notes all stay.

Every existing row becomes active: `server_default=sa.text('true')` backfills the column for
free, and there is no row for which "active" is the wrong guess.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0016'
down_revision: str | None = '0015'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'children',
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    )


def downgrade() -> None:
    op.drop_column('children', 'is_active')
