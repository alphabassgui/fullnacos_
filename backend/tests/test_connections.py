"""DB-backed tests for slice (e): connections table.

All tests require TEST_DATABASE_URL (Postgres) and use the db_session fixture
from conftest.py.  They auto-skip locally when that env var is unset.

Coverage:
  - create_connection stores encrypted tokens
  - get_connection returns the most-recently-updated row (ORDER BY updated_at DESC)
  - get_connection decrypts access_token + refresh_token
  - get_connection returns None when no connected rows exist
  - delete_connection removes all connected rows and returns the count
  - Business FK CASCADE removes Connection rows on business delete
  - select_github_repository PATCH updates repository + default_branch by id
  - select_search_console_property POST updates site_id and bumps updated_at
"""

import time
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.security import generate_password_hash

from extensions import db as orm_db
from models import Business, Connection, User
from services.connection_service import (
    create_connection,
    delete_connection,
    get_connection,
)
from services.token_encryption import decrypt_token, encrypt_token


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


def seed_user(db_session, email="conn@test.test"):
    user = User(
        email=email,
        username="ConnUser",
        role="user",
        status="Active",
        password_hash=generate_password_hash("password"),
    )
    db_session.add(user)
    db_session.commit()
    return user


def seed_business(db_session, owner_id, name="ConnBiz"):
    biz = Business(owner_id=owner_id, name=name)
    db_session.add(biz)
    db_session.commit()
    return biz


def seed_connection(
    db_session,
    business_id,
    provider="github",
    status="connected",
    access_token_plaintext="plaintext-token",
    refresh_token_plaintext=None,
    account_id="octocat",
    updated_at=None,
):
    conn = Connection(
        business_id=business_id,
        provider=provider,
        status=status,
        access_token=encrypt_token(access_token_plaintext),
        refresh_token=(
            encrypt_token(refresh_token_plaintext)
            if refresh_token_plaintext
            else None
        ),
        account_id=account_id,
    )
    if updated_at is not None:
        conn.updated_at = updated_at
    db_session.add(conn)
    db_session.commit()
    return conn


# ---------------------------------------------------------------------------
# service: create_connection
# ---------------------------------------------------------------------------


