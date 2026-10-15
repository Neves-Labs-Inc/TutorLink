"""Time off keyed on the Staff user; one free-text reason

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-14 00:00:00.000000

Time off belongs to a person (`user_id`), not a teaching profile, so an Admin can hold it.
The fixed category and the separate note fold into one optional free-text `reason`: the note
when it says anything, otherwise the old category word. The decision and cancellation columns
and the `cancelled` status are added unused, ready for the lifecycle that follows.

`ALTER TYPE ... ADD VALUE` runs in an autocommit block, outside the run's one transaction:
PostgreSQL refuses to use a new enum value in the transaction that added it, and a later
migration applied in the same `upgrade head` may need `cancelled`.

The downgrade is lossy by decision: rows whose user has no teaching profile and `cancelled`
rows cannot exist in the old schema and are deleted, and every reason comes back as the note
under the category `other`.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0038'
down_revision: str | None = '0037'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = 'tutor_availability_exceptions'
USER_FK = 'fk_tutor_availability_exceptions_user_id_users'
DECIDED_BY_FK = 'fk_tutor_availability_exceptions_decided_by_users'
CANCELLED_BY_FK = 'fk_tutor_availability_exceptions_cancelled_by_users'
# The name 0001 left to PostgreSQL's default, restored under the same default.
TUTOR_FK_BEFORE = 'tutor_availability_exceptions_tutor_id_fkey'
TUTOR_INDEX = 'ix_tutor_availability_exceptions_tutor_id_dates'
USER_INDEX = 'ix_tutor_availability_exceptions_user_id_dates'
REASON_MAX_LENGTH = 500
CATEGORY_LENGTH = 32


def upgrade() -> None:
    # First, and committed on its own: later migrations in the same run can use the value, and
    # if it fails nothing else of 0038 has been committed, so a rerun is safe.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE exception_status ADD VALUE IF NOT EXISTS 'cancelled'")

    op.add_column(TABLE, sa.Column('user_id', sa.UUID(), nullable=True))
    op.execute(
        f'UPDATE {TABLE} SET user_id = tutors.user_id FROM tutors'
        f' WHERE tutors.id = {TABLE}.tutor_id'
    )
    op.alter_column(TABLE, 'user_id', existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(USER_FK, TABLE, 'users', ['user_id'], ['id'])
    op.drop_index(TUTOR_INDEX, table_name=TABLE)
    # Dropping the column drops its foreign key with it.
    op.drop_column(TABLE, 'tutor_id')
    op.create_index(USER_INDEX, TABLE, ['user_id', 'start_date', 'end_date'])

    op.alter_column(
        TABLE,
        'reason',
        existing_type=sa.String(CATEGORY_LENGTH),
        type_=sa.String(REASON_MAX_LENGTH),
        nullable=True,
    )
    # Trimmed and cut to the new limit: a note was unbounded text.
    op.execute(
        f"UPDATE {TABLE} SET reason = left(btrim(notes), {REASON_MAX_LENGTH})"
        " WHERE btrim(coalesce(notes, '')) <> ''"
    )
    op.drop_column(TABLE, 'notes')

    op.add_column(TABLE, sa.Column('decided_by', sa.UUID(), nullable=True))
    op.add_column(TABLE, sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(TABLE, sa.Column('cancelled_by', sa.UUID(), nullable=True))
    op.add_column(TABLE, sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(DECIDED_BY_FK, TABLE, 'users', ['decided_by'], ['id'])
    op.create_foreign_key(CANCELLED_BY_FK, TABLE, 'users', ['cancelled_by'], ['id'])


def downgrade() -> None:
    # Compared as text: the enum value may have been added in this same transaction.
    op.execute(f"DELETE FROM {TABLE} WHERE status::text = 'cancelled'")
    # PostgreSQL cannot drop an enum value, so the type is rebuilt without it.
    op.execute(f'ALTER TABLE {TABLE} ALTER COLUMN status DROP DEFAULT')
    op.execute('ALTER TYPE exception_status RENAME TO exception_status_0038')
    op.execute("CREATE TYPE exception_status AS ENUM ('pending', 'approved', 'rejected')")
    op.execute(
        f'ALTER TABLE {TABLE} ALTER COLUMN status TYPE exception_status'
        ' USING status::text::exception_status'
    )
    op.execute(f"ALTER TABLE {TABLE} ALTER COLUMN status SET DEFAULT 'approved'")
    op.execute('DROP TYPE exception_status_0038')

    op.drop_constraint(CANCELLED_BY_FK, TABLE, type_='foreignkey')
    op.drop_constraint(DECIDED_BY_FK, TABLE, type_='foreignkey')
    op.drop_column(TABLE, 'cancelled_at')
    op.drop_column(TABLE, 'cancelled_by')
    op.drop_column(TABLE, 'decided_at')
    op.drop_column(TABLE, 'decided_by')

    op.add_column(TABLE, sa.Column('notes', sa.Text(), nullable=True))
    op.execute(f"UPDATE {TABLE} SET notes = reason, reason = 'other'")
    op.alter_column(
        TABLE,
        'reason',
        existing_type=sa.String(REASON_MAX_LENGTH),
        type_=sa.String(CATEGORY_LENGTH),
        nullable=False,
    )

    op.execute(
        f'DELETE FROM {TABLE} WHERE NOT EXISTS'
        f' (SELECT 1 FROM tutors WHERE tutors.user_id = {TABLE}.user_id)'
    )
    op.add_column(TABLE, sa.Column('tutor_id', sa.UUID(), nullable=True))
    op.execute(
        f'UPDATE {TABLE} SET tutor_id = tutors.id FROM tutors'
        f' WHERE tutors.user_id = {TABLE}.user_id'
    )
    op.alter_column(TABLE, 'tutor_id', existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(TUTOR_FK_BEFORE, TABLE, 'tutors', ['tutor_id'], ['id'])
    op.drop_index(USER_INDEX, table_name=TABLE)
    op.create_index(TUTOR_INDEX, TABLE, ['tutor_id', 'start_date', 'end_date'])
    op.drop_constraint(USER_FK, TABLE, type_='foreignkey')
    op.drop_column(TABLE, 'user_id')
