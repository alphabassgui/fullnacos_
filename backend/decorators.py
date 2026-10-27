from flask import redirect, url_for, flash, session, current_app
from functools import wraps

from sqlalchemy import exists

from extensions import db as orm_db
from models import User, UserSession


def login_required(f):
    """
    Protects routes by verifying the request's session token is a live row in
    ``user_sessions`` for this user. Multiple devices can be logged in at once:
    each login INSERTs its own token row, so logging in on a new device does not
    invalidate existing ones. A session whose token has no row is rejected.
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
            user = orm_db.session.get(User, user_id)
            if user is None:
                session.clear()
                return redirect(url_for("auth.login"))

            # Validate the session token by an EXISTS on the user's session
            # rows. The token is the PK (high-entropy secrets.token_hex(64)); an
            # indexed exact-match lookup preserves the anti-sharing posture.
            token_valid = orm_db.session.query(
                exists().where(
                    UserSession.token == session_token,
                    UserSession.user_id == user_id,
                )
            ).scalar()
            if not token_valid:
                session.clear()
                flash("Session expired. Please log in again.", "warning")
                return redirect(url_for("auth.login"))

            if user.status == "Disabled":
                session.clear()
                flash("Account disabled. Contact support.", "danger")
                return redirect(url_for("auth.login"))

        except Exception as e:
            current_app.logger.error(f"Session guard error: {e}")
            session.clear()
            return redirect(url_for("auth.login"))

        return f(*args, **kwargs)
    return decorated
