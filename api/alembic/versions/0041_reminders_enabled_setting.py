"""reminders enabled setting

Revision ID: 0041
Revises: 0039
Create Date: 2026-10-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0041'
# Chained on 0039 while 0040 is in flight; re-chained onto the head at merge.
down_revision: str | None = '0039'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The Admin's "Send Booking reminders" switch. On by default, so an install that already had
# its templates set keeps reminding. The test harness seeds the same row from here.
SEED_SETTINGS = (('reminders_enabled', 'true', 'boolean', False),)

system_settings = sa.table(
    'system_settings',
    sa.column('key', sa.String),
    sa.column('value', sa.Text),
    sa.column('value_type', sa.String),
    sa.column('is_developer_only', sa.Boolean),
)


def upgrade() -> None:
    op.bulk_insert(
        system_settings,
        [
            {'key': key, 'value': value, 'value_type': value_type, 'is_developer_only': developer_only}
            for key, value, value_type, developer_only in SEED_SETTINGS
        ],
    )


def downgrade() -> None:
    # Deletes exactly this key, never the whole table.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )
