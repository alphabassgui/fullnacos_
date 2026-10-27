import hmac
import logging
import secrets
from flask import Blueprint, render_template, request, redirect, url_for, flash, session, current_app
from firebase import db
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

from sqlalchemy.exc import IntegrityError

from extensions import db as orm_db
from models import User, UserSession, SecurityLog

from redis_helpers import (
    redis_check_registration_limit,
    redis_increment_login_attempts,
    redis_is_locked,
    redis_log_registration,
    redis_reset_login_attempts,
)

auth_bp = Blueprint("auth", __name__, template_folder="../templates")
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════
# IN-MEMORY STORES
# (swap for Redis in production for multi-worker
#  persistence across restarts)
# ══════════════════════════════════════════════
login_attempts:    dict[str, int]      = {}
locked_ips:        dict[str, datetime] = {}
registration_log:  dict[str, list]     = {}

MAX_LOGIN_ATTEMPTS       = 5
LOCKOUT_MINUTES          = 15
MAX_REGISTRATIONS_PER_HOUR = 3
RESET_TOKEN_EXPIRY_MINS  = 15


# ══════════════════════════════════════════════
# ❶  HELPERS
# ══════════════════════════════════════════════

def _get_ip(req) -> str:
    ip = req.headers.get("X-Forwarded-For", req.remote_addr) or ""
    return ip.split(",")[0].strip()


def _increment_attempts(ip: str) -> None:
    """Increment login attempts — Redis first, in-memory fallback."""
    count, is_locked, _ = redis_increment_login_attempts(ip, MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES * 60)
    if count == 0:
        # Redis unavailable — use in-memory fallback
        login_attempts[ip] = login_attempts.get(ip, 0) + 1
        if login_attempts[ip] >= MAX_LOGIN_ATTEMPTS:
            locked_ips[ip] = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)


def _reset_attempts(ip: str) -> None:
    """Clear login attempts — Redis + in-memory."""
    redis_reset_login_attempts(ip)
    login_attempts.pop(ip, None)
    locked_ips.pop(ip, None)


def _subscription_is_active(user: dict) -> bool:
    """Validates subscription status. If expiry is set, it must be in the future.
    If expiry is empty/None but status is active, subscription is still valid.
    Handles Firestore Timestamp objects, native datetime, and ISO strings."""
    if not user.get("subscription_status"):
        return False

    # Status is active — check expiry only if it exists
    expiry = user.get("subscription_expiry")
    if not expiry:
        return True  # active status with no expiry = valid

    try:
        # Firestore DatetimeWithNanoseconds / Timestamp objects
        if hasattr(expiry, "timestamp"):
            expiry_dt = datetime.utcfromtimestamp(expiry.timestamp())
        elif isinstance(expiry, datetime):
            expiry_dt = expiry.replace(tzinfo=None)
        elif isinstance(expiry, str):
            clean = expiry.replace("Z", "+00:00")
            expiry_dt = datetime.fromisoformat(clean).replace(tzinfo=None)
        else:
            return True  # can't parse expiry, but status is active
        return expiry_dt > datetime.utcnow()
    except (ValueError, TypeError, AttributeError):
        return True  # parsing failed, but status is active


def generate_login_token() -> str:
    """Generates a CSRF-style one-time token and stores it in the session."""
    token = secrets.token_hex(32)
    session["_login_csrf"] = token
    return token


def validate_login_token(token: str | None) -> bool:
    """Pops and validates the CSRF token using constant-time comparison."""
    expected = session.pop("_login_csrf", None)
    if not expected or not token:
        return False
    return hmac.compare_digest(expected, token)


def check_registration_limit(ip: str) -> bool:
    """Check registration rate limit — Redis first, in-memory fallback."""
    redis_result = redis_check_registration_limit(ip, MAX_REGISTRATIONS_PER_HOUR)
    if redis_result is not None:
        # Also check in-memory as a safety net
        now = datetime.utcnow()
        window = now - timedelta(hours=1)
        timestamps = [t for t in registration_log.get(ip, []) if t > window]
        registration_log[ip] = timestamps
        return redis_result and len(timestamps) < MAX_REGISTRATIONS_PER_HOUR
    # Redis unavailable — pure in-memory
    now = datetime.utcnow()
    window = now - timedelta(hours=1)
    timestamps = [t for t in registration_log.get(ip, []) if t > window]
    registration_log[ip] = timestamps
    return len(timestamps) < MAX_REGISTRATIONS_PER_HOUR


def log_registration(ip: str) -> None:
    redis_log_registration(ip)
    registration_log.setdefault(ip, []).append(datetime.utcnow())


def log_suspicious_device(device_id: str, user_id: str, ip: str) -> None:
    """Persists suspicious access attempts to Postgres for audit."""
    orm_db.session.add(SecurityLog(
        type="device_mismatch",
        device_id=device_id,
        user_id=user_id,
        ip=ip,
    ))
    orm_db.session.commit()


# ──────────────────────────────────────────────
# MULTI-DEVICE SESSION TOKENS
# Each login INSERTs its own row in user_sessions so any number of devices can
# stay logged in concurrently; logout DELETEs only the current device's row.
# ──────────────────────────────────────────────

def create_session(user_id: str, token: str, device_id: str | None) -> None:
    """Record a new logged-in device. The caller commits as part of the login
    transaction."""
    orm_db.session.add(UserSession(
        token=token,
        user_id=user_id,
        device_id=device_id,
    ))


def remove_session_token(token: str) -> None:
    """Revoke a single device by deleting its session row, leaving every other
    device's session intact. Best-effort — errors are logged, not raised,
    matching the existing logout behaviour."""
    if not token:
        return
    try:
        orm_db.session.query(UserSession).filter_by(token=token).delete()
        orm_db.session.commit()
    except Exception as e:
        orm_db.session.rollback()
        current_app.logger.error(f"remove_session_token error: {e}")


# ══════════════════════════════════════════════
# ❷  SESSION TOKEN GUARD  (anti-sharing core)
# ══════════════════════════════════════════════

# def login_required(f):
#     """
#     Protects routes by verifying the session token matches Firestore.
#     If another device logs in, the stored token changes → this session
#     is immediately invalidated on the next request.
#     """
#     @wraps(f)
#     def decorated(*args, **kwargs):
#         if "user_id" not in session:
#             flash("Please log in.", "warning")
#             return redirect(url_for("auth.login"))

#         user_id       = session["user_id"]
#         session_token = session.get("session_token")

#         if not user_id or not session_token:
#             session.clear()
#             flash("Please log in.", "warning")
#             return redirect(url_for("auth.login"))

#         try:
#             user_doc = db.collection("users").document(user_id).get()
#             if not user_doc.exists:
#                 session.clear()
#                 return redirect(url_for("auth.login"))

#             user = user_doc.to_dict()

#             tokens = _tokens_from_user(user)  # backward-compat with legacy single token
#             ok = bool(session_token) and any(
#                 hmac.compare_digest(t, session_token) for t in tokens
#             )
#             if not ok:
#                 session.clear()
#                 flash("Session expired. Please log in again.", "warning")
#                 return redirect(url_for("auth.login"))

#             if user.get("status") == "Disabled":
#                 session.clear()
#                 flash("Account disabled. Contact support.", "danger")
#                 return redirect(url_for("auth.login"))

#         except Exception as e:
#             current_app.logger.error(f"Session guard error: {e}")
#             session.clear()
#             return redirect(url_for("auth.login"))

#         return f(*args, **kwargs)
#     return decorated


# ══════════════════════════════════════════════
# ❸  HOME
# ══════════════════════════════════════════════

@auth_bp.route("/")
def home():
    return current_app.send_static_file("index.html")


# ══════════════════════════════════════════════
# ❹  LOGIN
# ══════════════════════════════════════════════

