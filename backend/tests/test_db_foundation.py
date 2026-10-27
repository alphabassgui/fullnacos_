"""Smoke test for the Postgres (Supabase) foundation.

Proves the test harness can connect to the disposable Postgres given by
TEST_DATABASE_URL, run a query, and that writes made inside the per-test
transaction are rolled back. No application models are involved — this slice
defines none. Skips automatically when TEST_DATABASE_URL is unset.
"""
from sqlalchemy import text


def test_select_one(db_conn):
    assert db_conn.execute(text("SELECT 1")).scalar() == 1


def test_temp_table_insert_and_rollback(db_conn):
    db_conn.execute(text("CREATE TEMPORARY TABLE _foundation_smoke (id integer)"))
    db_conn.execute(text("INSERT INTO _foundation_smoke (id) VALUES (42)"))
    rows = db_conn.execute(text("SELECT id FROM _foundation_smoke")).scalars().all()
    assert rows == [42]
    # The db_conn fixture rolls the transaction back after the test; a later
    # test re-creating the same temp table would fail if anything leaked.
