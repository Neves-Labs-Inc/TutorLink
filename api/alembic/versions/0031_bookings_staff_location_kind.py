"""bookings: Staff as a user, Location, kind; availability mode

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-08 00:00:00.000000

A Booking names its Staff member as a person (`user_id`, #130) rather than as a teaching
profile, so an Admin can hold one; it has a `kind` (`regular | evaluation`) and a `location`
(`home | in_office`), and the three shape CHECKs tie Subject, slot and home to them. The
overlap EXCLUDE is rebuilt on `user_id` under its old name, so it now covers Evaluations and
Regular sessions of one person alike. A partial unique index keeps one live Evaluation per
Child (#133). Every existing Booking becomes a Regular one at a home with its Staff member
set from its old Tutor.

`tutor_availability.mode` (#132) says where a range's sessions may happen; `traveler` is what
every existing range meant.

The downgrade is best-effort and lossy by decision: Evaluation and In office bookings cannot
exist in the old schema and are deleted, as is any booking whose Staff member has no profile
to restore `tutor_id` from.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0031'
down_revision: str | None = '0030'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than imported from the models, as 0009 does: a migration is a record of
# the schema at one point in history.
LIVE_BOOKING_STATUS_PREDICATE = "status IN ('pending', 'confirmed')"
BOOKING_RANGE_EXPRESSION = "tsrange(scheduled_date + start_time, scheduled_date + end_time)"
OVERLAP_CONSTRAINT = 'excl_bookings_live_overlap'
USER_FK = 'fk_bookings_user_id_users'
# The name 0001 left to PostgreSQL's default, restored under the same default.
TUTOR_FK_BEFORE = 'bookings_tutor_id_fkey'
ONE_LIVE_EVALUATION_INDEX = 'uq_bookings_one_live_evaluation_per_child'
SHAPE_CHECKS = (
    ('ck_bookings_kind', "kind IN ('regular', 'evaluation')"),
    ('ck_bookings_location', "location IN ('home', 'in_office')"),
    ('ck_bookings_home_matches_location', "(location = 'home') = (home_id IS NOT NULL)"),
    ('ck_bookings_subject_matches_kind', "(kind = 'regular') = (subject_id IS NOT NULL)"),
    ('ck_bookings_evaluation_has_no_slot', "kind <> 'evaluation' OR availability_id IS NULL"),
)


def upgrade() -> None:
    op.add_column('bookings', sa.Column('user_id', sa.UUID(), nullable=True))
    op.add_column('bookings', sa.Column('kind', sa.String(length=16), nullable=True))
    op.add_column('bookings', sa.Column('location', sa.String(length=16), nullable=True))
    op.execute(
        'UPDATE bookings SET user_id = tutors.user_id FROM tutors'
        ' WHERE tutors.id = bookings.tutor_id'
    )
    op.execute("UPDATE bookings SET kind = 'regular', location = 'home'")
    op.alter_column('bookings', 'user_id', existing_type=sa.UUID(), nullable=False)
    op.alter_column('bookings', 'kind', existing_type=sa.String(16), nullable=False)
    op.alter_column('bookings', 'location', existing_type=sa.String(16), nullable=False)
    op.create_foreign_key(USER_FK, 'bookings', 'users', ['user_id'], ['id'])

    op.alter_column('bookings', 'home_id', existing_type=sa.UUID(), nullable=True)
    op.alter_column('bookings', 'subject_id', existing_type=sa.UUID(), nullable=True)
    op.alter_column('bookings', 'availability_id', existing_type=sa.UUID(), nullable=True)
    for name, predicate in SHAPE_CHECKS:
        op.create_check_constraint(name, 'bookings', predicate)

    # Same name, same range expression and live predicate as 0009; only the key changes.
    # `op.drop_constraint` rejects an EXCLUDE constraint (its `type_` has no such value).
    op.execute(f'ALTER TABLE bookings DROP CONSTRAINT {OVERLAP_CONSTRAINT}')
    op.execute(
        f'ALTER TABLE bookings ADD CONSTRAINT {OVERLAP_CONSTRAINT} '
        f'EXCLUDE USING gist (user_id WITH =, {BOOKING_RANGE_EXPRESSION} WITH &&) '
        f'WHERE ({LIVE_BOOKING_STATUS_PREDICATE})'
    )
    op.drop_index('ix_bookings_tutor_date_status', table_name='bookings')
    op.create_index(
        'ix_bookings_user_date_status', 'bookings', ['user_id', 'scheduled_date', 'status']
    )
    op.create_index(
        ONE_LIVE_EVALUATION_INDEX,
        'bookings',
        ['child_id'],
        unique=True,
        postgresql_where=sa.text(f"kind = 'evaluation' AND {LIVE_BOOKING_STATUS_PREDICATE}"),
    )
    # Dropping the column drops `bookings_tutor_id_fkey` with it.
    op.drop_column('bookings', 'tutor_id')

    op.add_column(
        'tutor_availability',
        sa.Column('mode', sa.String(length=16), nullable=False, server_default='traveler'),
    )
    op.create_check_constraint(
        'ck_tutor_availability_mode',
        'tutor_availability',
        "mode IN ('traveler', 'anywhere', 'only_office')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_tutor_availability_mode', 'tutor_availability', type_='check')
    op.drop_column('tutor_availability', 'mode')

    # What the old schema cannot hold: an Evaluation, an office session, and a session whose
    # Staff member has no teaching profile to name.
    op.execute("DELETE FROM bookings WHERE kind = 'evaluation' OR location = 'in_office'")
    op.execute(
        'DELETE FROM bookings WHERE NOT EXISTS'
        ' (SELECT 1 FROM tutors WHERE tutors.user_id = bookings.user_id)'
    )
    op.add_column('bookings', sa.Column('tutor_id', sa.UUID(), nullable=True))
    op.execute(
        'UPDATE bookings SET tutor_id = tutors.id FROM tutors'
        ' WHERE tutors.user_id = bookings.user_id'
    )
    op.alter_column('bookings', 'tutor_id', existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(TUTOR_FK_BEFORE, 'bookings', 'tutors', ['tutor_id'], ['id'])

    op.drop_index(ONE_LIVE_EVALUATION_INDEX, table_name='bookings')
    op.drop_index('ix_bookings_user_date_status', table_name='bookings')
    op.create_index(
        'ix_bookings_tutor_date_status', 'bookings', ['tutor_id', 'scheduled_date', 'status']
    )
    op.execute(f'ALTER TABLE bookings DROP CONSTRAINT {OVERLAP_CONSTRAINT}')
    op.execute(
        f'ALTER TABLE bookings ADD CONSTRAINT {OVERLAP_CONSTRAINT} '
        f'EXCLUDE USING gist (tutor_id WITH =, {BOOKING_RANGE_EXPRESSION} WITH &&) '
        f'WHERE ({LIVE_BOOKING_STATUS_PREDICATE})'
    )

    for name, _predicate in SHAPE_CHECKS:
        op.drop_constraint(name, 'bookings', type_='check')
    op.alter_column('bookings', 'availability_id', existing_type=sa.UUID(), nullable=False)
    op.alter_column('bookings', 'subject_id', existing_type=sa.UUID(), nullable=False)
    op.alter_column('bookings', 'home_id', existing_type=sa.UUID(), nullable=False)

    op.drop_constraint(USER_FK, 'bookings', type_='foreignkey')
    op.drop_column('bookings', 'location')
    op.drop_column('bookings', 'kind')
    op.drop_column('bookings', 'user_id')
