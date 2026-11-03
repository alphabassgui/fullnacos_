"""Tests for the GitHub action file-picker routes (2a).

Covers:
    GET   /api/business/<bid>/actions/<aid>/resolve-path
    PATCH /api/business/<bid>/actions/<aid>/target-path

The auth skeleton, business/owner/action scoping and 401/404/403 shape are
exercised the same way as approve_action. The GitHub chain (connection -> repo
-> default branch) and resolve_target_file are stubbed so nothing touches the
network, matching the monkeypatch style in test_github_connector.py.

These are Postgres-backed (they seed real Action/Business rows), so they skip
when TEST_DATABASE_URL is unset, like the rest of the DB-gated suite.
"""

import uuid

import pytest

from models import Action
from tests.test_user_routes import (  # reuse the seed helpers + login
    seed_action,
    seed_business,
    seed_user,
    _login,
)

ABSENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


# ──────────────────────────────────────────────
# Offline GitHub stubs
# ──────────────────────────────────────────────


class _FakeGitHubAPI:
    def __init__(self, access_token=None):
        self.access_token = access_token

    def get_repository(self, owner, repo):
        return {
            "full_name": f"{owner}/{repo}",
            "default_branch": "main",
        }

    def get_branch(self, owner, repo, branch):
        return {"name": branch, "sha": "basesha", "protected": True}


def _patch_github(monkeypatch, resolution):
    """Stub the connection, GitHubAPI and resolve_target_file so the routes run
    without any network or encrypted-connection dependency. ``resolution`` is
    what resolve_target_file returns."""
    import routes.user as routes_user
    import services.github_edit_service as edit_svc

    monkeypatch.setattr(
        routes_user,
        "get_connection",
        lambda **kwargs: {
            "access_token": "tok",
            "repository": "owner/repo",
            "default_branch": "main",
        },
    )
    monkeypatch.setattr(routes_user, "GitHubAPI", _FakeGitHubAPI)
    monkeypatch.setattr(
        edit_svc, "resolve_target_file", lambda **kwargs: resolution
    )


def _seed_github_action(db_session, **overrides):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(
        db_session, owner_id=uid, website_url="https://acme.example"
    )
    bid = str(business.id)
    fields = dict(action_type="github", status="pending_approval")
    fields.update(overrides)
    action = seed_action(db_session, bid, uid, **fields)
    return uid, bid, str(action.id), action


# ──────────────────────────────────────────────
# resolve-path: auth skeleton
# ──────────────────────────────────────────────


def test_resolve_path_401_without_session(client):
    resp = client.get(
        f"/api/business/{ABSENT_UUID}/actions/{ABSENT_UUID}/resolve-path"
    )
    assert resp.status_code == 401


def test_resolve_path_404_unknown_business(db_session, client):
    user = seed_user(db_session)
    _login(client, str(user.id))
    resp = client.get(
        f"/api/business/{ABSENT_UUID}/actions/{ABSENT_UUID}/resolve-path"
    )
    assert resp.status_code == 404


