"""system settings

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Seeded here rather than on startup, matching the project's rule that migrations are the only
# thing that writes schema-shaped state. Phase 4 cannot compute a slot grid without these, so
# they are not optional configuration — a database without them is not a working database.
#
# `is_developer_only` is FALSE on every row: all five are admin-editable. The column default is
# TRUE so that a row inserted without thinking about it hides rather than leaks, which means
# each of these has to say FALSE out loud.
SEED_SETTINGS = (
    ('session_length_minutes', '60', 'integer', False),
    ('session_gap_minutes', '30', 'integer', False),
    ('booking_lookahead_days', '90', 'integer', False),
    ('min_booking_lead_hours', '0', 'integer', False),
    ('cancellation_cutoff_hours', '24', 'integer', False),
)


def upgrade() -> None:
    system_settings = op.create_table('system_settings',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', sa.Text(), nullable=False),
    sa.Column('value_type', sa.String(length=16), nullable=False),
    sa.Column('is_developer_only', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key', name='uq_system_settings_key')
    )

    op.bulk_insert(
        system_settings,
        [
            {'key': key, 'value': value, 'value_type': value_type, 'is_developer_only': developer_only}
            for key, value, value_type, developer_only in SEED_SETTINGS
        ],
    )


def downgrade() -> None:
    op.drop_table('system_settings')
