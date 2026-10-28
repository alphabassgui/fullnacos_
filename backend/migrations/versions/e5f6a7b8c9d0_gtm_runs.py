"""gtm_runs pipeline child

PR d-gtm of the Firestore -> Supabase migration: the `gtm_runs` collection
moves to Postgres. It is the 8th (and final) pipeline child; all 7 d-core
children already live in Postgres.

Fresh-start: empty table, no backfill (mirrors every prior slice).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'gtm_runs',
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('website_url', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), nullable=True),
        sa.Column('celery_task_id', sa.Text(), nullable=True),
        sa.Column('gtm_scores', postgresql.JSONB(), nullable=True),
        sa.Column('blind_spots', postgresql.JSONB(), nullable=True),
        sa.Column('competitors_analyzed', postgresql.JSONB(), nullable=True),
        sa.Column('user_manifest', postgresql.JSONB(), nullable=True),
        sa.Column('opportunities_created_count', sa.Integer(), nullable=True),
        sa.Column('dossier_path', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_gtm_runs_business_id', 'gtm_runs', ['business_id'], unique=False
    )


def downgrade():
    op.drop_index('ix_gtm_runs_business_id', table_name='gtm_runs')
    op.drop_table('gtm_runs')
