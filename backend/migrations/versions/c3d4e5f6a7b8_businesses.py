"""businesses

Slice (c) of the Firestore -> Supabase migration: the parent `businesses`
collection moves to Postgres. Every child collection (agent_runs, observations,
opportunities, actions, executions, measurements, learnings, connections,
gtm_runs) STAYS on Firestore this slice, addressed by the business id string.

Assumes the pgcrypto (gen_random_uuid) extension is already enabled on the
database (CI enables it before `flask db upgrade`, matching the earlier slices).

Revision ID: c3d4e5f6a7b8
Revises: b7f2a9c1d3e4
Create Date: 2026-10-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'b7f2a9c1d3e4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'businesses',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('website_url', sa.Text(), nullable=True),
        sa.Column('industry', sa.Text(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_businesses_owner_id', 'businesses', ['owner_id'], unique=False
    )
    # Partial UNIQUE: at most one business per (owner, website_url) when a
    # website_url is actually set. Empty/NULL urls are exempt so name-only
    # businesses created during onboarding are never blocked. This is the race
    # backstop behind the pre-insert SELECT in create_business.
    op.create_index(
        'uq_businesses_owner_website',
        'businesses',
        ['owner_id', 'website_url'],
        unique=True,
        postgresql_where=sa.text("website_url IS NOT NULL AND website_url <> ''"),
    )


def downgrade():
    op.drop_index('uq_businesses_owner_website', table_name='businesses')
    op.drop_index('ix_businesses_owner_id', table_name='businesses')
    op.drop_table('businesses')
