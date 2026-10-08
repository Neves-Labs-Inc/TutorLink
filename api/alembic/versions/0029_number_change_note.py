"""number change note system kind

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-07 00:00:00.000000

A Guardian's thread now moves with their number (#126), and the move leaves a Staff-only line
in the thread: `messages.system_kind = 'number_change_note'`. `ck_messages_system_kind` keeps
its name and widens to allow it.

"""

from collections.abc import Sequence

from alembic import op

revision: str = '0029'
down_revision: str | None = '0028'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYSTEM_KIND_CONSTRAINT = 'ck_messages_system_kind'
# Spelled out rather than read from the models, as 0021 explains.
SYSTEM_KINDS_BEFORE = (
    'takeover_notice',
    'transfer_notice',
    'handback_notice',
    'booking_reminder',
    'consent_notice',
)
SYSTEM_KINDS = (*SYSTEM_KINDS_BEFORE, 'number_change_note')


def upgrade() -> None:
    op.drop_constraint(SYSTEM_KIND_CONSTRAINT, 'messages', type_='check')
    op.create_check_constraint(
        SYSTEM_KIND_CONSTRAINT, 'messages', _in('system_kind', SYSTEM_KINDS)
    )


def downgrade() -> None:
    # The line is deleted, not relabelled: no older kind is true of it, and it was never sent,
    # so the thread loses only the note of where its earlier messages went.
    op.execute("DELETE FROM messages WHERE system_kind = 'number_change_note'")
    op.drop_constraint(SYSTEM_KIND_CONSTRAINT, 'messages', type_='check')
    op.create_check_constraint(
        SYSTEM_KIND_CONSTRAINT, 'messages', _in('system_kind', SYSTEM_KINDS_BEFORE)
    )


def _in(column: str, values: Sequence[str]) -> str:
    listed = ', '.join(f"'{value}'" for value in values)

    return f'{column} IN ({listed})'
