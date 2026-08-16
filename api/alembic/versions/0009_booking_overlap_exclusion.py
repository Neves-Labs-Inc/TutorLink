"""bookings exclude overlapping live slots

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-16 00:00:00.000000

BEFORE DEPLOYING: this upgrade validates every existing row and will abort if any row
violates either new constraint. That is intentional — which of two real bookings should be
cancelled, or what a zero-length booking was meant to say, is a policy decision this file has
no business making. Alembic's transactional DDL rolls the whole revision back on failure, so a
failed run leaves the schema at 0008 with nothing half-applied, but PostgreSQL reports only
the first offending row. Run both queries below first and resolve what they return.

Overlapping live bookings (`excl_bookings_live_overlap`) — each conflicting pair once:

    SELECT a.tutor_id,
           a.scheduled_date,
           a.id AS booking_a, a.start_time AS a_start, a.end_time AS a_end, a.status AS a_status,
           b.id AS booking_b, b.start_time AS b_start, b.end_time AS b_end, b.status AS b_status
    FROM bookings a
    JOIN bookings b
      ON b.tutor_id = a.tutor_id
     AND b.id > a.id
     AND tsrange(a.scheduled_date + a.start_time, a.scheduled_date + a.end_time)
      && tsrange(b.scheduled_date + b.start_time, b.scheduled_date + b.end_time)
    WHERE a.status IN ('pending', 'confirmed')
      AND b.status IN ('pending', 'confirmed')
    ORDER BY a.tutor_id, a.scheduled_date, a.start_time;

Bookings that do not span time (`ck_bookings_time_order`) — note this one is not scoped to
live rows, so a cancelled or completed row with a bad window blocks the upgrade too:

    SELECT id, tutor_id, scheduled_date, start_time, end_time, status
    FROM bookings
    WHERE end_time <= start_time
    ORDER BY scheduled_date, start_time;

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0009'
down_revision: str | None = '0008'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than imported from app.models.booking. A migration is a record of the
# schema at one point in history; reading the constant the model happens to hold today would
# make this file's meaning change under it the next time the live statuses do.
LIVE_BOOKING_STATUS_PREDICATE = "status IN ('pending', 'confirmed')"
BOOKING_RANGE_EXPRESSION = "tsrange(scheduled_date + start_time, scheduled_date + end_time)"
BOOKING_TIME_ORDER_PREDICATE = "end_time > start_time"


def upgrade() -> None:
    # `uq_booking_live_slot` compared start times for equality, so it caught a second 10:00
    # booking and missed a 10:30 one landing inside the same 10:00-11:00 hour. Session length
    # is runtime-editable, so a 45-minute grid puts overlapping starts on the table for real.
    #
    # `btree_gist` is what lets a plain UUID take part in a GiST index with `=`; without it
    # the constraint cannot name `tutor_id` and would have to exclude across all tutors.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # First, because it is what makes the exclusion constraint below sound rather than a
    # separate nicety. `end_time == start_time` builds an empty `tsrange`, which overlaps
    # nothing and is therefore invisible to an EXCLUDE — two identical zero-length bookings
    # would both land, which is weaker than the index being dropped. `end_time < start_time`
    # makes the range constructor itself raise SQLSTATE 22000, a `DataError` rather than the
    # `IntegrityError` a caller translating conflicts into a 409 is watching for.
    #
    # This makes a session ending at midnight (23:00-00:00) unrepresentable, and that is the
    # trade being taken: the range expression already produces garbage for a wrap-around, so
    # refusing it beats storing a booking no constraint can see. Formulated to match
    # `ck_tutor_availability_exceptions_time_order` from 0007, minus its NULL escape — both
    # columns here are NOT NULL.
    op.create_check_constraint(
        'ck_bookings_time_order',
        'bookings',
        BOOKING_TIME_ORDER_PREDICATE,
    )

    # Replaced, not kept alongside: equal start times overlap, so the exclusion constraint
    # strictly subsumes the old index.
    op.drop_index(
        'uq_booking_live_slot',
        table_name='bookings',
        postgresql_where=sa.text(LIVE_BOOKING_STATUS_PREDICATE),
    )
    # `tsrange` is half-open `[)`, so a 10:00-11:00 and an 11:00-12:00 booking are adjacent
    # rather than conflicting.
    op.execute(
        f"ALTER TABLE bookings ADD CONSTRAINT excl_bookings_live_overlap "
        f"EXCLUDE USING gist (tutor_id WITH =, {BOOKING_RANGE_EXPRESSION} WITH &&) "
        f"WHERE ({LIVE_BOOKING_STATUS_PREDICATE})"
    )


def downgrade() -> None:
    # This direction loses the overlap guarantee and keeps only equal-start-time uniqueness,
    # which is what 0001 created and what every revision below this one assumes.
    #
    # `btree_gist` is deliberately left installed. It is a shared, schema-wide object: another
    # constraint or a hand-written index may already depend on it, and DROP EXTENSION would
    # take those down with it. Leaving it costs nothing and makes a re-upgrade a no-op.
    # `op.drop_constraint` rejects an EXCLUDE constraint: its `type_` accepts only check,
    # foreignkey, primary and unique.
    op.execute("ALTER TABLE bookings DROP CONSTRAINT excl_bookings_live_overlap")
    op.create_index(
        'uq_booking_live_slot',
        'bookings',
        ['tutor_id', 'scheduled_date', 'start_time'],
        unique=True,
        postgresql_where=sa.text(LIVE_BOOKING_STATUS_PREDICATE),
    )
    op.drop_constraint('ck_bookings_time_order', 'bookings', type_='check')
