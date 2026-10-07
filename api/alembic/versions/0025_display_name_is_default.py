"""display name is default, nameless takeover template settings

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-06 00:00:00.000000

No email-derived name may reach a Guardian (#109). `users.display_name_is_default` marks a
Display name that was never chosen: 0021 backfilled every non-tutor from its email's local part,
so exactly those rows are flagged. A takeover by a flagged holder sends the nameless notice, and
outside the 24-hour window that needs its own Utility template, hence the two settings.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0025'
down_revision: str | None = '0024'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Developer-only, blank until the template is approved in the Twilio console; blank means a
# nameless takeover outside the window is recorded as not sent.
SEED_SETTINGS = (
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
    op.add_column(
        'users',
        sa.Column(
            'display_name_is_default',
            sa.Boolean(),
            server_default=sa.text('false'),
            nullable=False,
        ),
    )
    op.execute(
        'UPDATE users SET display_name_is_default = true'
        " WHERE role <> 'tutor' AND display_name = split_part(email, '@', 1)"
    )
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


def downgrade() -> None:
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )
    op.drop_column('users', 'display_name_is_default')
