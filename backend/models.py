"""SQLAlchemy models for the Postgres (Supabase) migration.

Slice (b) moves users, their sessions, and security logs off Firestore. Slice
(c) moves the parent `businesses` collection; every child collection
(agent_runs, opportunities, actions, ...) STAYS on Firestore for now, addressed
by the business id string. These map to the `users`, `user_sessions`,
`security_logs` and `businesses` tables created by the Alembic revisions chained
onto the Supabase-foundation baseline.
"""

import uuid as _uuid
from decimal import Decimal as _Decimal

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import CITEXT, JSONB, UUID

from extensions import db


class User(db.Model):
    __tablename__ = "users"

    # Fresh-start: no legacy Firebase uid to preserve, so the PK is a
    # DB-generated UUID (pgcrypto's gen_random_uuid()).
    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=db.text("gen_random_uuid()"),
    )
    # citext so uniqueness/lookups are case-insensitive; emails are also
    # lowercased by the routes before they reach here.
    email = db.Column(CITEXT(), unique=True, nullable=False)
    username = db.Column(db.Text)
    role = db.Column(db.Text, nullable=False, server_default="user")
    password_hash = db.Column(db.Text)
    bound_device_id = db.Column(db.Text)
    subscription_status = db.Column(
        db.Boolean, nullable=False, server_default=db.text("false")
    )
    subscription_expiry = db.Column(db.DateTime(timezone=True))
    status = db.Column(db.Text, nullable=False, server_default="Active")
    has_completed_tour = db.Column(
        db.Boolean, nullable=False, server_default=db.text("false")
    )
    has_completed_onboarding = db.Column(
        db.Boolean, nullable=False, server_default=db.text("false")
    )
    last_ip = db.Column(db.Text)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    last_login = db.Column(db.DateTime(timezone=True))

    # passive_deletes lets the DB-level ON DELETE CASCADE remove children when
    # the user row is deleted, rather than SQLAlchemy emitting per-row DELETEs.
    sessions = db.relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    security_logs = db.relationship(
        "SecurityLog",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    businesses = db.relationship(
        "Business",
        back_populates="owner",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class UserSession(db.Model):
    __tablename__ = "user_sessions"

    # One row per logged-in device. The token is the high-entropy
    # secrets.token_hex(64) value; being the PK gives an indexed exact-match
    # lookup for the login_required EXISTS check. Multi-device: a login INSERTs
    # a row and never touches the others; logout DELETEs only its own row.
    token = db.Column(db.Text, primary_key=True)
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id = db.Column(db.Text)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )

    user = db.relationship("User", back_populates="sessions")


class SecurityLog(db.Model):
    __tablename__ = "security_logs"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=db.text("gen_random_uuid()"),
    )
    type = db.Column(db.Text)
    device_id = db.Column(db.Text)
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    ip = db.Column(db.Text)
    timestamp = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )

    user = db.relationship("User", back_populates="security_logs")


class Business(db.Model):
    __tablename__ = "businesses"

    # Slice (c): the business id was a Firestore auto-id; it is now a DB-generated
    # UUID. That UUID, serialized with str(), becomes the Firestore subcollection
    # path segment for every child (agent_runs, opportunities, ...), which STAY on
    # Firestore this slice.
    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=db.text("gen_random_uuid()"),
    )
    owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = db.Column(db.Text, nullable=False)
    website_url = db.Column(db.Text)
    industry = db.Column(db.Text)
    description = db.Column(db.Text)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )

    owner = db.relationship("User", back_populates="businesses")

    # Partial UNIQUE mirroring the create_business dedupe: at most one business
    # per (owner, website_url) when a website_url is actually set. Empty/NULL
    # website_url is exempt so name-only businesses are never blocked. This is the
    # race backstop behind the pre-insert SELECT in create_business.
    __table_args__ = (
        Index(
            "uq_businesses_owner_website",
            "owner_id",
            "website_url",
            unique=True,
            postgresql_where=text("website_url IS NOT NULL AND website_url <> ''"),
        ),
    )


