"""conversations and messages

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-22 00:00:00.000000

The two chat tables, the four enum types they use, and the one `system_settings` row the
retention job reads. `flagged_conversations` is deliberately not a table: `phone_number`,
`guardian_id`, the last message and the flag time are all already on `conversations` or
derivable from `messages`, so only the reason survives — as `flag_reason`/`flagged_at` here,
kept separate from `status` so that "flagged and unattended" stays expressible.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0014'
down_revision: str | None = '0013'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONVERSATION_STATUS_VALUES = ("bot", "human")
MESSAGE_AUTHOR_VALUES = ("client", "bot", "admin")
MESSAGE_STATUS_VALUES = ("received", "queued", "sent", "delivered", "failed")
# Three values, and there is no fourth. A reschedule or cancellation refused inside
# `cancellation_cutoff_hours` is a policy refusal rather than a bot failure; flagging it would
# bury the flags that mean the bot needs help.
FLAG_REASON_VALUES = ("stuck", "parse_error", "guardian_link_request")

# Created and dropped by hand, exactly as 0001 and 0008 do. `create_type=False` on the shared
# enum objects in app/models/enums.py hands both halves of that job to this file: a native
# PostgreSQL enum outlives DROP TABLE, so a type left implicit here would survive
# `alembic downgrade base` and break the next upgrade with "type already exists".
conversation_status = postgresql.ENUM(
    *CONVERSATION_STATUS_VALUES, name="conversation_status", create_type=False
)
message_author = postgresql.ENUM(*MESSAGE_AUTHOR_VALUES, name="message_author", create_type=False)
message_status = postgresql.ENUM(*MESSAGE_STATUS_VALUES, name="message_status", create_type=False)
flag_reason = postgresql.ENUM(*FLAG_REASON_VALUES, name="flag_reason", create_type=False)

# How long a message is kept before the retention purge deletes it; `0` means never purge. A
# conversation left with no surviving messages goes with them.
#
# `is_developer_only` is FALSE: retention is a business policy the client will want to set, not
# a developer knob. The column default is TRUE so that a row inserted without thinking about it
# hides rather than leaks, which means this has to say FALSE out loud, exactly as 0011's,
# 0012's and 0013's rows do.
SEED_SETTINGS = (
    ('chat_retention_days', '365', 'integer', False),
)

system_settings = sa.table(
    'system_settings',
    sa.column('key', sa.String),
    sa.column('value', sa.Text),
    sa.column('value_type', sa.String),
    sa.column('is_developer_only', sa.Boolean),
)


def upgrade() -> None:
    op.execute("CREATE TYPE conversation_status AS ENUM ('bot', 'human')")
    op.execute("CREATE TYPE message_author AS ENUM ('client', 'bot', 'admin')")
    op.execute(
        "CREATE TYPE message_status AS ENUM ('received', 'queued', 'sent', 'delivered', 'failed')"
    )
    op.execute("CREATE TYPE flag_reason AS ENUM ('stuck', 'parse_error', 'guardian_link_request')")

    op.create_table('conversations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('phone_number', sa.String(length=32), nullable=False),
    sa.Column('guardian_id', sa.UUID(), nullable=True),
    sa.Column('status', conversation_status, server_default=sa.text("'bot'"), nullable=False),
    sa.Column('taken_over_by_user_id', sa.UUID(), nullable=True),
    sa.Column('taken_over_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_message_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('flag_reason', flag_reason, nullable=True),
    sa.Column('flagged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    # Ties the two halves of the takeover state together: `human` with nobody holding it, and a
    # holder with the bot still running, are both unrepresentable rather than merely discouraged.
    sa.CheckConstraint("(status = 'human') = (taken_over_by_user_id IS NOT NULL)", name='ck_conversations_takeover_pair'),
    sa.ForeignKeyConstraint(['guardian_id'], ['guardians.id'], ),
    sa.ForeignKeyConstraint(['taken_over_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('phone_number')
    )
    # Not unique: a guardian who changes handsets gets a second thread carrying the same
    # `guardian_id`, and the older one stays readable as history.
    op.create_index('ix_conversations_guardian_id', 'conversations', ['guardian_id'], unique=False)
    # DESC because the conversation list reads newest first and nothing reads it the other way.
    op.create_index('ix_conversations_last_message_at', 'conversations', [sa.text('last_message_at DESC')], unique=False)

    op.create_table('messages',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('conversation_id', sa.UUID(), nullable=False),
    sa.Column('author_kind', message_author, nullable=False),
    sa.Column('author_user_id', sa.UUID(), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('twilio_sid', sa.String(length=64), nullable=True),
    sa.Column('status', message_status, nullable=False),
    sa.Column('error_code', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(author_kind = 'admin') = (author_user_id IS NOT NULL)", name='ck_messages_admin_author_pair'),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ),
    sa.ForeignKeyConstraint(['author_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    # The webhook-retry guard. Twilio retries a delivery it believes failed, so the same
    # message can arrive twice; the insert is the idempotency check. NULLs stay distinct under
    # a PostgreSQL unique index, which is what lets every bot reply record with no SID.
    sa.UniqueConstraint('twilio_sid')
    )
    op.create_index('ix_messages_conversation_id_created_at', 'messages', ['conversation_id', 'created_at'], unique=False)

    op.bulk_insert(
        system_settings,
        [
            {'key': key, 'value': value, 'value_type': value_type, 'is_developer_only': developer_only}
            for key, value, value_type, developer_only in SEED_SETTINGS
        ],
    )


def downgrade() -> None:
    # Deletes exactly this key, never the whole table: 0004's, 0011's, 0012's and 0013's rows
    # live here too and a blanket DELETE would take them with it.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )

    op.drop_index('ix_messages_conversation_id_created_at', table_name='messages')
    op.drop_table('messages')
    op.drop_index('ix_conversations_last_message_at', table_name='conversations')
    op.drop_index('ix_conversations_guardian_id', table_name='conversations')
    op.drop_table('conversations')

    # The types outlive their tables, so they are dropped explicitly or the next upgrade fails.
    op.execute("DROP TYPE flag_reason")
    op.execute("DROP TYPE message_status")
    op.execute("DROP TYPE message_author")
    op.execute("DROP TYPE conversation_status")
