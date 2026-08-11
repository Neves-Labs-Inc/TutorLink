"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-08-10 16:22:08.344547

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USER_ROLE_VALUES = ("admin", "tutor")
BOOKING_STATUS_VALUES = ("pending", "confirmed", "cancelled", "completed")

# The enum types are created and dropped by hand. A native PostgreSQL enum outlives
# DROP TABLE, so letting SQLAlchemy manage them implicitly would leave `user_role` and
# `booking_status` behind after `downgrade base` and break the next upgrade.
user_role = postgresql.ENUM(*USER_ROLE_VALUES, name="user_role", create_type=False)
booking_status = postgresql.ENUM(*BOOKING_STATUS_VALUES, name="booking_status", create_type=False)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'tutor')")
    op.execute(
        "CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed')"
    )

    op.create_table('parents',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('phone_number', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('address', sa.Text(), nullable=False),
    sa.Column('access_code', sa.String(length=64), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('phone_number')
    )
    op.create_index('ix_parents_phone_number', 'parents', ['phone_number'], unique=False)
    op.create_table('subjects',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('tutors',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('phone_number', sa.String(length=32), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('bio', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    sa.UniqueConstraint('phone_number')
    )
    op.create_table('children',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('age', sa.Integer(), nullable=False),
    sa.Column('grade_level', sa.String(length=64), nullable=False),
    sa.Column('school_name', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['parents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_children_parent_id', 'children', ['parent_id'], unique=False)
    op.create_table('tutor_availability',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('tutor_id', sa.UUID(), nullable=False),
    sa.Column('day_of_week', sa.SmallInteger(), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=False),
    sa.Column('end_time', sa.Time(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('day_of_week BETWEEN 0 AND 6', name='ck_tutor_availability_day_of_week'),
    sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tutor_id', 'day_of_week', 'start_time', name='uq_tutor_availability_slot')
    )
    op.create_index('ix_tutor_availability_tutor_id_day_of_week', 'tutor_availability', ['tutor_id', 'day_of_week'], unique=False)
    op.create_table('tutor_availability_exceptions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('tutor_id', sa.UUID(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('reason', sa.String(length=32), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_tutor_availability_exceptions_tutor_id_dates', 'tutor_availability_exceptions', ['tutor_id', 'start_date', 'end_date'], unique=False)
    op.create_table('tutor_subjects',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('tutor_id', sa.UUID(), nullable=False),
    sa.Column('subject_id', sa.UUID(), nullable=False),
    sa.Column('grade_levels', postgresql.ARRAY(sa.String()), nullable=False),
    sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ),
    sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tutor_id', 'subject_id', name='uq_tutor_subjects_tutor_subject')
    )
    op.create_index('ix_tutor_subjects_tutor_id_subject_id', 'tutor_subjects', ['tutor_id', 'subject_id'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('hashed_password', sa.String(length=255), nullable=False),
    sa.Column('role', user_role, nullable=False),
    sa.Column('tutor_id', sa.UUID(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_index('ix_users_email_role', 'users', ['email', 'role'], unique=False)
    op.create_table('bookings',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('child_id', sa.UUID(), nullable=False),
    sa.Column('tutor_id', sa.UUID(), nullable=False),
    sa.Column('subject_id', sa.UUID(), nullable=False),
    sa.Column('availability_id', sa.UUID(), nullable=False),
    sa.Column('scheduled_date', sa.Date(), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=False),
    sa.Column('end_time', sa.Time(), nullable=False),
    sa.Column('status', booking_status, nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['availability_id'], ['tutor_availability.id'], ),
    sa.ForeignKeyConstraint(['child_id'], ['children.id'], ),
    sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ),
    sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_bookings_child_date', 'bookings', ['child_id', 'scheduled_date'], unique=False)
    op.create_index('ix_bookings_date_status', 'bookings', ['scheduled_date', 'status'], unique=False)
    op.create_index('ix_bookings_tutor_date_status', 'bookings', ['tutor_id', 'scheduled_date', 'status'], unique=False)
    op.create_index('uq_booking_live_slot', 'bookings', ['tutor_id', 'scheduled_date', 'start_time'], unique=True, postgresql_where=sa.text("status IN ('pending', 'confirmed')"))


def downgrade() -> None:
    op.drop_index('uq_booking_live_slot', table_name='bookings', postgresql_where=sa.text("status IN ('pending', 'confirmed')"))
    op.drop_index('ix_bookings_tutor_date_status', table_name='bookings')
    op.drop_index('ix_bookings_date_status', table_name='bookings')
    op.drop_index('ix_bookings_child_date', table_name='bookings')
    op.drop_table('bookings')
    op.drop_index('ix_users_email_role', table_name='users')
    op.drop_table('users')
    op.drop_index('ix_tutor_subjects_tutor_id_subject_id', table_name='tutor_subjects')
    op.drop_table('tutor_subjects')
    op.drop_index('ix_tutor_availability_exceptions_tutor_id_dates', table_name='tutor_availability_exceptions')
    op.drop_table('tutor_availability_exceptions')
    op.drop_index('ix_tutor_availability_tutor_id_day_of_week', table_name='tutor_availability')
    op.drop_table('tutor_availability')
    op.drop_index('ix_children_parent_id', table_name='children')
    op.drop_table('children')
    op.drop_table('tutors')
    op.drop_table('subjects')
    op.drop_index('ix_parents_phone_number', table_name='parents')
    op.drop_table('parents')

    op.execute("DROP TYPE booking_status")
    op.execute("DROP TYPE user_role")
