"""max slots offered

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-26 00:00:00.000000

This migration creates and alters nothing: it inserts one `system_settings` row and its
downgrade deletes that row by key. Phase 4 needs no structural change — `0009` already provides
`excl_bookings_live_overlap` and `0010` already provides `end_date >= start_date`.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0013'
down_revision: str | None = '0012'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# How many slots `GET /api/slots/available` offers at most (OQ-2). A row rather than a constant
# because the cap exists to keep a WhatsApp reply short — an operational judgement the client
# will want to retune without a deploy — and the standing preference is that a tuning value an
# admin may need to change lives in `system_settings`. `slot_service` reads it at request time
# through `get_int_setting`; `total` still counts the uncapped result.
#
# `is_developer_only` is FALSE: this is admin-tunable. The column default is TRUE so that a row
# inserted without thinking about it hides rather than leaks, which means this has to say FALSE
# out loud, exactly as 0011's and 0012's rows do.
SEED_SETTINGS = (
    ('max_slots_offered', '5', 'integer', False),
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
    # Deletes exactly this key, never the whole table: 0004's, 0011's and 0012's rows live here
    # too and a blanket DELETE would take them with it.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )
