import os
import pathlib
import sys
from urllib.parse import urlparse

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


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
