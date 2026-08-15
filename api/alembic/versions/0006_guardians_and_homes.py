"""split guardians from homes

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0006'
down_revision: str | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `parents` fused identity (phone, name) with location (address, access_code). That works
    # only while a child has exactly one of each. Separated guardians mean two of both, either
    # may book into the other's home, and siblings share the pair.
    #
    # This migration restructures rather than adds. It is only safe because nothing is
    # deployed: a live system would need a backfill creating one home per parent row and
    # linking it to that parent's children. There is no such system, so there is no such code.
    op.rename_table('parents', 'guardians')
    op.execute('ALTER INDEX ix_parents_phone_number RENAME TO ix_guardians_phone_number')

    op.create_table('homes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('label', sa.String(length=64), nullable=True),
    sa.Column('address', sa.Text(), nullable=False),
    sa.Column('access_code', sa.String(length=64), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )

    # Address and access code now live on `homes`, so they leave `guardians`.
    op.drop_column('guardians', 'address')
    op.drop_column('guardians', 'access_code')

    op.create_table('child_guardians',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('child_id', sa.UUID(), nullable=False),
    sa.Column('guardian_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['child_id'], ['children.id'], ),
    sa.ForeignKeyConstraint(['guardian_id'], ['guardians.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('child_id', 'guardian_id', name='uq_child_guardians_child_guardian')
    )
    op.create_index('ix_child_guardians_guardian_id', 'child_guardians', ['guardian_id'], unique=False)

    op.create_table('child_homes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('child_id', sa.UUID(), nullable=False),
    sa.Column('home_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['child_id'], ['children.id'], ),
    sa.ForeignKeyConstraint(['home_id'], ['homes.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('child_id', 'home_id', name='uq_child_homes_child_home')
    )
    op.create_index('ix_child_homes_home_id', 'child_homes', ['home_id'], unique=False)

    op.create_table('guardian_homes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('guardian_id', sa.UUID(), nullable=False),
    sa.Column('home_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['guardian_id'], ['guardians.id'], ),
    sa.ForeignKeyConstraint(['home_id'], ['homes.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('guardian_id', 'home_id', name='uq_guardian_homes_guardian_home')
    )
    op.create_index('ix_guardian_homes_home_id', 'guardian_homes', ['home_id'], unique=False)

    # The child-to-guardian link is now a junction row, not a column.
    op.drop_index('ix_children_parent_id', table_name='children')
    op.drop_column('children', 'parent_id')

    op.add_column('bookings', sa.Column('home_id', sa.UUID(), nullable=False))
    op.add_column('bookings', sa.Column('booked_by_guardian_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_bookings_home_id', 'bookings', 'homes', ['home_id'], ['id'])
    op.create_foreign_key(
        'fk_bookings_booked_by_guardian_id', 'bookings', 'guardians', ['booked_by_guardian_id'], ['id']
    )
    op.create_index('ix_bookings_home_id', 'bookings', ['home_id'], unique=False)


def downgrade() -> None:
    # Ordering matters here: `parents` does not exist again until the rename near the end, so
    # everything that references it by name has to come after that, not before.
    #
    # This direction cannot restore data. The upgrade moves address and access code onto
    # `homes` and the downgrade drops that table, so the columns come back empty. On a
    # populated database the NOT NULL adds below will fail rather than fabricate values, which
    # is the honest outcome for a restructuring this size.
    op.drop_index('ix_bookings_home_id', table_name='bookings')
    op.drop_constraint('fk_bookings_booked_by_guardian_id', 'bookings', type_='foreignkey')
    op.drop_constraint('fk_bookings_home_id', 'bookings', type_='foreignkey')
    op.drop_column('bookings', 'booked_by_guardian_id')
    op.drop_column('bookings', 'home_id')

    op.drop_index('ix_guardian_homes_home_id', table_name='guardian_homes')
    op.drop_table('guardian_homes')
    op.drop_index('ix_child_homes_home_id', table_name='child_homes')
    op.drop_table('child_homes')
    op.drop_index('ix_child_guardians_guardian_id', table_name='child_guardians')
    op.drop_table('child_guardians')

    op.drop_table('homes')

    op.execute('ALTER INDEX ix_guardians_phone_number RENAME TO ix_parents_phone_number')
    op.rename_table('guardians', 'parents')

    op.add_column('parents', sa.Column('address', sa.Text(), nullable=False))
    op.add_column('parents', sa.Column('access_code', sa.String(length=64), nullable=False))

    op.add_column('children', sa.Column('parent_id', sa.UUID(), nullable=False))
    op.create_foreign_key('children_parent_id_fkey', 'children', 'parents', ['parent_id'], ['id'])
    op.create_index('ix_children_parent_id', 'children', ['parent_id'], unique=False)
