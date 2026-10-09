"""email brand color setting

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-09 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0035'
down_revision: str | None = '0034'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The one colour every email's wordmark, button and links use. The default is the turquoise
# from the TutorLink brand palette, frozen here rather than imported: a migration must keep
# seeding what it seeded on the day it shipped. The test harness seeds the same row from here.
BRAND_COLOR = '#74C8C9'

SEED_SETTINGS = (('email_brand_color', BRAND_COLOR, 'string', False),)

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
