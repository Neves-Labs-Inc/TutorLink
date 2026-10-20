"""drop bot_flow_state

Revision ID: 0054
Revises: 0053
Create Date: 2026-10-20 00:00:00.000000

The WhatsApp bot agent (docs/specs/whatsapp-bot-agent.md §8 "Removed code", "Migration") keeps
its runtime state on `conversations` and reads the rest from the chat's history, so the state
machine's per-number flow table goes. Pre-launch, it is dropped outright: a chat that was mid-flow
carries on with the agent from its history.

The downgrade recreates the table as 0018 made it, empty: the flows it held are not recoverable,
and an empty table is a fresh start for every number.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0054'
down_revision: str | None = '0053'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table('bot_flow_state')


def downgrade() -> None:
    op.create_table('bot_flow_state',
    sa.Column('phone_number', sa.String(length=32), nullable=False),
    sa.Column('step', sa.Text(), nullable=False),
    sa.Column('collected_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('misses', sa.Integer(), nullable=False),
    sa.Column('prompt', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('phone_number')
    )
