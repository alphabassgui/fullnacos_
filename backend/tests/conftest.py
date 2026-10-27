import os
import pathlib
import sys
from urllib.parse import urlparse

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# The ORM routes (users/sessions/security_logs) need Flask-SQLAlchemy wired up,
# but `app.py` only calls `db.init_app` when DATABASE_URL is set — and the CI
# test step sets only TEST_DATABASE_URL. Mirror it into DATABASE_URL *before*
# `app` is imported so the extension binds to the same disposable test database.
if os.getenv("TEST_DATABASE_URL") and not os.getenv("DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]


# --- Postgres test harness (infra only) -------------------------------------
# These fixtures back the Postgres-foundation smoke test. They bind to a
# SEPARATE, disposable database given by TEST_DATABASE_URL (a local/CI Postgres)
# and are never allowed to touch the production Supabase database. When
# TEST_DATABASE_URL is unset the Postgres-backed tests skip, so the rest of the
# Firestore-era suite still runs unchanged.


def _reject_production(url):
    """Refuse to run against the production Supabase database.

    Fails loudly if the host looks like Supabase or matches SUPABASE_URL's host.
    """
    host = (make_url(url).host or "").lower()
    looks_like_supabase = "supabase" in host
    supabase_url = os.getenv("SUPABASE_URL")
    if supabase_url:
        prod_host = (urlparse(supabase_url).hostname or "").lower()
        if prod_host and prod_host == host:
            looks_like_supabase = True
    if looks_like_supabase:
        raise RuntimeError(
            f"TEST_DATABASE_URL host {host!r} looks like the production Supabase "
            "database. Tests must only run against a disposable local/CI Postgres."
        )


@pytest.fixture(scope="session")
def engine():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set; skipping Postgres-backed tests")
    _reject_production(url)
    eng = create_engine(url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture()
def db_conn(engine):
    """A connection wrapped in a transaction + SAVEPOINT, rolled back after each
    test so no test ever persists data."""
    connection = engine.connect()
    outer = connection.begin()
    nested = connection.begin_nested()
    try:
        yield connection
    finally:
        if nested.is_active:
            nested.rollback()
        outer.rollback()
        connection.close()


@pytest.fixture()
def db_session(flask_app):
    """Bind Flask-SQLAlchemy's ``db.session`` to a single connection wrapped in
    an outer transaction, rolled back after the test so nothing persists.

    The ORM auth routes call ``db.session.commit()``; ``join_transaction_mode=
    "create_savepoint"`` turns each such commit into a SAVEPOINT release inside
    the outer transaction, so the final ``rollback()`` still undoes everything.
    Skips when TEST_DATABASE_URL is unset, leaving the DB-independent tests to
    run locally.
    """
    if not os.getenv("TEST_DATABASE_URL"):
        pytest.skip("TEST_DATABASE_URL not set; skipping Postgres-backed tests")

    from extensions import db

    with flask_app.app_context():
        connection = db.engine.connect()
        outer = connection.begin()
        original_session = db.session
        db.session = db._make_scoped_session(
            {"bind": connection, "join_transaction_mode": "create_savepoint"}
        )
        try:
            yield db.session
        finally:
            db.session.remove()
            db.session = original_session
            if outer.is_active:
                outer.rollback()
            connection.close()
