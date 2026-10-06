"""system message author checks

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-05 00:00:00.000000

The first migration that uses `message_author = 'system'`, in its own transaction after 0023
added it. `ck_messages_admin_author_pair` keeps its name and widens: `admin` still requires
the user who typed it and `client`/`bot` still forbid one, while `system` may carry the Staff
member who caused the notice. A new pair CHECK ties `system` to `system_kind`.

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0024'
down_revision: str | None = '0023'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUTHOR_CONSTRAINT = 'ck_messages_admin_author_pair'
SYSTEM_KIND_CONSTRAINT = 'ck_messages_system_kind_pair'
AUTHOR_PREDICATE_BEFORE = "(author_kind = 'admin') = (author_user_id IS NOT NULL)"
AUTHOR_PREDICATE = (
    "author_kind = 'system' OR (author_kind = 'admin') = (author_user_id IS NOT NULL)"
)
SYSTEM_KIND_PREDICATE = "(author_kind = 'system') = (system_kind IS NOT NULL)"


def upgrade() -> None:
    op.drop_constraint(AUTHOR_CONSTRAINT, 'messages', type_='check')
    op.create_check_constraint(AUTHOR_CONSTRAINT, 'messages', AUTHOR_PREDICATE)
    op.create_check_constraint(SYSTEM_KIND_CONSTRAINT, 'messages', SYSTEM_KIND_PREDICATE)


def downgrade() -> None:
    # A system message with a user would fail the old CHECK, so system messages become `bot`
    # first; 0023's downgrade explains the choice.
    op.drop_constraint(SYSTEM_KIND_CONSTRAINT, 'messages', type_='check')
    op.execute(
        "UPDATE messages SET author_kind = 'bot', author_user_id = NULL"
        " WHERE author_kind = 'system'"
    )
    op.drop_constraint(AUTHOR_CONSTRAINT, 'messages', type_='check')
    op.create_check_constraint(AUTHOR_CONSTRAINT, 'messages', AUTHOR_PREDICATE_BEFORE)
