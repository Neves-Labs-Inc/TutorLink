"""booking_request and question flag reasons

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-01 00:00:00.000000

The bot hands two more kinds of chat to the office: a first-session booking request for a child
with no grade, and a parent question the bot cannot answer. Neither is a bot failure; like
`guardian_link_request` they are routine handoffs, so they are new `flag_reason` values rather
than a reuse of `stuck`.

The upgrade adds the values and never uses them. `alembic/env.py` runs a whole upgrade as one
transaction, and PostgreSQL refuses an enum value inside the transaction that added it.

The downgrade is lossy by design. PostgreSQL cannot drop a value from an enum, so the type is
rebuilt with the previous values; before that, every flag carrying either new value is cleared
(both halves of the flag together). A conversation with a pending reactivation request falls
back to `reactivation_request` instead, so the request never drops out of the flagged queue.

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0020'
down_revision: str | None = '0019'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than read from the model's enum: a migration records the schema at one
# point in history, and the model's constant holds the newer values.
FLAG_REASON_VALUES_BEFORE = (
    'stuck',
    'parse_error',
    'guardian_link_request',
    'reactivation_request',
)
NEW_FLAG_REASONS = ('booking_request', 'question')


def upgrade() -> None:
    for value in NEW_FLAG_REASONS:
        op.execute(f"ALTER TYPE flag_reason ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    cleared = ", ".join(f"'{value}'" for value in NEW_FLAG_REASONS)
    op.execute(
        "UPDATE conversations SET"
        " flag_reason = CASE WHEN reactivation_child_id IS NULL THEN NULL"
        " ELSE 'reactivation_request'::flag_reason END,"
        " flagged_at = CASE WHEN reactivation_child_id IS NULL THEN NULL ELSE now() END"
        f" WHERE flag_reason IN ({cleared})"
    )
    op.execute("ALTER TYPE flag_reason RENAME TO flag_reason_old")
    values = ", ".join(f"'{value}'" for value in FLAG_REASON_VALUES_BEFORE)
    op.execute(f"CREATE TYPE flag_reason AS ENUM ({values})")
    op.execute(
        "ALTER TABLE conversations ALTER COLUMN flag_reason"
        " TYPE flag_reason USING flag_reason::text::flag_reason"
    )
    op.execute("DROP TYPE flag_reason_old")
