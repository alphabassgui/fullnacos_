import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from flask import Flask, request,render_template
from routes.auth import auth_bp
from routes.user import user_bp
from routes.instagram_connections import instagram_connections_bp
from routes.auth_api import api_auth_bp
from routes.github_connections import github_connections_bp
from routes.search_console_connections import search_console_connections_bp
from routes.business_api import business_api_bp
from routes.gtm_routes import gtm_bp
# from routes.payment import payment_bp
from datetime import timedelta
from werkzeug.middleware.proxy_fix import ProxyFix

# Create the Flask app
app = Flask(__name__, template_folder="templates", static_folder="static")

from flask_cors import CORS
DEV_CORS_ORIGINS = ["http://localhost:3000"]


def resolve_cors_origins(raw):
    """Parse a comma-separated CORS_ALLOWED_ORIGINS value.

    Fails closed: unset/blank (or only empty entries) falls back to the
    localhost dev origin, never to "*".
    """
    origins = [o.strip() for o in (raw or "").split(",") if o.strip()]
    return origins or list(DEV_CORS_ORIGINS)


def resolve_debug(raw):
    """DEBUG is off unless explicitly set to "true" (case-insensitive)."""
    return (raw or "False").lower() == "true"


CORS(
    app,
    supports_credentials=True,
    origins=resolve_cors_origins(os.getenv("CORS_ALLOWED_ORIGINS")),
)

app.secret_key = os.getenv("SECRET_KEY")
if not app.secret_key:
    raise RuntimeError(
        "SECRET_KEY environment variable is missing"
    )

app.config["DEBUG"] = resolve_debug(os.getenv("DEBUG"))

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)


# Session configuration for security.
# Defaults are production-safe (Secure + SameSite=None, which the Vercel reverse
# proxy makes first-party so Safari ITP doesn't drop it). Local http dev can
# override via env (SESSION_COOKIE_SECURE=False) since browsers won't store a
# Secure cookie over http://localhost.
cookie_secure = os.getenv("SESSION_COOKIE_SECURE", "True").lower() == "true"
cookie_samesite = os.getenv("SESSION_COOKIE_SAMESITE", "None")
# Browsers reject SameSite=None without Secure; fall back to Lax for local http.
if not cookie_secure and cookie_samesite == "None":
    cookie_samesite = "Lax"
app.config.update(
    SESSION_COOKIE_SECURE=cookie_secure,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=cookie_samesite,
)


# SQLAlchemy / Flask-Migrate wiring. Firestore remains the live database; this
# only prepares the Postgres (Supabase) stack for later, table-by-table slices.
# Guarded on DATABASE_URL so local/legacy runs without it still boot.
import logging
from sqlalchemy.pool import NullPool
from extensions import db, migrate

database_url = os.getenv("DATABASE_URL")
if database_url:
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    # DATABASE_URL points at the Supabase TRANSACTION pooler (pgBouncer, port
    # 6543). In transaction mode pgBouncer hands each transaction a different
    # backend, so we must not keep a client-side server-bound pool: NullPool
    # opens and closes a connection per checkout. psycopg2 does not use
    # server-side prepared statements by default, so it is safe here; do NOT
    # add prepare_threshold — that is a psycopg3-only option and psycopg2 would
    # reject it. Alembic migrations run against the DIRECT connection (port
    # 5432), not this pooler (see migrations/env.py).
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"poolclass": NullPool}
    db.init_app(app)
    migrate.init_app(app, db)
else:
    logging.getLogger(__name__).warning(
        "DATABASE_URL unset — skipping SQLAlchemy/Migrate init (DB-less boot)."
    )


# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(user_bp)
app.register_blueprint(instagram_connections_bp)
app.register_blueprint(api_auth_bp)
app.register_blueprint(github_connections_bp)
app.register_blueprint(search_console_connections_bp)
app.register_blueprint(business_api_bp)
app.register_blueprint(gtm_bp)
# app.register_blueprint(payment_bp)


@app.after_request
def set_no_cache_headers(response):
    """
    Prevent the browser from caching any page so that after logout,
    pressing back or manually entering a URL forces a fresh server
    request (which login_required will reject).
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.errorhandler(404)
def not_found(e):
    return render_template('error.html', code='404'), 404

@app.errorhandler(500)
def server_error(e):
    return render_template('error.html', code='500', error=str(e)), 500

# Run locally if executed directly
if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", 5000))
    ssl_context = ("cert.pem", "key.pem")  # cert file, key file

    app.run(
        debug=app.config.get("DEBUG", False),
        host="0.0.0.0",
        port=port,
        threaded=True,
        use_reloader=app.config.get("DEBUG", False),
        # ssl_context=ssl_context
    )