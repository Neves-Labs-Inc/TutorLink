"""postgres state tables

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-24 00:00:00.000000

Redis is retired (Phase 8R, brief of 2026-09-24). `login_attempts` replaces the
`ratelimit:login:*` sorted sets, and `bot_flow_state` replaces the `bot:flow:*` keys; each row
here is written and read the way its Redis key was, under an application-held lock rather than
an EXPIRE. Neither table is a system of record — a `login_attempts` row is charged against a
rate-limit window and a `bot_flow_state` row is reaped once its flow goes stale, and losing
either loses nothing a client would notice was ever recorded.

The seeded `retention_purge_hour_utc` row is the nightly reaper's schedule (REQ-085.3); the
reaper itself is a later task in this phase.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0018'
down_revision: str | None = '0017'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_SETTINGS = (
    ('retention_purge_hour_utc', '3', 'integer', False),
)

system_settings = sa.table(
    'system_settings',
    sa.column('key', sa.String),
    sa.column('value', sa.Text),
    sa.column('value_type', sa.String),
    sa.column('is_developer_only', sa.Boolean),
)


def upgrade() -> None:
    op.create_table('login_attempts',
    sa.Column('bucket_key', sa.Text(), nullable=False),
    sa.Column('attempt_id', sa.UUID(), nullable=False),
    sa.Column('attempted_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('bucket_key', 'attempt_id')
    )
    op.create_index('ix_login_attempts_bucket_key_attempted_at', 'login_attempts', ['bucket_key', 'attempted_at'], unique=False)

    op.create_table('bot_flow_state',
    sa.Column('phone_number', sa.String(length=32), nullable=False),
    sa.Column('step', sa.Text(), nullable=False),
    sa.Column('collected_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('misses', sa.Integer(), nullable=False),
    sa.Column('prompt', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('phone_number')
    )

    op.bulk_insert(
        system_settings,
        [
            {'key': key, 'value': value, 'value_type': value_type, 'is_developer_only': developer_only}
            for key, value, value_type, developer_only in SEED_SETTINGS
        ],
    )


def downgrade() -> None:
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )

    op.drop_table('bot_flow_state')

    op.drop_index('ix_login_attempts_bucket_key_attempted_at', table_name='login_attempts')
    op.drop_table('login_attempts')
