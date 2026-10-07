"""manager role

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-05 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

revision: str = '0022'
down_revision: str | None = '0021'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Adds the value and nothing else, as 0003 does: PostgreSQL refuses to use a value added by
    # ALTER TYPE ... ADD VALUE inside the transaction that added it.
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager'")


def downgrade() -> None:
    # PostgreSQL cannot remove an enum value, so the type is rebuilt without `manager`, as in
    # 0003. Managers are demoted to admin rather than deleted: their rows are referenced as
    # authors, holders and evaluators, and admin is the nearest role that keeps them working.
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'manager'")
    op.execute("ALTER TYPE user_role RENAME TO user_role_old")
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'tutor', 'developer')")
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role")
    op.execute("DROP TYPE user_role_old")
