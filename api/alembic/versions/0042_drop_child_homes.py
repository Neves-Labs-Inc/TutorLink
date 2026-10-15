"""Drop child_homes: a Child's Homes are its Guardians' Homes

Revision ID: 0042
Revises: 0041
Create Date: 2026-10-14 00:00:00.000000

A Child's Home set is now derived (`child_guardians` -> `guardian_homes`), so the hand-kept
list goes. No data moves: for a Child whose Homes came from its Guardians the derived set is a
superset of the old list, and the wider set is accepted at cutover (#214).

The one link the derived set cannot keep is a `child_homes` row whose Home no Guardian of that
Child owns. Dropping it would take the Home away from the Child without anyone noticing, so the
upgrade refuses while any exists and names the count; an operator resolves each one (link the
Home to a Guardian through `guardian_homes`, or delete the row) and reruns.

The downgrade recreates the table as 0006 built it and backfills it from the derived set, one
row per distinct child/home pair.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0042'
down_revision: str | None = '0041'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'child_homes'
UNIQUE = 'uq_child_homes_child_home'
INDEX = 'ix_child_homes_home_id'

UNREACHABLE_LINKS = """
SELECT count(*) FROM child_homes
WHERE NOT EXISTS (
    SELECT 1 FROM child_guardians
    JOIN guardian_homes ON guardian_homes.guardian_id = child_guardians.guardian_id
    WHERE child_guardians.child_id = child_homes.child_id
      AND guardian_homes.home_id = child_homes.home_id
)
"""


def upgrade() -> None:
    unreachable = op.get_bind().execute(sa.text(UNREACHABLE_LINKS)).scalar_one()

    if unreachable:
        raise RuntimeError(
            f'{unreachable} child_homes row(s) link a Child to a Home that none of its Guardians'
            ' owns; dropping child_homes would lose them. Link each Home to one of the'
            " Child's Guardians (guardian_homes) or delete the row, then rerun the upgrade."
        )

    op.drop_index(INDEX, table_name=TABLE)
    # Dropping the table drops its unique constraint with it.
    op.drop_table(TABLE)


def downgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('child_id', sa.UUID(), nullable=False),
        sa.Column('home_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['child_id'], ['children.id']),
        sa.ForeignKeyConstraint(['home_id'], ['homes.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('child_id', 'home_id', name=UNIQUE),
    )
    op.create_index(INDEX, TABLE, ['home_id'], unique=False)
    op.execute(
        'INSERT INTO child_homes (child_id, home_id)'
        ' SELECT DISTINCT child_guardians.child_id, guardian_homes.home_id'
        ' FROM child_guardians'
        ' JOIN guardian_homes ON guardian_homes.guardian_id = child_guardians.guardian_id'
    )
