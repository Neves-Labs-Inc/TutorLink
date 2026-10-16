"""one brand colour per email

Revision ID: 0051
Revises: 0050
Create Date: 2026-10-16 00:00:00.000000

The invite and the reset email each get their own button colour, replacing the one colour 0035
seeded for both. Each new row starts as a copy of the shared row, value and flags, so neither
email changes on the day this ships. The test harness seeds the new keys from here.

The downgrade brings the shared row back from the invite colour and drops both new rows.

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0051'
down_revision: str | None = '0050'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SHARED_COLOR_KEY = 'email_brand_color'
INVITE_COLOR_KEY = 'email_invite_brand_color'
RESET_COLOR_KEY = 'email_reset_brand_color'
PER_EMAIL_COLOR_KEYS = (INVITE_COLOR_KEY, RESET_COLOR_KEY)


def upgrade() -> None:
    for key in PER_EMAIL_COLOR_KEYS:
        _copy_row(source=SHARED_COLOR_KEY, target=key)
    op.execute(f"DELETE FROM system_settings WHERE key = '{SHARED_COLOR_KEY}'")


def downgrade() -> None:
    _copy_row(source=INVITE_COLOR_KEY, target=SHARED_COLOR_KEY)
    keys = ", ".join(f"'{key}'" for key in PER_EMAIL_COLOR_KEYS)
    op.execute(f"DELETE FROM system_settings WHERE key IN ({keys})")


def _copy_row(*, source: str, target: str) -> None:
    op.execute(
        "INSERT INTO system_settings (key, value, value_type, is_developer_only)"
        f" SELECT '{target}', value, value_type, is_developer_only FROM system_settings"
        f" WHERE key = '{source}'"
    )
