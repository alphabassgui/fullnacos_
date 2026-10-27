"""Backend unit tests for the Google Search Console connection routes.

All Google network access and the connection service are mocked -- no real
Google Search Console calls are made. These cover:
  1. /connect   -> 401 unauthenticated, 400 when business_id missing
  2. /callback  -> redirects to FRONTEND_URL/connections?search_console=error
                   on invalid OAuth state, and ...=connected on success
  3. /properties -> 404 when get_connection returns None (None-guard)
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


# ---------------------------------------------------------------------------
# /connect
# ---------------------------------------------------------------------------

def test_connect_401_when_unauthenticated(client):
    with client.session_transaction() as sess:
        sess.clear()

    resp = client.get(
        "/api/connections/search-console/connect?business_id=b1"
    )

    assert resp.status_code == 401
    assert resp.get_json() == {
        "success": False,
        "error": "Authentication required",
    }


def test_connect_400_when_business_id_missing(client):
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.get("/api/connections/search-console/connect")

    assert resp.status_code == 400
    assert resp.get_json() == {
        "success": False,
        "error": "Missing business_id",
    }


# ---------------------------------------------------------------------------
# /callback
# ---------------------------------------------------------------------------

def test_callback_redirects_to_error_on_invalid_state(client):
    # Authenticated, but no OAuth state was stored in the session, so the
    # state check fails and the callback must redirect (not return JSON).
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.get(
        "/api/connections/search-console/callback"
        "?code=the-code&state=bogus-state"
    )

    assert resp.status_code == 302
    assert "/connections?search_console=error" in resp.headers["Location"]


def test_callback_redirects_to_connected_on_success(client, monkeypatch):
    import routes.search_console_connections as sc_routes

    # Fake Google OAuth credentials returned by the token exchange.
    fake_credentials = SimpleNamespace(
        token="access-token",
        refresh_token="refresh-token",
        token_uri="https://oauth2.googleapis.com/token",
        expiry=None,
        scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
    )

    # Mock the whole GoogleSearchConsoleAPI: both the static token exchange
    # and the instance built from the credentials (no network / discovery).
    fake_api_cls = MagicMock()
    fake_api_cls.exchange_code_for_credentials.return_value = fake_credentials
    fake_api_cls.return_value.list_sites.return_value = [
        {"siteUrl": "https://example.com/", "permissionLevel": "siteOwner"},
    ]
    monkeypatch.setattr(sc_routes, "GoogleSearchConsoleAPI", fake_api_cls)

    # Stub create_connection so no encryption / Firestore is exercised here.
    monkeypatch.setattr(
        sc_routes,
        "create_connection",
        lambda **kwargs: {
            "id": "c1",
            "provider": "google_search_console",
            "status": "connected",
        },
    )

    # Slice c: the callback resolves the parent business via the Postgres
    # get_business_row (not Firestore `db`). "b1" is not a UUID, so the real
    # lookup would return None — patch it to an owner-matched row.
    monkeypatch.setattr(
        sc_routes,
        "get_business_row",
        lambda business_id: SimpleNamespace(owner_id="u1") if business_id == "b1" else None,
    )

    # The callback now verifies a *signed* state (itsdangerous), not a session
    # value, so build a real signed state carrying the user/business identity.
    signed_state = sc_routes._oauth_serializer().dumps(
        {"user_id": "u1", "business_id": "b1"}
    )

    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.get(
        "/api/connections/search-console/callback"
        f"?code=the-code&state={signed_state}"
    )

    assert resp.status_code == 302
    assert (
        "/connections?search_console=connected" in resp.headers["Location"]
    )


# ---------------------------------------------------------------------------
# /properties None-guard
# ---------------------------------------------------------------------------

def test_properties_404_when_not_connected(client, monkeypatch):
    # get_connection is imported inside the handler from
    # services.connection_service, so patch it there.
    import services.connection_service as connection_service

    monkeypatch.setattr(
        connection_service,
        "get_connection",
        lambda **kwargs: None,
    )

    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.get(
        "/api/connections/search-console/properties?business_id=b1"
    )

    assert resp.status_code == 404
    assert resp.get_json() == {
        "success": False,
        "error": "Google Search Console not connected",
    }
