import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request, session
from google.cloud.firestore_v1.base_query import FieldFilter
from werkzeug.security import check_password_hash, generate_password_hash

import routes.auth as auth
import services.connection_service as connection_service
import services.tile_storage_service as tile_storage_service
from firebase import db

api_auth_bp = Blueprint("api_auth", __name__)

# Providers whose OAuth tokens we revoke provider-side during account deletion,
# mapped to the connection_service helper that revokes each. Revocation is
# strictly best-effort; the stored (encrypted) Firestore docs are removed by the
# per-business recursive_delete regardless.
_OAUTH_PROVIDERS = ("github", "google_search_console")


def _has_onboarding_evidence(user_id):
    """Durable onboarding evidence: at least one business owned by the user that
    has a completed analysis run (``agent_runs`` doc with
    ``analysis_status == "completed"``). Lets already-onboarded (legacy) users be
    recognised even when the stored flag predates this field. Bounded and
    best-effort — any Firestore error returns False so /api/auth/me falls back to
    the stored flag (default False)."""
    try:
        businesses = (
            db.collection("businesses")
            .where(filter=FieldFilter("owner_id", "==", user_id))
            .stream()
        )
        for business in businesses:
            completed = (
                db.collection("businesses")
                .document(business.id)
                .collection("agent_runs")
                .where(filter=FieldFilter("analysis_status", "==", "completed"))
                .limit(1)
                .get()
            )
            if completed:
                return True
        return False
    except Exception:
        return False


@api_auth_bp.route("/api/auth/register", methods=["POST"])
def api_register():
    try:
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        ip = auth._get_ip(request)

        if not all([username, email, password]):
            return jsonify({"success": False, "error": "All fields are required."}), 400

        if len(password) < 8:
            return jsonify({"success": False, "error": "Password must be at least 8 characters."}), 400

        if not auth.check_registration_limit(ip):
            return jsonify({"success": False, "error": "Too many registrations from this IP. Try again later."}), 429

        existing = db.collection("users").where(filter=FieldFilter("email", "==", email)).limit(1).get()
        if existing:
            return jsonify({"success": False, "error": "Email already registered. Please login or use another email."}), 409

        user_data = {
            "username": username,
            "email": email,
            "role": "user",
            "password_hash": generate_password_hash(password),
            "active_session_tokens": [],
            "bound_device_id": None,
            "subscription_status": False,
            "subscription_expiry": None,
            "status": "Active",
            "has_completed_tour": False,
            "has_completed_onboarding": False,
            "created_at": datetime.utcnow().isoformat(),
            "last_login": None,
        }

        uid, error = auth.create_firebase_user_and_firestore(email, password, user_data)
        if error is not None:
            if "already registered" in error.lower():
                return jsonify({"success": False, "error": "Email already registered. Please login or use another email."}), 409
            return jsonify({"success": False, "error": "Registration failed. Try again later."}), 500

        auth.log_registration(ip)
        return jsonify({"success": True, "user_id": uid}), 201
    except Exception as exc:
        current_app.logger.error(f"API register error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500


@api_auth_bp.route("/api/auth/login", methods=["POST"])
def api_login():
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        ip = auth._get_ip(request)

        redis_locked, redis_remaining = auth.redis_is_locked(ip)
        if redis_locked:
            remaining = int(int(redis_remaining or 0) / 60) + 1
            return jsonify({"success": False, "error": f"Too many failed attempts. Try again in {remaining} minute(s)."}), 423

        if ip in auth.locked_ips:
            if datetime.utcnow() < auth.locked_ips[ip]:
                remaining = int((auth.locked_ips[ip] - datetime.utcnow()).total_seconds() / 60) + 1
                return jsonify({"success": False, "error": f"Too many failed attempts. Try again in {remaining} minute(s)."}), 423
            auth._reset_attempts(ip)

        if not email or not password:
            return jsonify({"success": False, "error": "All fields are required."}), 400

        users = db.collection("users").where(filter=FieldFilter("email", "==", email)).limit(1).stream()
        user_doc = next(users, None)
        if not user_doc:
            auth._increment_attempts(ip)
            return jsonify({"success": False, "error": "Invalid credentials."}), 401

        user = user_doc.to_dict()

        if not check_password_hash(user.get("password_hash", ""), password):
            auth._increment_attempts(ip)
            return jsonify({"success": False, "error": "Invalid credentials."}), 401

        if user.get("status") == "Disabled":
            return jsonify({"success": False, "error": "Account disabled. Contact support."}), 403

        new_session_token = secrets.token_hex(64)

        # ADD the new token to the user's valid-token set (migrating a legacy
        # single token if present) so other devices stay logged in.
        db.collection("users").document(user_doc.id).update({
            "active_session_tokens": auth.merge_session_token(user, new_session_token),
            "last_login": datetime.utcnow().isoformat(),
            "last_ip": ip,
        })
        auth._reset_attempts(ip)

        session.clear()
        session.permanent = True
        current_app.permanent_session_lifetime = timedelta(minutes=30)

        session["user_id"] = user_doc.id
        session["email"] = email
        session["role"] = user.get("role", "user")
        session["session_token"] = new_session_token

        return jsonify({
            "success": True,
            "user_id": user_doc.id,
            "email": email,
            "role": user.get("role", "user"),
        }), 200
    except Exception as exc:
        current_app.logger.error(f"API login error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500


@api_auth_bp.route("/api/auth/logout", methods=["POST"])
def api_logout():
    try:
        user_id = session.get("user_id")
        if user_id:
            # Revoke only THIS device's token → other devices stay logged in.
            auth.remove_session_token(user_id, session.get("session_token"))
        session.clear()
        return jsonify({"success": True, "message": "Logged out."}), 200
    except Exception as exc:
        current_app.logger.error(f"API logout error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500


@api_auth_bp.route("/api/auth/me", methods=["GET"])
def api_me():
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user_doc = db.collection("users").document(user_id).get()
        if not user_doc.exists:
            session.clear()
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user = user_doc.to_dict()
        return jsonify({
            "success": True,
            "user": {
                "id": user_doc.id,
                "username": user.get("username"),
                "email": user.get("email"),
                "role": user.get("role"),
                "status": user.get("status"),
                # Source of truth for the one-time product tour. Defaults False for
                # users created before this field existed, so they still see it once.
                "has_completed_tour": user.get("has_completed_tour", False),
                # Source of truth for onboarding completion (post-payment routing).
                # HYBRID: the stored flag OR durable evidence (a business with a
                # completed analysis run), so legacy users who onboarded before this
                # field existed are recognised instead of re-sent through the funnel.
                # `or` short-circuits, so the derive only runs when the flag is False.
                "has_completed_onboarding": bool(user.get("has_completed_onboarding", False))
                or _has_onboarding_evidence(user_doc.id),
            },
        }), 200
    except Exception as exc:
        current_app.logger.error(f"API me error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500


@api_auth_bp.route("/api/auth/tour/complete", methods=["POST"])
def api_tour_complete():
    """Persist that the signed-in user has finished (completed or skipped) the
    product tour. Idempotent — safe to call more than once. Reuses the session
    cookie auth used by every other /api endpoint; no new auth scheme."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user_ref = db.collection("users").document(user_id)
        if not user_ref.get().exists:
            session.clear()
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user_ref.update({"has_completed_tour": True})
        return jsonify({"success": True}), 200
    except Exception as exc:
        current_app.logger.error(f"API tour complete error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500


@api_auth_bp.route("/api/auth/onboarding/complete", methods=["POST"])
def api_onboarding_complete():
    """Persist that the signed-in user has finished onboarding. Idempotent — safe
    to call more than once. Reuses the session cookie auth used by every other
    /api endpoint; no new auth scheme."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user_ref = db.collection("users").document(user_id)
        if not user_ref.get().exists:
            session.clear()
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user_ref.update({"has_completed_onboarding": True})
        return jsonify({"success": True}), 200
    except Exception as exc:
        current_app.logger.error(f"API onboarding complete error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500


def _revoke_business_tokens(business_id, user_id):
    """Best-effort provider-side OAuth revocation for one business.

    For each connected provider, fetch the decrypted token(s) and ask the
    provider to revoke them. Every step is wrapped so a failure (a provider
    outage, a missing/foreign connection, a helper raising) can NEVER abort the
    account deletion — the stored Firestore connection docs are removed by the
    caller's recursive_delete regardless of what happens here."""
    for provider in _OAUTH_PROVIDERS:
        try:
            conn = connection_service.get_connection(business_id, user_id, provider)
            if not conn:
                continue
            if provider == "github":
                connection_service.revoke_github_token(conn.get("access_token"))
            else:
                # Prefer the refresh token (revoking it also kills derived
                # access tokens); fall back to the access token.
                connection_service.revoke_google_token(
                    conn.get("refresh_token") or conn.get("access_token")
                )
        except Exception as exc:  # pragma: no cover - defensive only
            current_app.logger.warning(
                f"Token revocation skipped for business {business_id} "
                f"provider {provider}: {exc}"
            )


@api_auth_bp.route("/api/auth/account", methods=["DELETE"])
def api_delete_account():
    """Permanently and irreversibly delete the signed-in user's account.

    HARD delete: the user doc, every business they own (plus all nested
    subcollections, via recursive_delete), their student_profiles doc, and all
    of their security_logs entries are removed. Additionally, GitHub and Google
    Search Console OAuth tokens are revoked provider-side and the business's
    Supabase tile blobs are cleaned up — both strictly best-effort, so neither a
    provider outage nor a storage hiccup can block the deletion or change the
    200 response.

    Because deletion is irreversible, it requires a server-side confirmation:
    the caller must send their own account email in ``confirm_email`` and this
    endpoint re-verifies it against the stored (lowercased) email before
    deleting anything. This guards the (separate) frontend typed-email step and
    is never skipped."""
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required"}), 401

        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()
        if not user_doc.exists:
            session.clear()
            return jsonify({"success": False, "error": "User not found"}), 404

        # ── Irreversibility gate: re-verify the typed email server-side ──
        data = request.get_json(silent=True) or {}
        confirm_email = (data.get("confirm_email") or "").strip().lower()
        stored_email = (user_doc.to_dict() or {}).get("email")
        if not confirm_email or confirm_email != stored_email:
            return jsonify({
                "success": False,
                "error": "Email confirmation does not match",
            }), 400

        # ── Enumerate the user's businesses up front ──
        business_ids = [
            business.id
            for business in db.collection("businesses")
            .where(filter=FieldFilter("owner_id", "==", user_id))
            .stream()
        ]

        # ── Per business: best-effort provider revocation + tile cleanup,
        #    then a recursive delete of the business and all subcollections ──
        for business_id in business_ids:
            _revoke_business_tokens(business_id, user_id)
            try:
                tile_storage_service.delete_tiles_for_business(business_id)
            except Exception as exc:  # pragma: no cover - defensive only
                current_app.logger.warning(
                    f"Tile cleanup skipped for business {business_id}: {exc}"
                )
            db.recursive_delete(db.collection("businesses").document(business_id))

        # ── Per-user student profile (may not exist) ──
        profile_ref = db.collection("student_profiles").document(user_id)
        if profile_ref.get().exists:
            profile_ref.delete()

        # ── The user's own security_logs entries (top-level, not cascaded) ──
        security_logs = (
            db.collection("security_logs")
            .where(filter=FieldFilter("user_id", "==", user_id))
            .stream()
        )
        for log_doc in security_logs:
            db.collection("security_logs").document(log_doc.id).delete()

        # ── Finally the user doc itself, then drop the session ──
        user_ref.delete()
        session.clear()

        return jsonify({"success": True, "message": "Account deleted"}), 200
    except Exception as exc:
        current_app.logger.error(f"API delete account error: {exc}")
        return jsonify({"success": False, "error": "Internal server error."}), 500
