"""system message author

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-05 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0023'
down_revision: str | None = '0022'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MESSAGE_AUTHOR_VALUES_BEFORE = ('client', 'bot', 'admin')
AUTHOR_CONSTRAINT = 'ck_messages_admin_author_pair'
AUTHOR_PREDICATE = "(author_kind = 'admin') = (author_user_id IS NOT NULL)"


def upgrade() -> None:
    # Adds the value and nothing else; 0024 adds the CHECKs that use it. See 0003 for why.
    # Unlike 0003, the value has to be *committed* here: `env.py` runs a whole upgrade in one
    # transaction, and 0024 uses `system` in the same `upgrade head`. The autocommit block
    # commits everything before it and runs the ADD VALUE on its own.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE message_author ADD VALUE IF NOT EXISTS 'system'")


def downgrade() -> None:
    # System messages are converted to `bot`, not deleted. They record what the Guardian was
    # actually sent (a takeover notice, a weekly reminder), and deleting them would leave a
    # thread that no longer matches the Guardian's phone. `bot` is the only automated outbound
    # author the old type has; it forbids a user, so the causing Staff member is dropped.
    # 0024's downgrade does the same before restoring the old CHECK, so this finds rows only
    # when 0024 was never applied.
    op.execute(
        "UPDATE messages SET author_kind = 'bot', author_user_id = NULL"
        " WHERE author_kind = 'system'"
    )
    # The CHECK compares `author_kind` with a literal of the old type, which has no operator
    # against the new one, so it is dropped across the rebuild and recreated after it.
    op.drop_constraint(AUTHOR_CONSTRAINT, 'messages', type_='check')
    op.execute("ALTER TYPE message_author RENAME TO message_author_old")
    values = ", ".join(f"'{value}'" for value in MESSAGE_AUTHOR_VALUES_BEFORE)
    op.execute(f"CREATE TYPE message_author AS ENUM ({values})")
    op.execute(
        "ALTER TABLE messages ALTER COLUMN author_kind"
        " TYPE message_author USING author_kind::text::message_author"
    )
    op.execute("DROP TYPE message_author_old")
    op.create_check_constraint(AUTHOR_CONSTRAINT, 'messages', AUTHOR_PREDICATE)
