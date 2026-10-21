"""didnt_happen booking status and reply_window_closed flag reason

Revision ID: 0048
Revises: 0047
Create Date: 2026-10-16 00:00:00.000000

`didnt_happen` is a started Booking the office marks as not having taken place, told apart from
Cancelled. `reply_window_closed` flags a taken-over chat whose 24-hour WhatsApp window closed.

`ALTER TYPE ... ADD VALUE` runs in an autocommit block, as 0038 does: PostgreSQL refuses to use
a new enum value in the transaction that added it, and the run is one transaction.

The downgrade is lossy by design. PostgreSQL cannot drop an enum value, so each type is rebuilt
with its previous values. A Didn't happen Booking comes back Cancelled, the nearest status that
is also not live. A Reply window closed flag is cleared (both halves together), falling back to
`reactivation_request` when a request is pending, as 0020 does. The two indexes whose predicate
names `booking_status` values are dropped around the rebuild and recreated as they were.

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0048'
down_revision: str | None = '0047'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than read from the models: a migration records the schema at one point in
# history.
BOOKING_STATUS_VALUES_BEFORE = ('pending', 'confirmed', 'cancelled', 'completed')
FLAG_REASON_VALUES_BEFORE = (
    'stuck',
    'parse_error',
    'guardian_link_request',
    'reactivation_request',
    'booking_request',
    'question',
)
DIDNT_HAPPEN = 'didnt_happen'
REPLY_WINDOW_CLOSED = 'reply_window_closed'

LIVE_BOOKING_STATUS_PREDICATE = "status IN ('pending', 'confirmed')"
BOOKING_RANGE_EXPRESSION = "tsrange(scheduled_date + start_time, scheduled_date + end_time)"
OVERLAP_CONSTRAINT = 'excl_bookings_live_overlap'
ONE_LIVE_EVALUATION_INDEX = 'uq_bookings_one_live_evaluation_per_child'


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"ALTER TYPE booking_status ADD VALUE IF NOT EXISTS '{DIDNT_HAPPEN}'")
        op.execute(f"ALTER TYPE flag_reason ADD VALUE IF NOT EXISTS '{REPLY_WINDOW_CLOSED}'")


def downgrade() -> None:
    _downgrade_flag_reason()
    _downgrade_booking_status()


def _downgrade_flag_reason() -> None:
    # Compared as text: the value may have been added in this same transaction.
    op.execute(
        "UPDATE conversations SET"
        " flag_reason = CASE WHEN reactivation_child_id IS NULL THEN NULL"
        " ELSE 'reactivation_request'::flag_reason END,"
        " flagged_at = CASE WHEN reactivation_child_id IS NULL THEN NULL ELSE now() END"
        f" WHERE flag_reason::text = '{REPLY_WINDOW_CLOSED}'"
    )
    op.execute("ALTER TYPE flag_reason RENAME TO flag_reason_0048")
    values = ", ".join(f"'{value}'" for value in FLAG_REASON_VALUES_BEFORE)
    op.execute(f"CREATE TYPE flag_reason AS ENUM ({values})")
    op.execute(
        "ALTER TABLE conversations ALTER COLUMN flag_reason"
        " TYPE flag_reason USING flag_reason::text::flag_reason"
    )
    op.execute("DROP TYPE flag_reason_0048")


def _downgrade_booking_status() -> None:
    op.execute(f"UPDATE bookings SET status = 'cancelled' WHERE status::text = '{DIDNT_HAPPEN}'")
    # Their predicates compare against the old type, which the column change cannot rebuild.
    op.execute(f'ALTER TABLE bookings DROP CONSTRAINT {OVERLAP_CONSTRAINT}')
    op.drop_index(ONE_LIVE_EVALUATION_INDEX, table_name='bookings')
    op.execute("ALTER TYPE booking_status RENAME TO booking_status_0048")
    values = ", ".join(f"'{value}'" for value in BOOKING_STATUS_VALUES_BEFORE)
    op.execute(f"CREATE TYPE booking_status AS ENUM ({values})")
    op.execute(
        "ALTER TABLE bookings ALTER COLUMN status"
        " TYPE booking_status USING status::text::booking_status"
    )
    op.execute("DROP TYPE booking_status_0048")
    op.execute(
        f'ALTER TABLE bookings ADD CONSTRAINT {OVERLAP_CONSTRAINT} '
        f'EXCLUDE USING gist (user_id WITH =, {BOOKING_RANGE_EXPRESSION} WITH &&) '
        f'WHERE ({LIVE_BOOKING_STATUS_PREDICATE})'
    )
    op.execute(
        f'CREATE UNIQUE INDEX {ONE_LIVE_EVALUATION_INDEX} ON bookings (child_id)'
        f" WHERE kind = 'evaluation' AND {LIVE_BOOKING_STATUS_PREDICATE}"
    )
