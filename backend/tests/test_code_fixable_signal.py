"""2b: the deterministic github_connected signal.

`_github_repo_connected` turns "is a GitHub repo connected for this business?"
into the hard fact the decision engine needs — it must only propose a
code-level (github) action when a repo is actually connected, or the action
would dead-end at execution. These tests cover the gate itself (no DB) and that
`create_action_from_opportunity` threads the signal into `generate_action`
(DB-gated, like the rest of the pipeline tests).
"""

import pytest

import services.opportunity_action_service as oas
from tests.test_pipeline_idempotency import (
    seed_business,
    seed_user,
    _seed_opportunity,
)


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


# ──────────────────────────────────────────────
# _github_repo_connected — pure gate, no DB
# ──────────────────────────────────────────────


def test_repo_connected_true_when_repository_present(monkeypatch):
    monkeypatch.setattr(
        oas, "get_connection",
        lambda **_k: {"access_token": "t", "repository": "owner/repo"},
    )
    assert oas._github_repo_connected("biz", "owner") is True


def test_repo_connected_false_when_no_connection(monkeypatch):
    monkeypatch.setattr(oas, "get_connection", lambda **_k: None)
    assert oas._github_repo_connected("biz", "owner") is False


def test_repo_connected_false_when_no_repository_selected(monkeypatch):
    # Connected to GitHub but no repo chosen yet — still not actionable.
    monkeypatch.setattr(
        oas, "get_connection", lambda **_k: {"access_token": "t"}
    )
    assert oas._github_repo_connected("biz", "owner") is False


@pytest.mark.parametrize("exc", [ValueError("x"), PermissionError("x")])
def test_repo_connected_false_on_lookup_error(monkeypatch, exc):
    def boom(**_k):
        raise exc

    monkeypatch.setattr(oas, "get_connection", boom)
    assert oas._github_repo_connected("biz", "owner") is False


# ──────────────────────────────────────────────
# Threading: create_action_from_opportunity -> generate_action (DB-gated)
# ──────────────────────────────────────────────


def _valid_decision():
    return dict(
        action_title="Tighten the homepage title tag",
        action_type="github",
        objective="o",
        description="d",
        reasoning="r",
        expected_outcome="e",
        required_inputs=[],
        requires_approval=True,
        content_type=None,
        page_url=None,
        content=None,
        target_path=None,
    )


def _capture_github_connected(monkeypatch):
    """Stub generate_action to record the github_connected it was passed."""
    seen = {}

    def fake_generate_action(**kwargs):
        seen["github_connected"] = kwargs.get("github_connected")
        return _valid_decision()

    monkeypatch.setattr(oas, "generate_action", fake_generate_action)
    return seen


def test_threads_connected_true_into_generate_action(db_session, monkeypatch):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid)
    bid = str(business.id)
    opp = _seed_opportunity(db_session, bid, uid)

    monkeypatch.setattr(
        oas, "get_connection",
        lambda **_k: {"access_token": "t", "repository": "owner/repo"},
    )
    seen = _capture_github_connected(monkeypatch)

    oas.create_action_from_opportunity(
        business_id=bid,
        opportunity_id=str(opp.id),
        owner_id=uid,
        business_analysis={"business_summary": "x"},
    )

    assert seen["github_connected"] is True


def test_threads_connected_false_into_generate_action(db_session, monkeypatch):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid)
    bid = str(business.id)
    opp = _seed_opportunity(db_session, bid, uid)

    monkeypatch.setattr(oas, "get_connection", lambda **_k: None)
    seen = _capture_github_connected(monkeypatch)

    oas.create_action_from_opportunity(
        business_id=bid,
        opportunity_id=str(opp.id),
        owner_id=uid,
        business_analysis={"business_summary": "x"},
    )

    assert seen["github_connected"] is False
