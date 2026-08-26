"""default phone country code

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-25 00:00:00.000000

This migration creates and alters nothing: it inserts one `system_settings` row and its
downgrade deletes that row by key. There is no data backfill either, and there is nothing to
back-fill — 0006's docstring already records that nothing is deployed anywhere, and `guardians`
and `tutors` are empty, so no stored phone number predates the canonical form REQ-037
introduces.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0012'
down_revision: str | None = '0011'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The default region for parsing a bare national number like `555-123-4567` (#55, OQ-8). A row
# rather than a constant because the client's region is an operational fact, not a property of
# the code, and the standing preference is that tuning values an admin may need to change live
# in `system_settings`.
#
# Stored as the country *calling* code (`1` = NANP) rather than as a region string such as
# `'US'`, because `integer` is the only `value_type` `settings_service` can read
# (`settings_service.py:116`); a string-valued setting would be a new validator and a wider
# change than this row is worth. `phone_service` converts it back with
# `phonenumbers.region_code_for_country_code`.
#
# `is_developer_only` is FALSE: this is admin-tunable. The column default is TRUE so that a row
# inserted without thinking about it hides rather than leaks, which means this has to say FALSE
# out loud, exactly as 0011's rows do.
SEED_SETTINGS = (
    ('default_phone_country_code', '1', 'integer', False),
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
    # Deletes exactly this key, never the whole table: 0004's and 0011's rows live here too and
    # a blanket DELETE would take them with it.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )
