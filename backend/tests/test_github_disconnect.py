"""Tests for the GitHub disconnect route (DELETE /api/connections/github/connection).

Slice (e): the connection storage moved from Firestore to Postgres.  These tests
replaced the FakeDb/monkeypatch emulator with the shared db_session fixture from
conftest.py.  The three assertions are identical to the pre-migration tests.
"""

import pytest
from werkzeug.security import generate_password_hash

from models import Business, Connection, User
from services.token_encryption import encrypt_token


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def seed_user(db_session, email="owner@disconnect.test"):
    user = User(
        email=email,
        username="Owner",
        role="user",
        status="Active",
        password_hash=generate_password_hash("password"),
    )
    db_session.add(user)
    db_session.commit()
    return user


def seed_business(db_session, owner_id, name="DisconnectBiz"):
    biz = Business(owner_id=owner_id, name=name)
    db_session.add(biz)
    db_session.commit()
    return biz


def seed_connection(db_session, business_id, provider="github", account_id="octocat"):
    conn = Connection(
        business_id=business_id,
        provider=provider,
        status="connected",
        access_token=encrypt_token("fake-access-token"),
        account_id=account_id,
    )
    db_session.add(conn)
    db_session.commit()
    return conn


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_disconnect_removes_connection_and_returns_200(db_session, client):
    user = seed_user(db_session)
    biz = seed_business(db_session, owner_id=user.id)
    conn = seed_connection(db_session, business_id=biz.id)
    conn_id = conn.id

    with client.session_transaction() as sess:
        sess["user_id"] = str(user.id)

    resp = client.delete(
        f"/api/connections/github/connection?business_id={biz.id}"
    )

    assert resp.status_code == 200
    assert resp.get_json() == {"success": True}
    # The connection row was hard-deleted from Postgres.
    assert db_session.get(Connection, conn_id) is None


def test_disconnect_404_when_nothing_connected(db_session, client):
    user = seed_user(db_session, email="owner2@disconnect.test")
    biz = seed_business(db_session, owner_id=user.id, name="EmptyBiz")

    with client.session_transaction() as sess:
        sess["user_id"] = str(user.id)

    resp = client.delete(
        f"/api/connections/github/connection?business_id={biz.id}"
    )

    assert resp.status_code == 404
    assert resp.get_json() == {
        "success": False,
        "error": "GitHub connection not found",
    }


def test_disconnect_401_when_unauthenticated(db_session, client):
    user = seed_user(db_session, email="owner3@disconnect.test")
    biz = seed_business(db_session, owner_id=user.id, name="AuthBiz")
    conn = seed_connection(db_session, business_id=biz.id)
    conn_id = conn.id

    with client.session_transaction() as sess:
        sess.clear()

    resp = client.delete(
        f"/api/connections/github/connection?business_id={biz.id}"
    )

    assert resp.status_code == 401
    assert resp.get_json() == {
        "success": False,
        "error": "Authentication required",
    }
    # No deletion should have been attempted.
    assert db_session.get(Connection, conn_id) is not None
