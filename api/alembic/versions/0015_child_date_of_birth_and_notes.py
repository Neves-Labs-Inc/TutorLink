"""child date of birth and notes, replacing age

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-23 00:00:00.000000

`age` is dropped in favour of `date_of_birth`, because an age at registration is wrong a year
later, and `notes` is added for what the office should know about a child (OQ-43). A separate
revision rather than an edit to 0014: 0014 is already applied to every stack that ran Phase 7,
and alembic would never re-run an edited revision (decision P7-AB).

No backfill. An age cannot be turned into a date, and an approximated one would look exactly
like a real one on the record, so every existing row gets a NULL `date_of_birth` and an admin
fills it in (A-44). The column is nullable for those rows only; every write path requires it.
There is no CHECK on the date: the plausibility bound is `child_service`'s, as with every other
bound in this schema.

The downgrade is lossy. `notes` is dropped outright. `age` is recomputed as the whole years
between `date_of_birth` and the row's `created_at` — its age at registration, which is what the
column meant — and is 0 for a row with no date of birth, because the old column is NOT NULL.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0015'
down_revision: str | None = '0014'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('children', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('children', sa.Column('notes', sa.Text(), nullable=True))
    op.drop_column('children', 'age')


def downgrade() -> None:
    op.add_column('children', sa.Column('age', sa.Integer(), nullable=True))
    op.execute(
        "UPDATE children SET age = COALESCE("
        "date_part('year', age(created_at::date, date_of_birth))::integer, 0)"
    )
    op.alter_column('children', 'age', existing_type=sa.Integer(), nullable=False)
    op.drop_column('children', 'notes')
    op.drop_column('children', 'date_of_birth')
