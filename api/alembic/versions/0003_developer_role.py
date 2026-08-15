"""developer role

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-14 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # This migration adds the value and does nothing else, deliberately. PostgreSQL refuses to
    # *use* a value added by ALTER TYPE ... ADD VALUE inside the transaction that added it, and
    # Alembic wraps every migration in one — so batching this with anything that writes
    # 'developer' would fail at runtime rather than at review.
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'developer'")


def downgrade() -> None:
    # PostgreSQL cannot remove a value from an enum. The type is rebuilt without `developer` and
    # every column using it re-pointed; `users.role` is the only one. Renaming the old type first
    # keeps the column valid throughout, and ALTER COLUMN TYPE rebuilds ix_users_email_role.
    #
    # Existing developers are demoted, not deleted: a downgrade that removed the only accounts
    # able to administer the system would be worse than one that reduced their privileges.
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'developer'")
    op.execute("ALTER TYPE user_role RENAME TO user_role_old")
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'tutor')")
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role")
    op.execute("DROP TYPE user_role_old")
