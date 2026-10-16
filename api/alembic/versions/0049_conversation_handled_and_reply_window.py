"""conversations: the last Mark done, for Undo, and the reply window already flagged

Revision ID: 0049
Revises: 0048
Create Date: 2026-10-16 00:00:00.000000

`handled_flag_reason`, `handled_flagged_at` and `handled_at` record the flag the last Mark done
cleared and when, so Undo can put it back. `reply_window_flagged_for` is the
`last_client_message_at` whose closed window was already flagged `reply_window_closed`, so the
same window is flagged once. All NULL until the code that writes them ships.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0049'
down_revision: str | None = '0048'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'conversations'
TIMESTAMP_COLUMNS = ('handled_flagged_at', 'handled_at', 'reply_window_flagged_for')

# The type exists already (0014); this column only uses it.
flag_reason = postgresql.ENUM(name='flag_reason', create_type=False)


def upgrade() -> None:
    op.add_column(TABLE, sa.Column('handled_flag_reason', flag_reason, nullable=True))
    for column in TIMESTAMP_COLUMNS:
        op.add_column(TABLE, sa.Column(column, sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for column in reversed(TIMESTAMP_COLUMNS):
        op.drop_column(TABLE, column)
    op.drop_column(TABLE, 'handled_flag_reason')
