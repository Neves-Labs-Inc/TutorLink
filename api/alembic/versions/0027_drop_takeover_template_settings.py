"""drop takeover template settings

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-07 00:00:00.000000

Takeover and Transfer are only allowed inside the Guardian's 24-hour window, so their notice is
always free-form and the takeover templates are never sent. Meta approved them as Marketing,
not Utility, so every send failed anyway. The downgrade restores the rows blank: the old
template ids are not worth bringing back.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0027'
down_revision: str | None = '0026'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Developer-only and blank, as 0021 and 0025 first seeded them.
SEED_SETTINGS = (
    ('takeover_template_sid_en', '', 'string', True),
    ('takeover_template_sid_es', '', 'string', True),
    ('takeover_generic_template_sid_en', '', 'string', True),
    ('takeover_generic_template_sid_es', '', 'string', True),
)

system_settings = sa.table(
    'system_settings',
    sa.column('key', sa.String),
    sa.column('value', sa.Text),
    sa.column('value_type', sa.String),
    sa.column('is_developer_only', sa.Boolean),
)


def upgrade() -> None:
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )


def downgrade() -> None:
    op.bulk_insert(
        system_settings,
        [
            {
                'key': key,
                'value': value,
                'value_type': value_type,
                'is_developer_only': developer_only,
            }
            for key, value, value_type, developer_only in SEED_SETTINGS
        ],
    )
