"""grade level as an integer, with a per-subject ceiling

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0005'
down_revision: str | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Grade level is an ordering — a tutor may take a student at or below their own grade,
    # never above — and free text cannot express that. 'Grade 10' sorts before 'Grade 7'.
    #
    # The USING cast fails loudly on any non-numeric value already stored. That is deliberate:
    # nothing is deployed, so the column is empty, and this migration is only safe *because*
    # it is empty. A real 'Grade 7' would abort the migration rather than corrupt the column.
    op.alter_column(
        'children',
        'grade_level',
        existing_type=sa.String(length=64),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using='grade_level::integer',
    )

    # The array becomes a single ceiling. Enumerating every covered grade was never what the
    # business meant, and a set cannot answer "is this tutor senior enough" without scanning.
    op.drop_column('tutor_subjects', 'grade_levels')
    op.add_column('tutor_subjects', sa.Column('max_grade_level', sa.Integer(), nullable=False))


def downgrade() -> None:
    op.drop_column('tutor_subjects', 'max_grade_level')
    op.add_column(
        'tutor_subjects',
        sa.Column('grade_levels', postgresql.ARRAY(sa.String()), nullable=False),
    )

    # Integer to text is always safe, so this direction needs no empty-table caveat. The
    # original labels are gone either way — they were never stored, only rendered.
    op.alter_column(
        'children',
        'grade_level',
        existing_type=sa.Integer(),
        type_=sa.String(length=64),
        existing_nullable=False,
        postgresql_using='grade_level::text',
    )
