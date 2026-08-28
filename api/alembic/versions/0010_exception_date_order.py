"""tutor availability exceptions require end_date >= start_date

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-20 00:00:00.000000

BEFORE DEPLOYING: this upgrade validates every existing row and will abort if any row has
`end_date < start_date`. Such a row matches no date in the `start_date <= requested_date <=
end_date` comparison a consumer uses to subtract exceptions from availability, so it silently
blocks nothing while looking like an approved time-off request — the tutor stays bookable.
Alembic's transactional DDL rolls the whole revision back on failure, so a failed run leaves
the schema at 0009 with nothing half-applied, but PostgreSQL reports only the first offending
row. Run this query first and resolve what it returns:

    SELECT id, tutor_id, start_date, end_date, status
    FROM tutor_availability_exceptions
    WHERE end_date < start_date
    ORDER BY start_date;

Unlike `ck_tutor_availability_exceptions_time_order`, this check carries no NULL escape hatch:
`start_date` and `end_date` have been NOT NULL since 0001, so the bare comparison cannot
evaluate to NULL and pass. The comparison is also `>=` rather than `>` — a single-day
exception with `start_date == end_date` is a legitimate row and the range check it feeds is
inclusive on both ends.
"""
from collections.abc import Sequence

from alembic import op

revision: str = '0010'
down_revision: str | None = '0009'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        'ck_tutor_availability_exceptions_date_order',
        'tutor_availability_exceptions',
        'end_date >= start_date',
    )


def downgrade() -> None:
    op.drop_constraint(
        'ck_tutor_availability_exceptions_date_order',
        'tutor_availability_exceptions',
        type_='check',
    )
