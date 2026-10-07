"""levels, Evaluated, language, reminders, Display name and settings

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-05 00:00:00.000000

Every plain schema change for subject levels, evaluation, Guardian language, weekly reminders,
Display names and system-message kinds. The two enum values this feature needs (`manager`,
`system`) land in 0022 and 0023 on their own, and 0024 adds the CHECKs that use `system`.

New categorical columns are VARCHAR with a named CHECK rather than native enums: a native enum
can neither drop a value nor use a new one in the transaction that added it.

`users.display_name` is backfilled before it becomes NOT NULL: a tutor account takes its
tutor's name, everyone else the local part of their email. After this it is independent of
`tutors.name`; nothing keeps the two in step.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0021'
down_revision: str | None = '0020'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than read from the models: a migration records the schema at one point in
# history, and the model constants may grow.
GRADE_RANGE = 'BETWEEN 0 AND 12'
LANGUAGE_VALUES = ('en', 'es')
CONSENT_ACTIONS = ('opt_in', 'opt_out')
CONSENT_SOURCES = ('intake', 'message', 'staff', 'system')
REMINDER_STATUSES = ('sent', 'delivered', 'read', 'failed', 'undeliverable', 'skipped')
SKIP_REASONS = ('takeover', 'template_not_approved')
SYSTEM_KINDS = (
    'takeover_notice',
    'transfer_notice',
    'handback_notice',
    'booking_reminder',
    'consent_notice',
)

# The send schedule and business clock are admin-tunable. The template ids are developer-only
# because they come from the Twilio console, and blank means "not approved yet": reminders stay
# paused until a developer fills them in.
SEED_SETTINGS = (
    ('reminder_weekday', '7', 'integer', False),
    ('reminder_hour', '18', 'integer', False),
    ('business_timezone', 'America/New_York', 'string', False),
    ('reminder_template_sid_en', '', 'string', True),
    ('reminder_template_sid_es', '', 'string', True),
    ('takeover_template_sid_en', '', 'string', True),
    ('takeover_template_sid_es', '', 'string', True),
)

system_settings = sa.table(
    'system_settings',
    sa.column('key', sa.String),
    sa.column('value', sa.Text),
    sa.column('value_type', sa.String),
    sa.column('is_developer_only', sa.Boolean),
)


def _in(column: str, values: Sequence[str]) -> str:
    listed = ', '.join(f"'{value}'" for value in values)

    return f'{column} IN ({listed})'


def upgrade() -> None:
    # Before 0021 the API bounded grades from below only, so rows past 12 may exist and would
    # abort the CHECKs below. A tutor ceiling past 12 already meant "every grade", so it clamps
    # to 12; a child grade outside K-12 has no meaning, so it becomes unset, which the bot and
    # the dashboard already handle.
    op.execute(
        'UPDATE tutor_subjects SET max_grade_level = LEAST(GREATEST(max_grade_level, 0), 12)'
        ' WHERE max_grade_level NOT BETWEEN 0 AND 12'
    )
    op.execute('UPDATE children SET grade_level = NULL WHERE grade_level NOT BETWEEN 0 AND 12')
    op.create_check_constraint(
        'ck_children_grade_level_range', 'children', f'grade_level {GRADE_RANGE}'
    )
    op.add_column('children', sa.Column('evaluated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'children',
        sa.Column('evaluated_by_user_id', sa.UUID(), sa.ForeignKey('users.id'), nullable=True),
    )
    op.create_check_constraint(
        'ck_children_evaluated_pair',
        'children',
        '(evaluated_at IS NULL) = (evaluated_by_user_id IS NULL)',
    )

    op.create_table(
        'child_subject_levels',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column(
            'child_id', sa.UUID(), sa.ForeignKey('children.id', ondelete='CASCADE'), nullable=False
        ),
        sa.Column('subject_id', sa.UUID(), sa.ForeignKey('subjects.id'), nullable=False),
        sa.Column('level', sa.SmallInteger(), nullable=False),
        sa.Column('set_by_user_id', sa.UUID(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('child_id', 'subject_id', name='uq_child_subject_levels_child_subject'),
        sa.CheckConstraint(f'level {GRADE_RANGE}', name='ck_child_subject_levels_level_range'),
    )

    op.create_check_constraint(
        'ck_tutor_subjects_max_grade_level_range',
        'tutor_subjects',
        f'max_grade_level {GRADE_RANGE}',
    )

    op.add_column('conversations', sa.Column('language', sa.String(length=2), nullable=True))
    op.create_check_constraint(
        'ck_conversations_language', 'conversations', _in('language', LANGUAGE_VALUES)
    )

    op.create_table(
        'reminder_consents',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('guardian_id', sa.UUID(), sa.ForeignKey('guardians.id'), nullable=False),
        sa.Column('action', sa.String(length=16), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column(
            'message_id',
            sa.UUID(),
            sa.ForeignKey('messages.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('set_by_user_id', sa.UUID(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(_in('action', CONSENT_ACTIONS), name='ck_reminder_consents_action'),
        sa.CheckConstraint(_in('source', CONSENT_SOURCES), name='ck_reminder_consents_source'),
    )
    op.create_index(
        'ix_reminder_consents_guardian_id_created_at',
        'reminder_consents',
        ['guardian_id', 'created_at'],
    )

    op.create_table(
        'booking_reminders',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('guardian_id', sa.UUID(), sa.ForeignKey('guardians.id'), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('language', sa.String(length=2), nullable=False),
        sa.Column('child_ids', postgresql.ARRAY(sa.UUID()), nullable=False),
        sa.Column('template_name', sa.String(length=64), nullable=True),
        sa.Column('twilio_sid', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('skip_reason', sa.String(length=32), nullable=True),
        sa.Column('error_code', sa.String(length=32), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('twilio_sid', name='booking_reminders_twilio_sid_key'),
        sa.UniqueConstraint('guardian_id', 'week_start', name='uq_booking_reminders_guardian_week'),
        sa.CheckConstraint(_in('language', LANGUAGE_VALUES), name='ck_booking_reminders_language'),
        sa.CheckConstraint(_in('status', REMINDER_STATUSES), name='ck_booking_reminders_status'),
        sa.CheckConstraint(
            _in('skip_reason', SKIP_REASONS), name='ck_booking_reminders_skip_reason'
        ),
        sa.CheckConstraint(
            "(status = 'skipped') = (skip_reason IS NOT NULL)",
            name='ck_booking_reminders_skip_pair',
        ),
    )

    op.add_column('users', sa.Column('display_name', sa.String(length=255), nullable=True))
    op.execute(
        'UPDATE users SET display_name = tutors.name FROM tutors'
        " WHERE users.tutor_id = tutors.id AND users.role = 'tutor'"
    )
    op.execute(
        "UPDATE users SET display_name = split_part(email, '@', 1) WHERE display_name IS NULL"
    )
    op.alter_column('users', 'display_name', existing_type=sa.String(length=255), nullable=False)

    op.add_column('subjects', sa.Column('name_es', sa.String(length=128), nullable=True))

    op.add_column('messages', sa.Column('system_kind', sa.String(length=32), nullable=True))
    op.create_check_constraint(
        'ck_messages_system_kind', 'messages', _in('system_kind', SYSTEM_KINDS)
    )

    op.bulk_insert(
        system_settings,
        [
            {
                'key': key,
                'value': value,
                'value_type': value_type,
                'is_developer_only': developer_only,
            }
            for key, value, value_type, developer_only in SEED_SETTINGS
        ],
    )


def downgrade() -> None:
    # Deletes exactly these keys, never the whole table: earlier migrations' rows live here too.
    op.execute(
        system_settings.delete().where(
            system_settings.c.key.in_([key for key, _value, _type, _flag in SEED_SETTINGS])
        )
    )

    op.drop_constraint('ck_messages_system_kind', 'messages', type_='check')
    op.drop_column('messages', 'system_kind')
    op.drop_column('subjects', 'name_es')
    op.drop_column('users', 'display_name')
    op.drop_table('booking_reminders')
    op.drop_index('ix_reminder_consents_guardian_id_created_at', table_name='reminder_consents')
    op.drop_table('reminder_consents')
    op.drop_constraint('ck_conversations_language', 'conversations', type_='check')
    op.drop_column('conversations', 'language')
    op.drop_constraint('ck_tutor_subjects_max_grade_level_range', 'tutor_subjects', type_='check')
    op.drop_table('child_subject_levels')
    op.drop_constraint('ck_children_evaluated_pair', 'children', type_='check')
    op.drop_column('children', 'evaluated_by_user_id')
    op.drop_column('children', 'evaluated_at')
    op.drop_constraint('ck_children_grade_level_range', 'children', type_='check')
