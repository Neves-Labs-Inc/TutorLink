"""forgot-password rate limit settings

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-09 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0033'
down_revision: str | None = '0032'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Thresholds for `POST /auth/password/forgot` (spec 04), the second unauthenticated write
# surface after `POST /auth/token`. Its own four rows rather than 0011's: a forgot request
# costs an email, not a bcrypt round, so the numbers that fit it are different — ten per
# address per 15 minutes, three per account per hour — and one surface's limit must never be
# tunable by accident through the other's.
#
# As for 0011: `max_attempts` of 0 disables that bucket, and `is_developer_only` is FALSE out
# loud because the column default hides a row.
SEED_SETTINGS = (
    ('forgot_password_rate_limit_ip_max_attempts', '10', 'integer', False),
    ('forgot_password_rate_limit_ip_window_seconds', '900', 'integer', False),
    ('forgot_password_rate_limit_email_max_attempts', '3', 'integer', False),
    ('forgot_password_rate_limit_email_window_seconds', '3600', 'integer', False),
)

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
    # Deletes exactly these four keys, never the whole table.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )
