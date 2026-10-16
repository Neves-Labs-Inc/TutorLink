"""Add child_assigned_tutors: the Staff a Child may be booked with through the bot

Revision ID: 0045
Revises: 0044
Create Date: 2026-10-15 00:00:00.000000

A Child's Assigned Tutors (#242) are Tutors and Managers, keyed by user rather than by teaching
profile. A Child and a user are linked at most once. The link goes with the Child or the user
when either row is deleted; the creator is history only, so deleting them keeps the link and
clears the column.

The downgrade drops the table, and with it every assignment.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0045'
down_revision: str | None = '0044'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'child_assigned_tutors'
USER_INDEX = 'ix_child_assigned_tutors_user_id'


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column(
            'child_id', sa.UUID(), sa.ForeignKey('children.id', ondelete='CASCADE'), nullable=False
        ),
        sa.Column(
            'user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'created_by_user_id',
            sa.UUID(),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('child_id', 'user_id', name='uq_child_assigned_tutors_child_user'),
    )
    op.create_index(USER_INDEX, TABLE, ['user_id'])


def downgrade() -> None:
    op.drop_index(USER_INDEX, table_name=TABLE)
    op.drop_table(TABLE)
