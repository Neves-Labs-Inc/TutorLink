"""bot agent runtime columns, didnt_understand flag reason and handoff_note system kind

Revision ID: 0053
Revises: 0052
Create Date: 2026-10-19 00:00:00.000000

The WhatsApp bot agent (docs/specs/whatsapp-bot-agent.md §8) keeps its runtime state on
`conversations`: the pending proposal (`proposal_actions` with `proposed_at`, both set or both
NULL), the no-progress counter, the outage apology stamp, and `turn_due_at` for the worker's poll,
read through a partial index. `messages.redacted_fields` names the sensitive fields a message
carried, so history can show a placeholder while the body stays intact for the office.

`flag_reason` swaps its meanings: `didnt_understand` is the bot not making sense of the Guardian
(what `stuck` meant), and `stuck` is the bot itself failing (what `parse_error` meant).
`parse_error` is retired. Rows are remapped `stuck` -> `didnt_understand`, then
`parse_error` -> `stuck`, on both `flag_reason` and `handled_flag_reason`; one CASE does both at
once, which lands where the ordered pair does. PostgreSQL cannot drop an enum value, so the type
is rebuilt.

`handoff_note` is a Staff-only line like `number_change_note`; `ck_messages_system_kind` widens.

`bot_flow_state` stays; a later migration drops it.

The downgrade inverts the remap exactly, deletes the handoff notes (never sent; no older kind
is true of them) and drops the new columns.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0053'
down_revision: str | None = '0052'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than read from the models, as 0021 explains.
FLAG_REASON_VALUES_BEFORE = (
    'stuck',
    'parse_error',
    'guardian_link_request',
    'reactivation_request',
    'booking_request',
    'question',
    'reply_window_closed',
)
FLAG_REASON_VALUES = (
    'stuck',
    'didnt_understand',
    'guardian_link_request',
    'reactivation_request',
    'booking_request',
    'question',
    'reply_window_closed',
)
FLAG_COLUMNS = ('flag_reason', 'handled_flag_reason')
# Old value -> new value. Applied as one CASE, so `stuck` rows are not caught twice.
UPGRADE_REMAP = {'stuck': 'didnt_understand', 'parse_error': 'stuck'}
DOWNGRADE_REMAP = {'stuck': 'parse_error', 'didnt_understand': 'stuck'}

SYSTEM_KIND_CONSTRAINT = 'ck_messages_system_kind'
SYSTEM_KINDS_BEFORE = (
    'takeover_notice',
    'transfer_notice',
    'handback_notice',
    'booking_reminder',
    'consent_notice',
    'number_change_note',
)
SYSTEM_KINDS = (*SYSTEM_KINDS_BEFORE, 'handoff_note')

REDACTED_FIELDS_CONSTRAINT = 'ck_messages_redacted_fields'
REDACTABLE_FIELDS = ('home_address', 'home_directions', 'child_date_of_birth', 'child_notes')

PROPOSAL_PAIR_CONSTRAINT = 'ck_conversations_proposal_pair'
PROPOSAL_PAIR_PREDICATE = '(proposal_actions IS NULL) = (proposed_at IS NULL)'
TURN_DUE_INDEX = 'ix_conversations_turn_due_at'
TIMESTAMP_COLUMNS = ('proposed_at', 'outage_apology_sent_at', 'turn_due_at')


def upgrade() -> None:
    op.add_column(
        'conversations',
        sa.Column('proposal_actions', postgresql.JSONB(), nullable=True),
    )
    for column in TIMESTAMP_COLUMNS:
        op.add_column(
            'conversations', sa.Column(column, sa.DateTime(timezone=True), nullable=True)
        )
    op.add_column(
        'conversations',
        sa.Column('no_progress_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_check_constraint(
        PROPOSAL_PAIR_CONSTRAINT, 'conversations', PROPOSAL_PAIR_PREDICATE
    )
    op.create_index(
        TURN_DUE_INDEX,
        'conversations',
        ['turn_due_at'],
        postgresql_where=sa.text('turn_due_at IS NOT NULL'),
    )

    op.add_column('messages', sa.Column('redacted_fields', postgresql.ARRAY(sa.Text()), nullable=True))
    op.create_check_constraint(
        REDACTED_FIELDS_CONSTRAINT,
        'messages',
        f'redacted_fields <@ ARRAY[{_listed(REDACTABLE_FIELDS)}]::text[]',
    )
    _replace_system_kinds(SYSTEM_KINDS)

    _rebuild_flag_reason(FLAG_REASON_VALUES, remap=UPGRADE_REMAP)


def downgrade() -> None:
    _rebuild_flag_reason(FLAG_REASON_VALUES_BEFORE, remap=DOWNGRADE_REMAP)

    op.execute("DELETE FROM messages WHERE system_kind = 'handoff_note'")
    _replace_system_kinds(SYSTEM_KINDS_BEFORE)
    op.drop_constraint(REDACTED_FIELDS_CONSTRAINT, 'messages', type_='check')
    op.drop_column('messages', 'redacted_fields')

    op.drop_index(TURN_DUE_INDEX, table_name='conversations')
    op.drop_constraint(PROPOSAL_PAIR_CONSTRAINT, 'conversations', type_='check')
    op.drop_column('conversations', 'no_progress_count')
    for column in reversed(TIMESTAMP_COLUMNS):
        op.drop_column('conversations', column)
    op.drop_column('conversations', 'proposal_actions')


def _rebuild_flag_reason(values: Sequence[str], *, remap: dict[str, str]) -> None:
    op.execute('ALTER TYPE flag_reason RENAME TO flag_reason_0053')
    op.execute(f'CREATE TYPE flag_reason AS ENUM ({_listed(values)})')
    for column in FLAG_COLUMNS:
        cases = ' '.join(f"WHEN '{old}' THEN '{new}'" for old, new in remap.items())
        op.execute(
            f'ALTER TABLE conversations ALTER COLUMN {column} TYPE flag_reason'
            f' USING (CASE {column}::text {cases} ELSE {column}::text END)::flag_reason'
        )
    op.execute('DROP TYPE flag_reason_0053')


def _replace_system_kinds(kinds: Sequence[str]) -> None:
    op.drop_constraint(SYSTEM_KIND_CONSTRAINT, 'messages', type_='check')
    op.create_check_constraint(
        SYSTEM_KIND_CONSTRAINT, 'messages', f'system_kind IN ({_listed(kinds)})'
    )


def _listed(values: Sequence[str]) -> str:
    return ', '.join(f"'{value}'" for value in values)
