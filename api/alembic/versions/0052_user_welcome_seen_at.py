"""users.welcome_seen_at: when a Staff member dismissed their welcome card

Revision ID: 0052
Revises: 0051
Create Date: 2026-10-16 00:00:00.000000

NULL means the card has not been dismissed. Set once, never reset.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0052'
down_revision: str | None = '0051'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('welcome_seen_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'welcome_seen_at')
