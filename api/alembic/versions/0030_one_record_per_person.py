"""one record per person

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-08 00:00:00.000000

`users` becomes the one record of a person (#130). Every Tutor profile hangs off a user through
`tutors.user_id`; a Tutor that had no login gets a password-less `tutor` user carrying its name
and email, so `tutors.name` and `tutors.email` can go. `users.display_name` is `users.name`,
`hashed_password` is nullable (NULL means the user cannot sign in), and `users.tutor_id` goes.

The upgrade refuses a database where two users link to the same Tutor: there is no rule for
which of them owns the profile, so it raises with every such pair and writes nothing (Alembic
runs the migration in one transaction).

Two things the ticket calls out as deliberately not handled, there being no real data: a Tutor
email that clashes with an unlinked user (the insert fails on `users.email` and the migration
aborts), and `tutors.is_active`, which is not carried onto the created user.

The downgrade is lossy by decision: a Tutor's name and email come back from its user, and the
password-less users the upgrade created are deleted, because the old schema cannot hold them.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0030'
down_revision: str | None = '0029'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USER_FK = 'fk_tutors_user_id_users'
USER_UNIQUE = 'uq_tutors_user_id'
# The names 0001 left to PostgreSQL's defaults, restored under the same defaults.
TUTOR_FK_BEFORE = 'users_tutor_id_fkey'
TUTOR_EMAIL_UNIQUE_BEFORE = 'tutors_email_key'

DUPLICATE_LINKS = (
    'SELECT tutor_id, array_agg(id ORDER BY id) AS user_ids'
    ' FROM users WHERE tutor_id IS NOT NULL'
    ' GROUP BY tutor_id HAVING count(*) > 1'
    ' ORDER BY tutor_id'
)


def upgrade() -> None:
    _abort_on_duplicate_links()

    # Nullable first: the users created next have no password.
    op.alter_column('users', 'hashed_password', existing_type=sa.String(255), nullable=True)
    # `tutor_id` is set on the created user so the fill below treats every Tutor alike.
    op.execute(
        'INSERT INTO users'
        ' (email, display_name, display_name_is_default, hashed_password, role, is_active,'
        ' tutor_id)'
        " SELECT tutors.email, tutors.name, false, NULL, 'tutor', true, tutors.id"
        ' FROM tutors'
        ' WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.tutor_id = tutors.id)'
    )

    op.alter_column('users', 'display_name', new_column_name='name')
    op.alter_column('users', 'display_name_is_default', new_column_name='name_is_default')

    op.add_column('tutors', sa.Column('user_id', sa.UUID(), nullable=True))
    op.execute(
        'UPDATE tutors SET user_id = users.id FROM users WHERE users.tutor_id = tutors.id'
    )
    op.alter_column('tutors', 'user_id', existing_type=sa.UUID(), nullable=False)
    op.create_unique_constraint(USER_UNIQUE, 'tutors', ['user_id'])
    op.create_foreign_key(USER_FK, 'tutors', 'users', ['user_id'], ['id'])
    # Dropping the column drops `tutors_email_key` with it.
    op.drop_column('tutors', 'name')
    op.drop_column('tutors', 'email')

    # Dropping the column drops `users_tutor_id_fkey` with it.
    op.drop_column('users', 'tutor_id')


def downgrade() -> None:
    op.add_column('tutors', sa.Column('name', sa.String(length=255), nullable=True))
    op.add_column('tutors', sa.Column('email', sa.String(length=255), nullable=True))
    op.execute(
        'UPDATE tutors SET name = users.name, email = users.email'
        ' FROM users WHERE users.id = tutors.user_id'
    )
    op.alter_column('tutors', 'name', existing_type=sa.String(255), nullable=False)
    op.alter_column('tutors', 'email', existing_type=sa.String(255), nullable=False)
    op.create_unique_constraint(TUTOR_EMAIL_UNIQUE_BEFORE, 'tutors', ['email'])

    op.add_column('users', sa.Column('tutor_id', sa.UUID(), nullable=True))
    op.create_foreign_key(TUTOR_FK_BEFORE, 'users', 'tutors', ['tutor_id'], ['id'])
    op.execute(
        'UPDATE users SET tutor_id = tutors.id FROM tutors WHERE tutors.user_id = users.id'
    )
    op.drop_constraint(USER_FK, 'tutors', type_='foreignkey')
    op.drop_constraint(USER_UNIQUE, 'tutors', type_='unique')
    op.drop_column('tutors', 'user_id')
    # After the name and email are back on the profile, which is all the old schema keeps of
    # a person who cannot sign in, and after the profile no longer references the user.
    op.execute('DELETE FROM users WHERE hashed_password IS NULL')

    op.alter_column('users', 'name', new_column_name='display_name')
    op.alter_column('users', 'name_is_default', new_column_name='display_name_is_default')
    op.alter_column('users', 'hashed_password', existing_type=sa.String(255), nullable=False)


def _abort_on_duplicate_links() -> None:
    rows = op.get_bind().execute(sa.text(DUPLICATE_LINKS)).all()

    if rows:
        listed = '; '.join(
            f'tutor {row.tutor_id}: users {", ".join(str(user_id) for user_id in row.user_ids)}'
            for row in rows
        )
        raise RuntimeError(
            f'0030 refused: more than one user links to the same tutors row ({listed}).'
            ' Decide which user owns each profile and unlink the others, then rerun.'
        )
