"""SQLAlchemy models for the Postgres (Supabase) migration.

Slice (b) moves users, their sessions, and security logs off Firestore. Slice
(c) moves the parent `businesses` collection; every child collection
(agent_runs, opportunities, actions, ...) STAYS on Firestore for now, addressed
by the business id string. These map to the `users`, `user_sessions`,
`security_logs` and `businesses` tables created by the Alembic revisions chained
onto the Supabase-foundation baseline.
"""

import uuid as _uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import CITEXT, UUID

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
