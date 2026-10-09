"""email template settings

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-09 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0034'
down_revision: str | None = '0033'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The Invite and Password reset emails, as admin-editable subject and plain-text body rows.
# The copy is frozen here rather than imported from app code: a migration must keep seeding
# what it seeded on the day it shipped. The expiry wording matches `INVITE_TTL` (7 days) and
# `RESET_TTL` (48 hours) and is part of the editable body. The test harness seeds the same rows
# from these constants, since `create_all` reproduces no migration data.
INVITE_SUBJECT = '{actor_name} invited you to TutorLink'
INVITE_BODY = (
    'Hi {name},\n'
    '\n'
    '{actor_name} has added you to TutorLink. To get started, choose your password using the'
    ' link below:\n'
    '\n'
    '{link}\n'
    '\n'
    'This link works once and expires in 7 days. If it expires, ask {actor_name} to send you a'
    ' new invite.\n'
    '\n'
    'See you soon,\n'
    'The TutorLink team'
)
RESET_SUBJECT = 'Reset your TutorLink password'
RESET_BODY = (
    'Hi {name},\n'
    '\n'
    'We received a request to reset your TutorLink password. Choose a new one using the link'
    ' below:\n'
    '\n'
    '{link}\n'
    '\n'
    "This link works once and expires in 48 hours. If you didn't ask for this, you can safely"
    " ignore this email and your password won't change.\n"
    '\n'
    'The TutorLink team'
)

SEED_SETTINGS = (
    ('email_invite_subject', INVITE_SUBJECT, 'string', False),
    ('email_invite_body', INVITE_BODY, 'string', False),
    ('email_reset_subject', RESET_SUBJECT, 'string', False),
    ('email_reset_body', RESET_BODY, 'string', False),
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