def test_create_connection_stores_encrypted_token(db_session):
    user = seed_user(db_session, "create1@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="CreateBiz1")
    plaintext = "super-secret-access-token"

    result = create_connection(
        business_id=str(biz.id),
        user_id=str(user.id),
        provider="github",
        connection_data={"access_token": plaintext, "account_id": "octocat"},
    )

    # Row exists in Postgres
    row = db_session.query(Connection).filter_by(id=result["id"]).first()
    assert row is not None
    # Stored value is NOT the plaintext
    assert row.access_token != plaintext
    # But decrypts back to it
    assert decrypt_token(row.access_token) == plaintext
    # Return dict carries the encrypted ciphertext (same as Firestore era)
    assert result["access_token"] != plaintext
    assert result["provider"] == "github"
    assert result["status"] == "connected"


# ---------------------------------------------------------------------------
# service: get_connection
# ---------------------------------------------------------------------------


def test_get_connection_returns_most_recently_updated(db_session):
    user = seed_user(db_session, "get1@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="GetBiz1")

    now = datetime.now(timezone.utc)
    older_time = now - timedelta(hours=2)
    newer_time = now - timedelta(hours=1)

    older = seed_connection(
        db_session,
        business_id=biz.id,
        access_token_plaintext="older-token",
        updated_at=older_time,
    )
    newer = seed_connection(
        db_session,
        business_id=biz.id,
        access_token_plaintext="newer-token",
        updated_at=newer_time,
    )

    result = get_connection(
        business_id=str(biz.id),
        user_id=str(user.id),
        provider="github",
    )

    assert result is not None
    assert result["id"] == str(newer.id)
    assert result["access_token"] == "newer-token"


def test_get_connection_decrypts_tokens(db_session):
    user = seed_user(db_session, "get2@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="GetBiz2")

    seed_connection(
        db_session,
        business_id=biz.id,
        provider="google_search_console",
        access_token_plaintext="access-plain",
        refresh_token_plaintext="refresh-plain",
    )

    result = get_connection(
        business_id=str(biz.id),
        user_id=str(user.id),
        provider="google_search_console",
    )

    assert result is not None
    assert result["access_token"] == "access-plain"
    assert result["refresh_token"] == "refresh-plain"


def test_get_connection_returns_none_when_nothing_connected(db_session):
    user = seed_user(db_session, "get3@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="GetBiz3")

    result = get_connection(
        business_id=str(biz.id),
        user_id=str(user.id),
        provider="github",
    )

    assert result is None


# ---------------------------------------------------------------------------
# service: delete_connection
# ---------------------------------------------------------------------------


def test_delete_connection_removes_all_connected_rows_returns_count(db_session):
    user = seed_user(db_session, "del1@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="DelBiz1")

    c1 = seed_connection(db_session, business_id=biz.id, provider="github")
    c2 = seed_connection(db_session, business_id=biz.id, provider="github")
    # A disconnected row that must NOT be removed
    c3 = seed_connection(
        db_session,
        business_id=biz.id,
        provider="github",
        status="disconnected",
        access_token_plaintext="other-token",
    )

    # Save IDs before deletion: delete_connection uses synchronize_session=False,
    # so the identity map isn't updated and accessing .id on the objects after
    # commit raises ObjectDeletedError.
    c1_id = c1.id
    c2_id = c2.id
    c3_id = c3.id

    count = delete_connection(
        business_id=str(biz.id),
        user_id=str(user.id),
        provider="github",
    )

    assert count == 2
    db_session.expire_all()
    assert db_session.get(Connection, c1_id) is None
    assert db_session.get(Connection, c2_id) is None
    # Non-connected row is untouched
    surviving = db_session.get(Connection, c3_id)
    assert surviving is not None
    assert surviving.status == "disconnected"


# ---------------------------------------------------------------------------
# CASCADE: deleting a business removes its connections
# ---------------------------------------------------------------------------


def test_business_delete_cascades_connections(db_session):
    user = seed_user(db_session, "cascade@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="CascadeBiz")
    conn = seed_connection(db_session, business_id=biz.id)
    conn_id = conn.id

    db_session.delete(biz)
    db_session.commit()

    assert db_session.get(Connection, conn_id) is None


# ---------------------------------------------------------------------------
# Route: select_github_repository (PATCH)
# ---------------------------------------------------------------------------


def test_select_github_repository_updates_row_by_id(db_session, client):
    user = seed_user(db_session, "ghrepo@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="GHRepoBiz")
    conn = seed_connection(
        db_session,
        business_id=biz.id,
        provider="github",
        account_id="octocat",
    )

    original_updated_at = conn.updated_at

    fake_repo = {
        "full_name": "octocat/Hello-World",
        "default_branch": "main",
    }

    with client.session_transaction() as sess:
        sess["user_id"] = str(user.id)

    with patch("routes.github_connections.GitHubAPI") as MockGitHubAPI:
        mock_instance = MagicMock()
        mock_instance.get_repository.return_value = fake_repo
        MockGitHubAPI.return_value = mock_instance

        resp = client.patch(
            f"/api/connections/github/repository?business_id={biz.id}",
            json={"repository": "octocat/Hello-World"},
            content_type="application/json",
        )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["repository"] == "octocat/Hello-World"
    assert data["default_branch"] == "main"

    # Verify the DB row was updated correctly
    db_session.expire(conn)
    updated = db_session.get(Connection, conn.id)
    assert updated.repository == "octocat/Hello-World"
    assert updated.default_branch == "main"
    # updated_at is NOT bumped by this route (preserved behavior)
    assert updated.updated_at == original_updated_at


# ---------------------------------------------------------------------------
# Route: select_search_console_property (POST) — bumps updated_at
# ---------------------------------------------------------------------------


def test_select_search_console_property_updates_site_id_and_bumps_updated_at(
    db_session, client
):
    user = seed_user(db_session, "gscprop@test.test")
    biz = seed_business(db_session, owner_id=user.id, name="GSCPropBiz")

    past = datetime(2020, 1, 1, tzinfo=timezone.utc)
    conn = seed_connection(
        db_session,
        business_id=biz.id,
        provider="google_search_console",
        refresh_token_plaintext="rt-plain",
        updated_at=past,
    )

    target_site = "https://example.com/"

    with client.session_transaction() as sess:
        sess["user_id"] = str(user.id)

    with patch("routes.search_console_connections.GoogleSearchConsoleAPI") as MockGSC:
        mock_instance = MagicMock()
        mock_instance.list_sites.return_value = [
            {"siteUrl": target_site, "permissionLevel": "siteOwner"}
        ]
        MockGSC.from_refresh_token.return_value = mock_instance

        resp = client.post(
            "/api/connections/search-console/select-property",
            json={"business_id": str(biz.id), "site_url": target_site},
            content_type="application/json",
        )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["site_url"] == target_site

    db_session.expire(conn)
    updated = db_session.get(Connection, conn.id)
    assert updated.site_id == target_site
    # updated_at WAS bumped by this route
    assert updated.updated_at > past