class AgentRun(db.Model):
    """PR d-core: the `agent_runs` pipeline child. One row per analysis cycle.
    The id was a Firestore auto-id used as the subcollection path segment; it is
    now a DB-generated UUID and is also the PK that `observations.run_id`
    references (one observation per run)."""

    __tablename__ = "agent_runs"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id = db.Column(UUID(as_uuid=True))
    type = db.Column(db.Text)
    status = db.Column(db.Text)
    analysis_status = db.Column(db.Text)
    error = db.Column(db.Text)
    task_id = db.Column(db.Text)
    analysis_task_id = db.Column(db.Text)
    observation_id = db.Column(UUID(as_uuid=True))
    actions_created = db.Column(db.Integer)
    actions_existing = db.Column(db.Integer)
    opportunity_ids = db.Column(JSONB)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    started_at = db.Column(db.DateTime(timezone=True))
    cycle_started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))
    failed_at = db.Column(db.DateTime(timezone=True))
    updated_at = db.Column(db.DateTime(timezone=True))


class Observation(db.Model):
    """PR d-core: the `observations` child. The Firestore doc id was the run_id
    (deterministic, so an acks_late redelivery overwrites the same row); that is
    preserved here as the PK which is also the FK to agent_runs(id)."""

    __tablename__ = "observations"

    run_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("agent_runs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id = db.Column(UUID(as_uuid=True))
    source_url = db.Column(db.Text)
    final_url = db.Column(db.Text)
    analysis_status = db.Column(db.Text)
    analysis = db.Column(JSONB)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )


class Opportunity(db.Model):
    """PR d-core: the `opportunities` child. Partial UNIQUE
    (business_id, type, problem_key) WHERE problem_key IS NOT NULL backstops the
    #48 dedupe for new opportunities; the NULL-problem_key text-fallback dedupe
    stays in find_existing_opportunity (app logic the constraint can't express)."""

    __tablename__ = "opportunities"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id = db.Column(UUID(as_uuid=True))
    title = db.Column(db.Text)
    description = db.Column(db.Text)
    problem_key = db.Column(db.Text)
    problem = db.Column(db.Text)
    potential_impact = db.Column(db.Text)
    confidence = db.Column(db.Numeric)
    type = db.Column(db.Text)
    status = db.Column(db.Text)
    evidence = db.Column(JSONB)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    updated_at = db.Column(db.DateTime(timezone=True))

    __table_args__ = (
        Index(
            "uq_opportunities_business_type_problemkey",
            "business_id",
            "type",
            "problem_key",
            unique=True,
            postgresql_where=text("problem_key IS NOT NULL"),
        ),
    )


class Action(db.Model):
    """PR d-core: the `actions` child — the hub shared by analyze (writes it) and
    approve/execute (chains it to executions). Most columns are NULLABLE and there
    is a separate `title` column because dev/scaffolding routes
    (create_dry_run_action, create_test_approval_action) write a sparser shape
    with no opportunity_id. Partial UNIQUE (opportunity_id) WHERE status IN the 3
    live states backstops the #48 one-live-action-per-opportunity dedupe; NULL
    opportunity_id rows (dry-run/test) are distinct and never collide."""

    __tablename__ = "actions"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id = db.Column(UUID(as_uuid=True))
    opportunity_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("opportunities.id", ondelete="CASCADE"),
    )
    action_title = db.Column(db.Text)
    title = db.Column(db.Text)
    action_type = db.Column(db.Text)
    objective = db.Column(db.Text)
    description = db.Column(db.Text)
    reasoning = db.Column(db.Text)
    expected_outcome = db.Column(db.Text)
    required_inputs = db.Column(JSONB)
    requires_approval = db.Column(db.Boolean)
    status = db.Column(db.Text)
    content_type = db.Column(db.Text)
    page_url = db.Column(db.Text)
    content = db.Column(JSONB)
    target_path = db.Column(db.Text)
    execution_id = db.Column(UUID(as_uuid=True))
    approved_by = db.Column(UUID(as_uuid=True))
    rejected_by = db.Column(UUID(as_uuid=True))
    error = db.Column(db.Text)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    updated_at = db.Column(db.DateTime(timezone=True))
    approved_at = db.Column(db.DateTime(timezone=True))
    rejected_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))

    __table_args__ = (
        Index(
            "uq_actions_opportunity_live",
            "opportunity_id",
            unique=True,
            postgresql_where=text(
                "status IN ('pending_approval', 'approved', 'running')"
            ),
        ),
    )


class Execution(db.Model):
    """PR d-core: the `executions` child. Created at approve time (status
    'queued'), driven to running/completed/failed by the execution engine."""

    __tablename__ = "executions"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id = db.Column(UUID(as_uuid=True))
    action_id = db.Column(UUID(as_uuid=True), index=True)
    status = db.Column(db.Text)
    task_id = db.Column(db.Text)
    error = db.Column(db.Text)
    result = db.Column(JSONB)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    updated_at = db.Column(db.DateTime(timezone=True))
    started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))


class Measurement(db.Model):
    """PR d-core: the `measurements` child. Recorded by the execution engine on a
    completed execution; drives learning generation."""

    __tablename__ = "measurements"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    execution_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("executions.id", ondelete="CASCADE"),
        index=True,
    )
    action_id = db.Column(UUID(as_uuid=True))
    metric = db.Column(db.Text)
    value = db.Column(db.Numeric)
    previous_value = db.Column(db.Numeric)
    source = db.Column(db.Text)
    measured_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )


class Learning(db.Model):
    """PR d-core: the `learnings` child. Partial UNIQUE (business_id,
    measurement_id) WHERE measurement_id IS NOT NULL backstops the #48
    one-learning-per-measurement idempotency (the Firestore doc(measurement_id)
    + @firestore.transactional create-if-absent)."""

    __tablename__ = "learnings"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    execution_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("executions.id", ondelete="CASCADE"),
        index=True,
    )
    action_id = db.Column(UUID(as_uuid=True))
    action_type = db.Column(db.Text)
    measurement_id = db.Column(UUID(as_uuid=True))
    learning_type = db.Column(db.Text)
    metric = db.Column(db.Text)
    previous_value = db.Column(db.Numeric)
    value = db.Column(db.Numeric)
    direction = db.Column(db.Text)
    observation = db.Column(db.Text)
    outcome = db.Column(db.Text)
    learning = db.Column(db.Text)
    confidence = db.Column(db.Numeric)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )

    __table_args__ = (
        Index(
            "uq_learnings_business_measurement",
            "business_id",
            "measurement_id",
            unique=True,
            postgresql_where=text("measurement_id IS NOT NULL"),
        ),
    )


class GtmRun(db.Model):
    """PR d-gtm: the `gtm_runs` pipeline child. One row per Visual GTM analysis
    run. The id was a Firestore auto-id; it is now a DB-generated UUID. The user
    is stored as `owner_id` (d-core convention) but serialized as `"user_id"` to
    preserve the byte-identical Firestore response contract."""

    __tablename__ = "gtm_runs"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id = db.Column(UUID(as_uuid=True))
    website_url = db.Column(db.Text)
    status = db.Column(db.Text)
    celery_task_id = db.Column(db.Text)
    gtm_scores = db.Column(JSONB)
    blind_spots = db.Column(JSONB)
    competitors_analyzed = db.Column(JSONB)
    user_manifest = db.Column(JSONB)
    opportunities_created_count = db.Column(db.Integer)
    dossier_path = db.Column(db.Text)
    error = db.Column(db.Text)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))


class Connection(db.Model):
    """Slice (e): the `connections` Firestore subcollection moves to Postgres.
    One row per OAuth connection (GitHub / Google Search Console / Instagram).
    Multiple rows per (business_id, provider) are allowed; get_connection picks
    the most-recently-updated 'connected' row (ORDER BY updated_at DESC LIMIT 1).
    Provider-specific columns are nullable — one wide table mirrors the Firestore
    shape exactly."""

    __tablename__ = "connections"

    id = db.Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider     = db.Column(db.Text, nullable=False)
    status       = db.Column(db.Text, nullable=False)
    access_token = db.Column(db.Text, nullable=False)   # Fernet ciphertext
    created_at   = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    updated_at   = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    # GitHub-only
    account_id     = db.Column(db.Text)
    repository     = db.Column(db.Text)
    default_branch = db.Column(db.Text)
    # GSC-only (token_uri / granted_scopes / properties_count written at connect
    # time but never exposed by get_connection — stored for completeness)
    refresh_token    = db.Column(db.Text)       # Fernet ciphertext
    token_uri        = db.Column(db.Text)
    granted_scopes   = db.Column(JSONB)         # list[str]
    properties_count = db.Column(db.Integer)
    site_id          = db.Column(db.Text)
    token_expires_at = db.Column(db.Text)       # ISO string (not DateTime)
    # Instagram-only
    username   = db.Column(db.Text)
    expires_in = db.Column(db.Integer)


def connection_to_dict(row, *, access_token, refresh_token):
    """Exact replica of the dict get_connection returned from Firestore.
    Caller decrypts tokens before passing them in.  All 10 keys are always
    present (some None), matching the pre-migration API contract."""
    return {
        "id":               str(row.id),
        "provider":         row.provider,
        "account_id":       row.account_id,
        "username":         row.username,
        "site_id":          row.site_id,
        "token_expires_at": row.token_expires_at,
        "repository":       row.repository,
        "default_branch":   row.default_branch,
        "access_token":     access_token,
        "refresh_token":    refresh_token,
    }


def _iso(value):
    """Serialize a timestamp column to the same naive-UTC ISO string the
    Firestore-era routes returned (datetime.utcnow().isoformat(), no tz offset).
    A TIMESTAMPTZ read back from Postgres is tz-aware UTC, so strip the tzinfo
    before formatting to keep the response byte-identical."""
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is not None:
        value = value.replace(tzinfo=None)
    return value.isoformat()


def business_to_dict(row):
    """The business body the API has always returned: id + the same field set the
    Firestore document carried (owner_id included), id as a string, timestamps as
    ISO strings."""
    return {
        "id": str(row.id),
        "owner_id": str(row.owner_id),
        "name": row.name,
        "website_url": row.website_url,
        "industry": row.industry,
        "description": row.description,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def get_business_row(business_id):
    """Fetch a business by id with NO owner filter — the single lookup every
    ownership guard uses. Returns the Business row or None. A malformed/non-UUID
    id returns None (so callers return the same 404 they returned when the
    Firestore doc did not exist) instead of raising. Callers compare
    str(row.owner_id) == session user_id (string vs string) for the 403."""
    try:
        _uuid.UUID(str(business_id))
    except (ValueError, TypeError, AttributeError):
        return None
    return db.session.get(Business, business_id)


def _num(value):
    """A Numeric column reads back as Decimal; mirror the JSON number shape the
    Firestore era emitted — an integral value as int (measurement value=1 stayed
    1), otherwise float. Non-Decimal values pass through unchanged."""
    if value is None:
        return None
    if isinstance(value, _Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    return value


def _float(value):
    """confidence is coerced to float at write time (create_learning), so the
    body always carried a float — emit one here too, never an int or Decimal."""
    return None if value is None else float(value)


def _str_id(value):
    """UUID -> str for an id-shaped column, preserving None (so an unset FK such
    as a dry-run action's opportunity_id stays absent/None, not 'None')."""
    return None if value is None else str(value)


def _put(body, key, value):
    """Append a key only when its value is set, mirroring Firestore's to_dict,
    which omits fields a document never had. Used for lifecycle/optional columns
    that are NULL until a state transition writes them."""
    if value is not None:
        body[key] = value


def agent_run_to_dict(row):
    body = {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "owner_id": _str_id(row.owner_id),
        "type": row.type,
        "status": row.status,
        "created_at": _iso(row.created_at),
    }
    _put(body, "analysis_status", row.analysis_status)
    _put(body, "error", row.error)
    _put(body, "task_id", row.task_id)
    _put(body, "analysis_task_id", row.analysis_task_id)
    _put(body, "observation_id", _str_id(row.observation_id))
    _put(body, "actions_created", row.actions_created)
    _put(body, "actions_existing", row.actions_existing)
    _put(body, "opportunity_ids", row.opportunity_ids)
    _put(body, "started_at", _iso(row.started_at))
    _put(body, "cycle_started_at", _iso(row.cycle_started_at))
    _put(body, "completed_at", _iso(row.completed_at))
    _put(body, "updated_at", _iso(row.updated_at))
    return body


def observation_to_dict(row):
    return {
        "id": str(row.run_id),
        "business_id": str(row.business_id),
        "owner_id": _str_id(row.owner_id),
        "source_url": row.source_url,
        "final_url": row.final_url,
        "analysis": row.analysis,
        "analysis_status": row.analysis_status,
        "created_at": _iso(row.created_at),
    }


def opportunity_to_dict(row):
    return {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "owner_id": _str_id(row.owner_id),
        "title": row.title,
        "description": row.description,
        "problem_key": row.problem_key,
        "problem": row.problem,
        "evidence": row.evidence,
        "potential_impact": row.potential_impact,
        "confidence": _num(row.confidence),
        "type": row.type,
        "status": row.status,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def action_to_dict(row):
    """Both pipeline actions and the sparser dev/scaffolding actions (dry-run,
    test-approval) read back through here, and each must match the Firestore doc
    it carried.

    A pipeline action (created via create_action off an opportunity) always wrote
    all four content fields — content_type/page_url/content/target_path — even
    when the decision engine left them None (validate_action requires the keys,
    values may be None), so GET returned them as null. The dev routes never wrote
    those keys at all. `opportunity_id IS NOT NULL` is the structural marker that
    tells the two apart, so the content block is emitted (null-inclusive) only for
    pipeline actions. Every other field is omitted when NULL, mirroring Firestore
    dropping fields a document never had."""
    is_pipeline = row.opportunity_id is not None

    body = {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "owner_id": _str_id(row.owner_id),
        "status": row.status,
    }
    _put(body, "opportunity_id", _str_id(row.opportunity_id))
    _put(body, "action_title", row.action_title)
    _put(body, "title", row.title)
    _put(body, "action_type", row.action_type)
    _put(body, "objective", row.objective)
    _put(body, "description", row.description)
    _put(body, "reasoning", row.reasoning)
    _put(body, "expected_outcome", row.expected_outcome)
    _put(body, "required_inputs", row.required_inputs)
    _put(body, "requires_approval", row.requires_approval)
    if is_pipeline:
        body["content_type"] = row.content_type
        body["page_url"] = row.page_url
        body["content"] = row.content
        body["target_path"] = row.target_path
    _put(body, "execution_id", _str_id(row.execution_id))
    _put(body, "approved_by", _str_id(row.approved_by))
    _put(body, "rejected_by", _str_id(row.rejected_by))
    _put(body, "error", row.error)
    _put(body, "created_at", _iso(row.created_at))
    _put(body, "updated_at", _iso(row.updated_at))
    _put(body, "approved_at", _iso(row.approved_at))
    _put(body, "rejected_at", _iso(row.rejected_at))
    _put(body, "completed_at", _iso(row.completed_at))
    return body


def execution_to_dict(row):
    body = {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "owner_id": _str_id(row.owner_id),
        "action_id": _str_id(row.action_id),
        "status": row.status,
        "created_at": _iso(row.created_at),
    }
    _put(body, "task_id", row.task_id)
    _put(body, "error", row.error)
    _put(body, "result", row.result)
    _put(body, "updated_at", _iso(row.updated_at))
    _put(body, "started_at", _iso(row.started_at))
    _put(body, "completed_at", _iso(row.completed_at))
    return body


def measurement_to_dict(row):
    return {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "execution_id": _str_id(row.execution_id),
        "action_id": _str_id(row.action_id),
        "metric": row.metric,
        "value": _num(row.value),
        "source": row.source,
        "previous_value": _num(row.previous_value),
        "measured_at": _iso(row.measured_at),
        "created_at": _iso(row.created_at),
    }


def learning_to_dict(row):
    return {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "execution_id": _str_id(row.execution_id),
        "action_id": _str_id(row.action_id),
        "action_type": row.action_type,
        "measurement_id": _str_id(row.measurement_id),
        "learning_type": row.learning_type,
        "metric": row.metric,
        "previous_value": _num(row.previous_value),
        "value": _num(row.value),
        "direction": row.direction,
        "observation": row.observation,
        "outcome": row.outcome,
        "learning": row.learning,
        "confidence": _float(row.confidence),
        "created_at": _iso(row.created_at),
    }


def gtm_run_to_dict(row):
    """Serialize a GtmRun row to the same JSON shape the Firestore-era routes
    returned. Fixed keys match the initial Firestore doc fields (always present);
    lifecycle keys are omitted when NULL via _put (matching sparse Firestore docs).
    The user is emitted as `"user_id"` (the key the Firestore doc carried)."""
    body = {
        "id": str(row.id),
        "business_id": str(row.business_id),
        "user_id": _str_id(row.owner_id),
        "status": row.status,
        "website_url": row.website_url,
        "created_at": _iso(row.created_at),
    }
    _put(body, "celery_task_id", row.celery_task_id)
    _put(body, "gtm_scores", row.gtm_scores)
    _put(body, "blind_spots", row.blind_spots)
    _put(body, "competitors_analyzed", row.competitors_analyzed)
    _put(body, "user_manifest", row.user_manifest)
    _put(body, "opportunities_created_count", row.opportunities_created_count)
    _put(body, "dossier_path", row.dossier_path)
    _put(body, "error", row.error)
    _put(body, "started_at", _iso(row.started_at))
    _put(body, "completed_at", _iso(row.completed_at))
    return body
