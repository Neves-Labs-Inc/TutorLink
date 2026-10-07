"""consent phone number and the blocked_by_whatsapp skip reason

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-07 00:00:00.000000

A WhatsApp block belongs to one Guardian on one phone number (#119), so each consent row records
the number its evidence came from: NULL for a `staff` row, a number for every other. Existing
non-staff rows take their Guardian's current number, so every block in the data stands exactly
as it did before. The weekly run gains the skip reason `blocked_by_whatsapp`.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0028'
down_revision: str | None = '0027'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STAFF_PHONE_CONSTRAINT = 'ck_reminder_consents_staff_phone_pair'
STAFF_PHONE_PREDICATE = "(source = 'staff') = (phone_number IS NULL)"
SKIP_REASON_CONSTRAINT = 'ck_booking_reminders_skip_reason'
# Spelled out rather than read from the models, as 0021 explains.
SKIP_REASONS_BEFORE = ('takeover', 'template_not_approved')
SKIP_REASONS = ('blocked_by_whatsapp', 'takeover', 'template_not_approved')
# Where the downgrade puts a `blocked_by_whatsapp` skip; see `downgrade`.
DOWNGRADED_SKIP_REASON = 'takeover'


def upgrade() -> None:
    op.add_column(
        'reminder_consents', sa.Column('phone_number', sa.String(length=32), nullable=True)
    )
    op.execute(
        "UPDATE reminder_consents SET phone_number = guardians.phone_number"
        " FROM guardians"
        " WHERE guardians.id = reminder_consents.guardian_id"
        " AND reminder_consents.source <> 'staff'"
    )
    op.create_check_constraint(STAFF_PHONE_CONSTRAINT, 'reminder_consents', STAFF_PHONE_PREDICATE)
    op.drop_constraint(SKIP_REASON_CONSTRAINT, 'booking_reminders', type_='check')
    op.create_check_constraint(
        SKIP_REASON_CONSTRAINT, 'booking_reminders', _in('skip_reason', SKIP_REASONS)
    )


def downgrade() -> None:
    # A `blocked_by_whatsapp` skip is relabelled, not deleted: the row is the week's de-dup,
    # and deleting it would let a rerun remind a number that blocked us. No older reason is
    # true of it; `takeover` at least reads as "Staff were handling this Guardian".
    op.execute(
        f"UPDATE booking_reminders SET skip_reason = '{DOWNGRADED_SKIP_REASON}'"
        " WHERE skip_reason = 'blocked_by_whatsapp'"
    )
    op.drop_constraint(SKIP_REASON_CONSTRAINT, 'booking_reminders', type_='check')
    op.create_check_constraint(
        SKIP_REASON_CONSTRAINT, 'booking_reminders', _in('skip_reason', SKIP_REASONS_BEFORE)
    )
    op.drop_constraint(STAFF_PHONE_CONSTRAINT, 'reminder_consents', type_='check')
    op.drop_column('reminder_consents', 'phone_number')


def _in(column: str, values: Sequence[str]) -> str:
    listed = ', '.join(f"'{value}'" for value in values)

    return f'{column} IN ({listed})'
