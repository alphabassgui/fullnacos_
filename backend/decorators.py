import hmac
import secrets
from flask import Blueprint, render_template, request, redirect, url_for, flash, session, current_app
from firebase_admin import auth as admin_auth
from firebase import db
from google.cloud.firestore_v1.base_query import FieldFilter
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

def login_required(f):
    """
    Protects routes by verifying the session token is one of the user's valid
    session tokens in Firestore. Multiple devices can be logged in at once:
    each login ADDS its token to the set, so logging in on a new device does
    not invalidate existing ones. A session whose token is not in the set is
    rejected.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            flash("Please log in.", "warning")
            return redirect(url_for("auth.login"))

        user_id       = session["user_id"]
        session_token = session.get("session_token")

        if not user_id or not session_token:
            session.clear()
            flash("Please log in.", "warning")
            return redirect(url_for("auth.login"))

        try:
            user_doc = db.collection("users").document(user_id).get()
            if not user_doc.exists:
                session.clear()
                return redirect(url_for("auth.login"))

            user = user_doc.to_dict()

            # Validate the session token against the SET of valid tokens.
            # Backward-compat: docs written before multi-device support carry a
            # single `active_session_token` and no set → treat that legacy token
            # as a one-member set so currently-logged-in users keep working.
            stored_tokens = user.get("active_session_tokens")
            if stored_tokens is None:
                legacy = user.get("active_session_token")
                stored_tokens = [legacy] if legacy else []

            # Constant-time comparison per candidate (no timing-sensitive
            # plain compare). Membership → this device's session is valid.
            token_valid = bool(session_token) and any(
                hmac.compare_digest(t, session_token) for t in stored_tokens if t
            )
            if not token_valid:
                session.clear()
                flash("Session expired. Please log in again.", "warning")
                return redirect(url_for("auth.login"))

            if user.get("status") == "Disabled":
                session.clear()
                flash("Account disabled. Contact support.", "danger")
                return redirect(url_for("auth.login"))

        except Exception as e:
            current_app.logger.error(f"Session guard error: {e}")
            session.clear()
            return redirect(url_for("auth.login"))

        return f(*args, **kwargs)
    return decorated