@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if "user_id" in session:
        return redirect(url_for("user.generate_logbook"))

    if request.method == "POST":
        email     = request.form.get("email", "").strip().lower()
        password  = request.form.get("password", "").strip()
        device_id = request.form.get("device_id", "").strip()
        token     = request.form.get("login_token", "")
        ip        = _get_ip(request)

        # ── CSRF guard ──────────────────────────────────────────
        if not validate_login_token(token):
            flash("Invalid session token. Please try again.", "danger")
            return redirect(url_for("auth.login"))

        # ── IP lockout (Redis first, in-memory fallback) ───────────────
        redis_locked, redis_remaining = redis_is_locked(ip)
        if redis_locked:
            remaining = int(redis_remaining / 60) + 1
            flash(f"Too many failed attempts. Try again in {remaining} minute(s).", "danger")
            return redirect(url_for("auth.login"))

        if ip in locked_ips:
            if datetime.utcnow() < locked_ips[ip]:
                remaining = int((locked_ips[ip] - datetime.utcnow()).total_seconds() / 60) + 1
                flash(f"Too many failed attempts. Try again in {remaining} minute(s).", "danger")
                return redirect(url_for("auth.login"))
            _reset_attempts(ip)

        # ── Field validation ────────────────────────────────────
        if not email or not password:
            flash("All fields are required.", "warning")
            return redirect(url_for("auth.login"))

        if not device_id:
            flash("Device verification failed. Please enable JavaScript and try again.", "danger")
            return redirect(url_for("auth.login"))

        # ── Fetch user ──────────────────────────────────────────
        user = orm_db.session.query(User).filter(User.email == email).first()

        if not user:
            _increment_attempts(ip)
            flash("Invalid credentials.", "danger")
            return redirect(url_for("auth.login"))

        user_id = str(user.id)

        # ── Password check ──────────────────────────────────────
        if not check_password_hash(user.password_hash or "", password):
            _increment_attempts(ip)
            flash("Invalid credentials.", "danger")
            return redirect(url_for("auth.login"))

        # ── Account status ──────────────────────────────────────
        if user.status == "Disabled":
            flash("Account disabled. Contact support.", "danger")
            return redirect(url_for("auth.login"))

        # ── Device binding ──────────────────────────────────────
        stored_device = user.bound_device_id
        if stored_device and stored_device != device_id:
            # Different device detected → audit log
            try:
                log_suspicious_device(device_id, user_id, ip)
            except Exception as e:
                orm_db.session.rollback()
                current_app.logger.error(f"Device audit log error: {e}")

        # ── New session token (INSERTed — other devices stay valid) ──
        new_session_token = secrets.token_hex(64)
        create_session(user_id, new_session_token, device_id)
        user.last_login = datetime.utcnow()
        user.bound_device_id = device_id
        user.last_ip = ip
        orm_db.session.commit()
        _reset_attempts(ip)

        # ── Build session ───────────────────────────────────────
        session.clear()  # prevent session fixation
        session.permanent = True
        current_app.permanent_session_lifetime = timedelta(minutes=30)

        session["user_id"]       = user_id
        session["email"]         = email
        session["role"]          = user.role or "user"
        session["session_token"] = new_session_token
        session["device_id"]     = device_id

        # ── Subscription gate (disabled) ─────────────────────────
        # if _subscription_is_active(user_as_dict):
        #     flash("Welcome back!", "success")
        #     return redirect(url_for("payment.payment_page"))
        #
        # flash("A subscription is required to continue.", "warning")
        # student_profiles stays on Firestore this slice; route by its presence.
        profile = db.collection("student_profiles").document(user_id).get()

        if profile.exists:
            return redirect(url_for("user.dashboard"))
        else:
            return redirect(url_for("user.create_profile"))

    token = generate_login_token()
    return render_template("login.html", login_token=token)


# ══════════════════════════════════════════════
# ❺  LOGOUT
# ══════════════════════════════════════════════

