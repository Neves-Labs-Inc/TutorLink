"""subject name unique ignoring case

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-12 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0036'
down_revision: str | None = '0035'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = 'uq_subjects_name_lower'
# Postgres's default name for 0001's unnamed `UniqueConstraint('name')`.
NAME_CONSTRAINT = 'subjects_name_key'


def _case_duplicates() -> list[list[str]]:
    rows = op.get_bind().execute(
        sa.text(
            'SELECT array_agg(name ORDER BY name) FROM subjects'
            ' GROUP BY lower(name) HAVING count(*) > 1'
        )
    )

    return [list(names) for (names,) in rows]


def upgrade() -> None:
    # Names are never rewritten or deleted here: which spelling to keep is a person's call.
    clashes = _case_duplicates()
    if clashes:
        listed = '; '.join(', '.join(names) for names in clashes)
        raise RuntimeError(
            f'Subject names that differ only by case must be renamed before 0036: {listed}'
        )

    op.drop_constraint(NAME_CONSTRAINT, 'subjects', type_='unique')
    op.create_index(INDEX_NAME, 'subjects', [sa.text('lower(name)')], unique=True)


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name='subjects')
    op.create_unique_constraint(NAME_CONSTRAINT, 'subjects', ['name'])
