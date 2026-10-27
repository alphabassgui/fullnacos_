"""SQLAlchemy models for the Postgres (Supabase) migration.

Slice (b) moves users, their sessions, and security logs off Firestore. Every
other collection stays on Firestore for now. These map to the `users`,
`user_sessions`, and `security_logs` tables created by the Alembic revision
chained onto the Supabase-foundation baseline.
"""

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
