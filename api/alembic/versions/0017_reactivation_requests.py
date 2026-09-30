"""reactivation requests

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-23 00:00:00.000000

A guardian can ask the bot to reactivate one of their inactive children, and an admin approves or
denies the request from the chat thread (OQ-60). The request is recorded on the conversation
rather than in a new table (OQ-71, option (a)): a fourth `flag_reason` value,
`reactivation_request`, puts the thread in the flagged queue, and the nullable
`conversations.reactivation_child_id` is the request itself. Pending means the column is set; a
later `stuck` or `parse_error` overwrites the reason and leaves the column, so a request is never
lost to a flag that came after it.

The fourth value reverses the earlier "three values and no fourth" rule. The user reversed it on
2026-09-23 (the OQ-71 answer) for a reason that is not a failure: like `guardian_link_request`,
a reactivation request is an admin action the bot cannot take itself. The rule's own reason
stands untouched — a policy refusal, such as a reschedule refused inside the cancellation
cutoff, is still never a flag.

The upgrade adds the value and never uses it. `alembic/env.py` runs a whole upgrade as one
transaction, and PostgreSQL refuses an enum value inside the transaction that added it.

The downgrade is lossy by design. PostgreSQL cannot drop a value from an enum, so the type is
rebuilt with the three original values; before that, every `reactivation_request` flag is cleared
(both halves of the flag together) and the column is dropped, which forgets any pending request.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0017'
down_revision: str | None = '0016'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than read from the model's enum. A migration is a record of the schema at
# one point in history; the model's constant holds four values from this revision on, and
# rebuilding the type from it would make this downgrade restore a type that never existed.
FLAG_REASON_VALUES_BEFORE = ('stuck', 'parse_error', 'guardian_link_request')
REACTIVATION_REQUEST = 'reactivation_request'


def upgrade() -> None:
    op.execute(f"ALTER TYPE flag_reason ADD VALUE IF NOT EXISTS '{REACTIVATION_REQUEST}'")
    op.add_column(
        'conversations',
        sa.Column('reactivation_child_id', sa.UUID(), sa.ForeignKey('children.id'), nullable=True),
    )


def downgrade() -> None:
    op.execute(
        "UPDATE conversations SET flag_reason = NULL, flagged_at = NULL"
        f" WHERE flag_reason = '{REACTIVATION_REQUEST}'"
    )
    op.drop_column('conversations', 'reactivation_child_id')
    op.execute("ALTER TYPE flag_reason RENAME TO flag_reason_old")
    values = ", ".join(f"'{value}'" for value in FLAG_REASON_VALUES_BEFORE)
    op.execute(f"CREATE TYPE flag_reason AS ENUM ({values})")
    op.execute(
        "ALTER TABLE conversations ALTER COLUMN flag_reason"
        " TYPE flag_reason USING flag_reason::text::flag_reason"
    )
    op.execute("DROP TYPE flag_reason_old")
