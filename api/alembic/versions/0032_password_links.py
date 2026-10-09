"""password links: invite and reset tokens

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-09 00:00:00.000000

A row per link emailed to a user, for an Invite (`purpose = 'invite'`, spec 04) or a password
reset (`'reset'`). As `refresh_tokens`, only the SHA-256 of the token is stored; the plaintext
exists in the email alone. A link is live while `used_at` and `revoked_at` are NULL and
`expires_at` is ahead; `email` records the address it went to, so a later address change can
be told apart from the one the link was sent to.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0032'
down_revision: str | None = '0031'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than imported from the models: a migration is a record of the schema at
# one point in history.
PURPOSE_VALUES = ('invite', 'reset')
PURPOSE_CONSTRAINT = 'ck_password_links_purpose'
USER_PURPOSE_INDEX = 'ix_password_links_user_id_purpose'


def _in(column: str, values: Sequence[str]) -> str:
    listed = ', '.join(f"'{value}'" for value in values)

    return f'{column} IN ({listed})'


def upgrade() -> None:
    op.create_table(
        'password_links',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('purpose', sa.String(length=16), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash', name='uq_password_links_token_hash'),
        sa.CheckConstraint(_in('purpose', PURPOSE_VALUES), name=PURPOSE_CONSTRAINT),
    )
    op.create_index(USER_PURPOSE_INDEX, 'password_links', ['user_id', 'purpose'])


def downgrade() -> None:
    op.drop_index(USER_PURPOSE_INDEX, table_name='password_links')
    op.drop_table('password_links')
