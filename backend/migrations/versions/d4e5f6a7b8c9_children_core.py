"""children core pipeline collections

PR d-core of the Firestore -> Supabase migration: the 7 COUPLED pipeline child
collections move to Postgres as one unit — agent_runs, observations,
opportunities, actions, executions, measurements, learnings. They move together
because analyze_business_website writes agent_runs -> observations ->
opportunities -> actions in one invocation and the approve->execute path chains
actions -> executions -> measurements -> learnings; `actions` is shared, so no
cut leaves a single function spanning two stores.

gtm_runs (PR d-gtm) and connections (slice e) STAY on Firestore. Fresh-start:
empty tables, no backfill (mirrors the slice-c businesses migration).

The #48 idempotency guarantees are preserved here as DB constraints (stronger
than the app-level guards they back):
  - opportunities: partial UNIQUE (business_id, type, problem_key) for new
    opportunities (NULL problem_key exempt; the text-fallback dedupe stays in app).
  - actions: partial UNIQUE (opportunity_id) while an action is live
    (pending_approval/approved/running); NULL opportunity_id (dry-run/test) exempt.
  - learnings: partial UNIQUE (business_id, measurement_id) for
    measurement-derived learnings (NULL measurement_id exempt).

Assumes pgcrypto (gen_random_uuid) is already enabled (CI enables it before
`flask db upgrade`, matching the earlier slices).

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def _pk_uuid(name='id'):
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        server_default=sa.text('gen_random_uuid()'),
        nullable=False,
    )


def _created_at():
    return sa.Column(
        'created_at',
        sa.DateTime(timezone=True),
        server_default=sa.text('now()'),
        nullable=False,
    )


def upgrade():
    # agent_runs -------------------------------------------------------------
    op.create_table(
        'agent_runs',
        _pk_uuid(),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('type', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), nullable=True),
        sa.Column('analysis_status', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('task_id', sa.Text(), nullable=True),
        sa.Column('analysis_task_id', sa.Text(), nullable=True),
        sa.Column('observation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('actions_created', sa.Integer(), nullable=True),
        sa.Column('actions_existing', sa.Integer(), nullable=True),
        sa.Column('opportunity_ids', postgresql.JSONB(), nullable=True),
        _created_at(),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cycle_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_agent_runs_business_id', 'agent_runs', ['business_id'], unique=False
    )

    # observations -----------------------------------------------------------
    # PK = run_id (the deterministic Firestore doc id), also FK to agent_runs:
    # an acks_late redelivery overwrites the same row instead of duplicating it.
    op.create_table(
        'observations',
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('final_url', sa.Text(), nullable=True),
        sa.Column('analysis_status', sa.Text(), nullable=True),
        sa.Column('analysis', postgresql.JSONB(), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(
            ['run_id'], ['agent_runs.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('run_id'),
    )
    op.create_index(
        'ix_observations_business_id', 'observations', ['business_id'], unique=False
    )

    # opportunities ----------------------------------------------------------
    op.create_table(
        'opportunities',
        _pk_uuid(),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('problem_key', sa.Text(), nullable=True),
        sa.Column('problem', sa.Text(), nullable=True),
        sa.Column('potential_impact', sa.Text(), nullable=True),
        sa.Column('confidence', sa.Numeric(), nullable=True),
        sa.Column('type', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), nullable=True),
        sa.Column('evidence', postgresql.JSONB(), nullable=True),
        _created_at(),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_opportunities_business_id', 'opportunities', ['business_id'],
        unique=False,
    )
    # Partial UNIQUE backstop for the #48 new-opportunity dedupe. NULL
    # problem_key rows are exempt; those are deduped by the text-fallback in
    # find_existing_opportunity (app logic a constraint cannot express).
    op.create_index(
        'uq_opportunities_business_type_problemkey',
        'opportunities',
        ['business_id', 'type', 'problem_key'],
        unique=True,
        postgresql_where=sa.text('problem_key IS NOT NULL'),
    )

    # actions ----------------------------------------------------------------
    op.create_table(
        'actions',
        _pk_uuid(),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('opportunity_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('action_title', sa.Text(), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('action_type', sa.Text(), nullable=True),
        sa.Column('objective', sa.Text(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('reasoning', sa.Text(), nullable=True),
        sa.Column('expected_outcome', sa.Text(), nullable=True),
        sa.Column('required_inputs', postgresql.JSONB(), nullable=True),
        sa.Column('requires_approval', sa.Boolean(), nullable=True),
        sa.Column('status', sa.Text(), nullable=True),
        sa.Column('content_type', sa.Text(), nullable=True),
        sa.Column('page_url', sa.Text(), nullable=True),
        sa.Column('content', postgresql.JSONB(), nullable=True),
        sa.Column('target_path', sa.Text(), nullable=True),
        sa.Column('execution_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('rejected_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        _created_at(),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['opportunity_id'], ['opportunities.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_actions_business_id', 'actions', ['business_id'], unique=False
    )
    # Partial UNIQUE backstop for the #48 one-live-action-per-opportunity
    # dedupe. NULL opportunity_id rows (dry-run/test actions) are distinct and
    # never collide. Terminal states (completed/failed/rejected) fall out of the
    # predicate so a replacement action may be created later.
    op.create_index(
        'uq_actions_opportunity_live',
        'actions',
        ['opportunity_id'],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending_approval', 'approved', 'running')"
        ),
    )

    # executions -------------------------------------------------------------
    op.create_table(
        'executions',
        _pk_uuid(),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('action_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('status', sa.Text(), nullable=True),
        sa.Column('task_id', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('result', postgresql.JSONB(), nullable=True),
        _created_at(),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_executions_business_id', 'executions', ['business_id'], unique=False
    )
    op.create_index(
        'ix_executions_action_id', 'executions', ['action_id'], unique=False
    )

    # measurements -----------------------------------------------------------
    op.create_table(
        'measurements',
        _pk_uuid(),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('execution_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('action_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('metric', sa.Text(), nullable=True),
        sa.Column('value', sa.Numeric(), nullable=True),
        sa.Column('previous_value', sa.Numeric(), nullable=True),
        sa.Column('source', sa.Text(), nullable=True),
        sa.Column('measured_at', sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['execution_id'], ['executions.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_measurements_business_id', 'measurements', ['business_id'],
        unique=False,
    )
    op.create_index(
        'ix_measurements_execution_id', 'measurements', ['execution_id'],
        unique=False,
    )

    # learnings --------------------------------------------------------------
    op.create_table(
        'learnings',
        _pk_uuid(),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('execution_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('action_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('action_type', sa.Text(), nullable=True),
        sa.Column('measurement_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('learning_type', sa.Text(), nullable=True),
        sa.Column('metric', sa.Text(), nullable=True),
        sa.Column('previous_value', sa.Numeric(), nullable=True),
        sa.Column('value', sa.Numeric(), nullable=True),
        sa.Column('direction', sa.Text(), nullable=True),
        sa.Column('observation', sa.Text(), nullable=True),
        sa.Column('outcome', sa.Text(), nullable=True),
        sa.Column('learning', sa.Text(), nullable=True),
        sa.Column('confidence', sa.Numeric(), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(
            ['business_id'], ['businesses.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['execution_id'], ['executions.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_learnings_business_id', 'learnings', ['business_id'], unique=False
    )
    op.create_index(
        'ix_learnings_execution_id', 'learnings', ['execution_id'], unique=False
    )
    # Partial UNIQUE backstop for the #48 one-learning-per-measurement
    # idempotency (the Firestore doc(measurement_id) + transactional
    # create-if-absent). NULL measurement_id rows are exempt.
    op.create_index(
        'uq_learnings_business_measurement',
        'learnings',
        ['business_id', 'measurement_id'],
        unique=True,
        postgresql_where=sa.text('measurement_id IS NOT NULL'),
    )


def downgrade():
    op.drop_index('uq_learnings_business_measurement', table_name='learnings')
    op.drop_index('ix_learnings_execution_id', table_name='learnings')
    op.drop_index('ix_learnings_business_id', table_name='learnings')
    op.drop_table('learnings')

    op.drop_index('ix_measurements_execution_id', table_name='measurements')
    op.drop_index('ix_measurements_business_id', table_name='measurements')
    op.drop_table('measurements')

    op.drop_index('ix_executions_action_id', table_name='executions')
    op.drop_index('ix_executions_business_id', table_name='executions')
    op.drop_table('executions')

    op.drop_index('uq_actions_opportunity_live', table_name='actions')
    op.drop_index('ix_actions_business_id', table_name='actions')
    op.drop_table('actions')

    op.drop_index(
        'uq_opportunities_business_type_problemkey', table_name='opportunities'
    )
    op.drop_index('ix_opportunities_business_id', table_name='opportunities')
    op.drop_table('opportunities')

    op.drop_index('ix_observations_business_id', table_name='observations')
    op.drop_table('observations')

    op.drop_index('ix_agent_runs_business_id', table_name='agent_runs')
    op.drop_table('agent_runs')