@auth_bp.route("/logout", methods=["GET", "POST"])
def logout():
    user_id = session.get("user_id")
    if user_id:
        # Revoke only THIS device's token → other devices stay logged in
        remove_session_token(session.get("session_token"))
    session.clear()
    flash("You have been logged out.", "info")
    resp = redirect(url_for("auth.login"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, private"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


# ══════════════════════════════════════════════
# ❻  REGISTER
# ══════════════════════════════════════════════

_ALREADY_REGISTERED = "Email already registered. Please login or use another email."


@auth_bp.route("/register", methods=["GET", "POST"])
def registration():
    if request.method == "POST":
        username  = request.form.get("username", "").strip()
        email     = request.form.get("email", "").strip().lower()
        password  = request.form.get("password", "")
        confirm   = request.form.get("confirm_password", "")
        ip        = _get_ip(request)

        if not all([username, email, password, confirm]):
            flash("All fields are required.", "danger")
            return redirect(url_for("auth.registration"))

        if password != confirm:
            flash("Passwords do not match.", "danger")
            return redirect(url_for("auth.registration"))

        if len(password) < 8:
            flash("Password must be at least 8 characters.", "danger")
            return redirect(url_for("auth.registration"))

        if not check_registration_limit(ip):
            flash("Too many registrations from this IP. Try again later.", "danger")
            return redirect(url_for("auth.registration"))

        # Email uniqueness is enforced by the Postgres UNIQUE(email) constraint;
        # a duplicate raises IntegrityError on commit.
        user = User(
            username=username,
            email=email,
            role="user",
            password_hash=generate_password_hash(password),
            bound_device_id=None,
            subscription_status=False,
            subscription_expiry=None,
            status="Active",
            has_completed_tour=False,
            has_completed_onboarding=False,
            last_login=None,
        )
        orm_db.session.add(user)
        try:
            orm_db.session.commit()
        except IntegrityError:
            orm_db.session.rollback()
            flash("Email already registered. Please login.", "warning")
            return redirect(url_for("auth.login"))
        except Exception as error:
            orm_db.session.rollback()
            flash(f"Registration error: {error}", "danger")
            return redirect(url_for("auth.registration"))

        log_registration(ip)
        flash("Account created successfully. Please log in.", "success")
        return redirect(url_for("auth.login"))

    return render_template("registration.html")


# @auth_bp.route("/forgot-password", methods=["GET", "POST"])
# def forgot_password():
#     if request.method == "POST":
#         email = request.form.get("email", "").strip().lower()

#         if not email:
#             flash("Please provide your registered email.", "danger")
#             return render_template("forgot_password.html")

#         # Check user in Firestore
#         user_query = db.collection("users").where(filter=FieldFilter("email", "==", email)).limit(1).get()
#         if not user_query:
#             flash("No account found with this email.", "danger")
#             return render_template("forgot_password.html")

#         # Store email in session for reset step
#         session["reset_email"] = email

#         # Redirect to reset-password step with ?step=reset for frontend toggle
#         return redirect(url_for("auth.reset_password", step="reset"))

#     return render_template("forgot_password.html")

# @auth_bp.route("/reset-password", methods=["GET", "POST"])
# def reset_password():
#     reset_email = session.get("reset_email")
#     if not reset_email:
#         flash("Invalid reset request. Try again.", "danger")
#         return redirect(url_for("auth.forgot_password"))

#     if request.method == "POST":
#         new_password = request.form.get("password", "").strip()
#         confirm_password = request.form.get("confirm_password", "").strip()

#         if not new_password or not confirm_password:
#             flash("All fields are required.", "danger")
#             return render_template("forgot_password.html", step="reset")

#         if new_password != confirm_password:
#             flash("Passwords do not match.", "danger")
#             return render_template("forgot_password.html", step="reset")

#         if len(new_password) < 8:
#             flash("Password must be at least 8 characters long.", "danger")
#             return render_template("forgot_password.html", step="reset")

#         hashed_password = generate_password_hash(new_password)

#         # Update the correct field in Firestore
#         user_query = db.collection("users").where(filter=FieldFilter("email", "==", reset_email)).limit(1).get()
#         if user_query:
#             user_id = user_query[0].id
#             db.collection("users").document(user_id).update({"password_hash": hashed_password})

#         session.pop("reset_email", None)

#         flash("Password reset successfully! You can now log in.", "success")
#         return redirect(url_for("auth.login", role="staff"))

#     return render_template("forgot_password.html", step="reset")