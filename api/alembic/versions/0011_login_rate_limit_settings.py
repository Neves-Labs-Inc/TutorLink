"""login rate limit settings

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-23 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0011'
down_revision: str | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Thresholds for the brute-force limiter on `POST /auth/token` (#3, OQ-7). Rows rather than
# constants because the right numbers depend on how the client's staff actually log in — a
# shared office address behind one NAT looks like an attacker to a limit tuned for a home
# connection — and discovering that during an incident must not require a deploy.
#
# Two buckets, each with its own pair: per-IP is the wide net and per-email is the tight one,
# so a per-IP limit generous enough not to lock out an office still leaves five guesses per
# account. Both windows are 15 minutes.
#
# **A `max_attempts` of 0 disables that bucket.** That is the kill switch, and it is an integer
# rather than a boolean because `integer` is the only `value_type` that exists; adding one to
# express "off" would be a schema change to say what 0 already says. Setting both to 0 turns
# the limiter off entirely without a deploy, which is the escape hatch an admin needs if the
# limit ever locks out the people it is protecting.
#
# `is_developer_only` is FALSE on every row: these are admin-tunable. The column default is
# TRUE so that a row inserted without thinking about it hides rather than leaks, which means
# each of these has to say FALSE out loud.
SEED_SETTINGS = (
    ('login_rate_limit_ip_max_attempts', '20', 'integer', False),
    ('login_rate_limit_ip_window_seconds', '900', 'integer', False),
    ('login_rate_limit_email_max_attempts', '5', 'integer', False),
    ('login_rate_limit_email_window_seconds', '900', 'integer', False),
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
    # Deletes exactly these four keys, never the whole table: 0004's rows live here too and a
    # blanket DELETE would take the slot-grid settings with them.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )
