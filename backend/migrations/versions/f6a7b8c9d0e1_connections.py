"""connections — OAuth token store

Slice (e) of the Firestore -> Supabase migration: the `connections` subcollection
moves to Postgres.  One wide table with nullable provider-specific columns mirrors
the Firestore shape exactly.  Multiple rows per (business_id, provider) are
allowed; the service layer selects the most-recently-updated 'connected' row.

Fresh-start: empty table, no backfill (mirrors every prior slice).

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'connections',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider',     sa.Text(), nullable=False),
        sa.Column('status',       sa.Text(), nullable=False),
        sa.Column('access_token', sa.Text(), nullable=False),
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
        # GitHub-only
        sa.Column('account_id',     sa.Text(), nullable=True),
        sa.Column('repository',     sa.Text(), nullable=True),
        sa.Column('default_branch', sa.Text(), nullable=True),
        # GSC-only
        sa.Column('refresh_token',    sa.Text(),              nullable=True),
        sa.Column('token_uri',        sa.Text(),              nullable=True),
        sa.Column('granted_scopes',   postgresql.JSONB(),     nullable=True),
        sa.Column('properties_count', sa.Integer(),           nullable=True),
        sa.Column('site_id',          sa.Text(),              nullable=True),
        sa.Column('token_expires_at', sa.Text(),              nullable=True),
        # Instagram-only
        sa.Column('username',   sa.Text(),    nullable=True),
        sa.Column('expires_in', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_connections_business_id', 'connections', ['business_id'], unique=False
    )


def downgrade():
    op.drop_index('ix_connections_business_id', table_name='connections')
    op.drop_table('connections')