def test_resolve_path_403_non_owner(db_session, client):
    owner = seed_user(db_session, email="owner@example.com")
    other = seed_user(db_session, email="other@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), name="B")
    _login(client, str(other.id))
    resp = client.get(
        f"/api/business/{business.id}/actions/{ABSENT_UUID}/resolve-path"
    )
    assert resp.status_code == 403


def test_resolve_path_404_unknown_action(db_session, client):
    uid, bid, _aid, _ = _seed_github_action(db_session)
    _login(client, uid)
    resp = client.get(
        f"/api/business/{bid}/actions/{ABSENT_UUID}/resolve-path"
    )
    assert resp.status_code == 404


def test_resolve_path_400_non_github_action(db_session, client):
    uid, bid, aid, _ = _seed_github_action(db_session, action_type="social")
    _login(client, uid)
    resp = client.get(
        f"/api/business/{bid}/actions/{aid}/resolve-path"
    )
    assert resp.status_code == 400
    assert "not a GitHub action" in resp.get_json()["error"]


# ──────────────────────────────────────────────
# resolve-path: resolution shapes
# ──────────────────────────────────────────────


def test_resolve_path_confirmed(db_session, client, monkeypatch):
    uid, bid, aid, _ = _seed_github_action(
        db_session, target_path="public/index.html"
    )
    _patch_github(
        monkeypatch,
        {"status": "confirmed", "path": "public/index.html"},
    )
    _login(client, uid)
    resp = client.get(f"/api/business/{bid}/actions/{aid}/resolve-path")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "confirmed"
    assert body["path"] == "public/index.html"
    assert body["evidenced_path"] == "public/index.html"


def test_resolve_path_needs_confirmation(db_session, client, monkeypatch):
    uid, bid, aid, _ = _seed_github_action(db_session, target_path=None)
    _patch_github(
        monkeypatch,
        {
            "status": "needs_confirmation",
            "candidates": ["index.html", "about.html"],
        },
    )
    _login(client, uid)
    resp = client.get(f"/api/business/{bid}/actions/{aid}/resolve-path")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "needs_confirmation"
    assert body["candidates"] == ["index.html", "about.html"]
    assert "path" not in body


# ──────────────────────────────────────────────
# target-path: persistence + validation
# ──────────────────────────────────────────────


def test_set_target_path_persists_confirmed(db_session, client, monkeypatch):
    uid, bid, aid, _ = _seed_github_action(db_session, target_path=None)
    _patch_github(
        monkeypatch, {"status": "confirmed", "path": "index.html"}
    )
    _login(client, uid)
    resp = client.patch(
        f"/api/business/{bid}/actions/{aid}/target-path",
        json={"target_path": "index.html"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["target_path"] == "index.html"

    updated = db_session.get(Action, aid)
    assert updated.target_path == "index.html"
    assert updated.status == "pending_approval"


def test_set_target_path_rejects_path_not_in_tree(
    db_session, client, monkeypatch
):
    uid, bid, aid, _ = _seed_github_action(db_session, target_path=None)
    _patch_github(
        monkeypatch,
        {"status": "needs_confirmation", "candidates": ["index.html"]},
    )
    _login(client, uid)
    resp = client.patch(
        f"/api/business/{bid}/actions/{aid}/target-path",
        json={"target_path": "does/not/exist.html"},
    )
    assert resp.status_code == 400
    assert resp.get_json()["candidates"] == ["index.html"]

    # The bad path was never written.
    updated = db_session.get(Action, aid)
    assert updated.target_path is None


def test_set_target_path_blocked_after_approval(
    db_session, client, monkeypatch
):
    uid, bid, aid, _ = _seed_github_action(
        db_session, status="approved", target_path="index.html"
    )
    _patch_github(
        monkeypatch, {"status": "confirmed", "path": "other.html"}
    )
    _login(client, uid)
    resp = client.patch(
        f"/api/business/{bid}/actions/{aid}/target-path",
        json={"target_path": "other.html"},
    )
    assert resp.status_code == 400
    assert "pending approval" in resp.get_json()["error"]

    # Unchanged — an approved action's target is locked in.
    updated = db_session.get(Action, aid)
    assert updated.target_path == "index.html"


def test_set_target_path_400_missing_body(db_session, client):
    uid, bid, aid, _ = _seed_github_action(db_session)
    _login(client, uid)
    resp = client.patch(
        f"/api/business/{bid}/actions/{aid}/target-path", json={}
    )
    assert resp.status_code == 400
    assert "Missing target_path" in resp.get_json()["error"]


def test_set_target_path_401_without_session(client):
    resp = client.patch(
        f"/api/business/{ABSENT_UUID}/actions/{ABSENT_UUID}/target-path",
        json={"target_path": "index.html"},
    )
    assert resp.status_code == 401
