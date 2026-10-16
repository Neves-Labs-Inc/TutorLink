"""Default cancellation_cutoff_hours to 6

Revision ID: 0047
Revises: 0046
Create Date: 2026-10-16 00:00:00.000000

The client's rule (meeting of 2026-10-15): Guardians change or cancel through the bot until 6
hours before the session. 0004 seeded 24. The row is overwritten unconditionally, since there is
no real data yet for an Admin's edit to be lost.

The downgrade puts back 0004's 24.

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0047'
down_revision: str | None = '0046'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEY = 'cancellation_cutoff_hours'
NEW_VALUE = '6'
OLD_VALUE = '24'


def _set_value(value: str) -> None:
    op.execute(
        f"UPDATE system_settings SET value = '{value}' WHERE key = '{KEY}'"
    )


def upgrade() -> None:
    _set_value(NEW_VALUE)


def downgrade() -> None:
    _set_value(OLD_VALUE)
