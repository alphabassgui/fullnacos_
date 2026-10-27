"""users, user_sessions, security_logs

Slice (b) of the Firestore -> Supabase migration: user storage moves to Postgres.
Assumes the pgcrypto (gen_random_uuid) and citext extensions are already enabled
on the database (CI enables them before `flask db upgrade`, matching the
Supabase-foundation pattern).

Revision ID: b7f2a9c1d3e4
Revises: fe9685cd6bc3
Create Date: 2026-10-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b7f2a9c1d3e4'
down_revision = 'fe9685cd6bc3'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'users',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('email', postgresql.CITEXT(), nullable=False),
        sa.Column('username', sa.Text(), nullable=True),
        sa.Column('role', sa.Text(), server_default='user', nullable=False),
        sa.Column('password_hash', sa.Text(), nullable=True),
        sa.Column('bound_device_id', sa.Text(), nullable=True),
        sa.Column(
            'subscription_status',
            sa.Boolean(),
            server_default=sa.text('false'),
            nullable=False,
        ),
        sa.Column('subscription_expiry', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.Text(), server_default='Active', nullable=False),
        sa.Column(
            'has_completed_tour',
            sa.Boolean(),
            server_default=sa.text('false'),
            nullable=False,
        ),
        sa.Column(
            'has_completed_onboarding',
            sa.Boolean(),
            server_default=sa.text('false'),
            nullable=False,
        ),
        sa.Column('last_ip', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )

    op.create_table(
        'user_sessions',
        sa.Column('token', sa.Text(), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('device_id', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('token'),
    )
    op.create_index(
        'ix_user_sessions_user_id', 'user_sessions', ['user_id'], unique=False
    )

    op.create_table(
        'security_logs',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('type', sa.Text(), nullable=True),
        sa.Column('device_id', sa.Text(), nullable=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('ip', sa.Text(), nullable=True),
        sa.Column(
            'timestamp',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_security_logs_user_id', 'security_logs', ['user_id'], unique=False
    )


def downgrade():
    op.drop_index('ix_security_logs_user_id', table_name='security_logs')
    op.drop_table('security_logs')
    op.drop_index('ix_user_sessions_user_id', table_name='user_sessions')
    op.drop_table('user_sessions')
    op.drop_table('users')
