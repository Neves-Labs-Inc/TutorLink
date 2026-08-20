"""exception approval status

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-16 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0008'
down_revision: str | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXCEPTION_STATUS_VALUES = ("pending", "approved", "rejected")

# Created and dropped by hand, exactly as 0001 does for `user_role` and `booking_status`.
# `create_type=False` on the shared enum object in app/models/enums.py is what hands both
# halves of that job to this file: a native PostgreSQL enum outlives the table that used it,
# so a type left implicit here would survive `alembic downgrade base` and break the next
# upgrade with "type exception_status already exists".
exception_status = postgresql.ENUM(
    *EXCEPTION_STATUS_VALUES, name="exception_status", create_type=False
)


def upgrade() -> None:
    op.execute("CREATE TYPE exception_status AS ENUM ('pending', 'approved', 'rejected')")

    # NOT NULL needs a backfill value, and `approved` is the only one that preserves meaning.
    # Every existing row was entered by an admin under the old admin-managed workflow and
    # already blocks bookings today; backfilling `pending` would silently unblock every
    # historical time-off entry the moment this migration ran, and start booking tutors who
    # are genuinely away. `rejected` would do the same and additionally assert a decision
    # nobody made. The server default is kept on the column rather than dropped after the
    # backfill so that an insert from anything that has not learned about `status` — a
    # console fix, an older deploy mid-rollout — still lands as blocking rather than inert.
    op.add_column(
        'tutor_availability_exceptions',
        sa.Column(
            'status',
            exception_status,
            nullable=False,
            server_default=sa.text("'approved'"),
        ),
    )


def downgrade() -> None:
    # This direction loses the distinction: a pending request and a rejected one both come
    # back as ordinary exceptions that block bookings. That over-blocks — it hides a tutor
    # who is in fact available — which is the same trade 0007 makes in its own downgrade, and
    # the safe direction of the error: it never books someone who said no.
    op.drop_column('tutor_availability_exceptions', 'status')
    op.execute("DROP TYPE exception_status")
