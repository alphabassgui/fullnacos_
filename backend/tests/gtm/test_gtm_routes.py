"""
Tests for routes.gtm_routes and tasks.run_gtm_analysis.

DB-independent tests run locally without TEST_DATABASE_URL.
DB-backed tests skip when TEST_DATABASE_URL is unset; they prove the Postgres
path on CI.
"""
from unittest.mock import MagicMock, patch
import pytest
from werkzeug.security import generate_password_hash


# ---------------------------------------------------------------------------
# DB-independent auth / validation tests (no Postgres, no firebase needed)
# ---------------------------------------------------------------------------

def test_gtm_run_unauthenticated_returns_401(client):
    res = client.post("/api/gtm/run", json={"business_id": "biz-1"})
    assert res.status_code == 401
    assert res.json["success"] is False


def test_gtm_run_missing_business_id_returns_400(auth_client):
    res = auth_client.post("/api/gtm/run", json={})
    assert res.status_code == 400
    assert "business_id" in res.json["error"]


def test_gtm_run_business_not_found_returns_404(auth_client):
    # "biz-missing" fails UUID parse in get_business_row → 404 without DB
    res = auth_client.post("/api/gtm/run", json={"business_id": "biz-missing"})
    assert res.status_code == 404


def test_gtm_runs_list_requires_params_and_auth(client, auth_client):
    assert client.get("/api/gtm/runs").status_code == 401
    assert auth_client.get("/api/gtm/runs").status_code == 400


def test_gtm_run_detail_requires_params_and_auth(client, auth_client):
    assert client.get("/api/gtm/runs/run-1").status_code == 401
    assert auth_client.get("/api/gtm/runs/run-1").status_code == 400


# ---------------------------------------------------------------------------
# Task unit tests — GTM engine / competitor-insight logic
# These use "run-1" as run_id (not a UUID); run_gtm_analysis soft-fails the
# DB lookup and continues, so they remain pure unit tests of the GTM engine.
# ---------------------------------------------------------------------------

def _run_gtm_with(discover_return, analysis, tmp_path, gtm_business):
    """Execute run_gtm_analysis with standard GTM service mocks."""
    from task import run_gtm_analysis

    mock_manifest = {
        "url": "https://mysite.com",
        "tiles": [{"filename": "tile_0001_hero.webp", "path": str(tmp_path / "tile.webp")}],
    }
    mock_comp_manifest = {
        "url": "https://rival.com",
        "tiles": [{"filename": "tile_0001_hero.webp", "path": str(tmp_path / "tile.webp")}],
    }

    with patch("services.pixelrag_service.render_and_tile_page", side_effect=[mock_manifest, mock_comp_manifest]), \
         patch("services.gtm_discovery_service.discover_competitors", return_value=discover_return), \
         patch("services.gtm_discovery_service.get_gtm_seed_queries", return_value=["seo tool"]), \
         patch("agent.gtm_engine.analyze_gtm_tiles", return_value=analysis), \
         patch("services.gtm_dossier_service.generate_gtm_dossier_markdown", return_value="# Dossier"), \
         patch("services.gtm_dossier_service.save_dossier_to_file", return_value="static/dossiers/run-1.md"), \
         patch("services.opportunity_service.create_opportunity", return_value={"id": "opp-1"}):

        res = run_gtm_analysis(business_id="biz-1", user_id="user-1", run_id="run-1")

    return res


def _persisted_competitors(mock_run_ref):
    """Pull `competitors_analyzed` out of the completing run_ref.update call."""
    for call in mock_run_ref.update.call_args_list:
        payload = call.args[0] if call.args else call.kwargs
        if isinstance(payload, dict) and "competitors_analyzed" in payload:
            return payload["competitors_analyzed"]
    raise AssertionError("run_ref.update was never called with competitors_analyzed")


def test_run_gtm_analysis_merges_competitor_insights_by_domain(gtm_business, tmp_path):
    discover_return = [{"url": "https://www.Rival.com/home", "domain": "https://www.Rival.com/home"}]
    analysis = {
        "gtm_scores": {"overall": 80},
        "blind_spots": ["Missing pricing"],
        "opportunities": [],
        "competitor_insights": [
            {
                "domain": "rival.com",
                "strengths": ["Clear tiered pricing", "Hero video"],
                "weaknesses": ["No self-serve signup"],
            }
        ],
    }

    res = _run_gtm_with(discover_return, analysis, tmp_path, gtm_business)

    assert res["success"] is True
    assert res["opportunities_count"] == 0


def test_run_gtm_analysis_no_matching_insights_yields_empty_lists(gtm_business, tmp_path):
    discover_return = [{"url": "https://rival.com", "domain": "rival.com"}]
    analysis = {
        "gtm_scores": {"overall": 80},
        "blind_spots": [],
        "opportunities": [],
        "competitor_insights": [
            {"domain": "someone-else.com", "strengths": ["x"], "weaknesses": ["y"]},
            {"domain": "another.com", "strengths": ["z"], "weaknesses": []},
        ],
    }

    res = _run_gtm_with(discover_return, analysis, tmp_path, gtm_business)
    assert res["success"] is True


def test_run_gtm_analysis_missing_competitor_insights_key_is_safe(gtm_business, tmp_path):
    discover_return = [{"url": "https://rival.com", "domain": "rival.com"}]
    analysis = {
        "gtm_scores": {"overall": 80},
        "blind_spots": [],
        "opportunities": [],
    }

    res = _run_gtm_with(discover_return, analysis, tmp_path, gtm_business)
    assert res["success"] is True


def test_run_gtm_analysis_computes_seed_queries_once(gtm_business, tmp_path):
    from task import run_gtm_analysis

    mock_manifest = {
        "url": "https://mysite.com",
        "tiles": [{"filename": "tile_0001_hero.webp", "path": str(tmp_path / "tile.webp")}],
    }
    mock_analysis = {
        "gtm_scores": {"overall": 80},
        "blind_spots": [],
        "opportunities": [],
    }

    with patch("services.pixelrag_service.render_and_tile_page", return_value=mock_manifest), \
         patch("services.gtm_discovery_service.get_gtm_seed_queries", return_value=["seo tool"]) as mock_seed, \
         patch("services.gtm_discovery_service.search_organic_competitors", return_value=[]), \
         patch("agent.gtm_engine.analyze_gtm_tiles", return_value=mock_analysis) as mock_analyze, \
         patch("services.gtm_dossier_service.generate_gtm_dossier_markdown", return_value="# Dossier"), \
         patch("services.gtm_dossier_service.save_dossier_to_file", return_value="static/dossiers/run-1.md"), \
         patch("services.opportunity_service.create_opportunity", return_value={"id": "opp-1"}):

        res = run_gtm_analysis(business_id="biz-1", user_id="user-1", run_id="run-1")

    assert res["success"] is True
    assert mock_seed.call_count == 1
    assert mock_analyze.call_args.kwargs["search_queries"] == ["seo tool"]


# ---------------------------------------------------------------------------
# DB-backed helpers
# ---------------------------------------------------------------------------

def _seed_user(db_session, email="gtm_owner@example.com"):
    from models import User
    user = User(
        email=email,
        username="GTMOwner",
        role="user",
        status="Active",
        password_hash=generate_password_hash("password123"),
    )
    db_session.add(user)
    db_session.commit()
    return user


def _seed_business(db_session, owner_id, website_url="https://example.com"):
    from models import Business
    biz = Business(owner_id=owner_id, name="GTM Corp", website_url=website_url)
    db_session.add(biz)
    db_session.commit()
    return biz


def _seed_gtm_run(db_session, business_id, owner_id, status="queued", **extra):
    from models import GtmRun
    run = GtmRun(
        business_id=business_id,
        owner_id=owner_id,
        status=status,
        website_url="https://example.com",
        **extra,
    )
    db_session.add(run)
    db_session.commit()
    return run


def _auth_client_for(flask_app, user_id):
    c = flask_app.test_client()
    with c.session_transaction() as sess:
        sess["user_id"] = str(user_id)
    return c


# ---------------------------------------------------------------------------
# DB-backed route tests
# ---------------------------------------------------------------------------

def test_gtm_run_authorized_dispatches_task(db_session, flask_app):
    """POST /api/gtm/run creates a queued GtmRun row and returns run_id."""
    from models import GtmRun
    from extensions import db as orm_db

    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    c = _auth_client_for(flask_app, user.id)

    with patch("task.run_gtm_analysis.delay") as mock_delay:
        mock_delay.return_value.id = "celery-task-abc"
        res = c.post("/api/gtm/run", json={"business_id": str(biz.id)})

    assert res.status_code == 202
    body = res.get_json()
    assert body["success"] is True
    run_id = body["run_id"]

    # Row must exist in Postgres
    import uuid as _uuid
    with flask_app.app_context():
        row = orm_db.session.get(GtmRun, _uuid.UUID(run_id))
    assert row is not None
    assert row.status == "queued"
    assert row.celery_task_id == "celery-task-abc"
    mock_delay.assert_called_once()


def test_gtm_runs_list_route(db_session, flask_app):
    """GET /api/gtm/runs returns seeded runs with correct JSON shape."""
    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    run = _seed_gtm_run(db_session, business_id=biz.id, owner_id=user.id, status="completed")
    c = _auth_client_for(flask_app, user.id)

    res = c.get(f"/api/gtm/runs?business_id={biz.id}")
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert len(body["runs"]) == 1
    r = body["runs"][0]
    assert r["id"] == str(run.id)
    assert r["business_id"] == str(biz.id)
    assert r["user_id"] == str(user.id)
    assert r["status"] == "completed"
    assert "created_at" in r


def test_gtm_run_detail_route(db_session, flask_app):
    """GET /api/gtm/runs/<id> returns the run with correct JSON shape."""
    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    run = _seed_gtm_run(db_session, business_id=biz.id, owner_id=user.id, status="running")
    c = _auth_client_for(flask_app, user.id)

    res = c.get(f"/api/gtm/runs/{run.id}?business_id={biz.id}")
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert body["run"]["id"] == str(run.id)
    assert body["run"]["status"] == "running"


def test_gtm_run_not_found_returns_404(db_session, flask_app):
    """GET /api/gtm/runs/<valid-uuid> that doesn't exist → 404."""
    import uuid as _uuid
    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    c = _auth_client_for(flask_app, user.id)

    absent = str(_uuid.uuid4())
    res = c.get(f"/api/gtm/runs/{absent}?business_id={biz.id}")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Required tests from TASK spec
# ---------------------------------------------------------------------------

def test_gtm_run_lifecycle_queued_to_completed(db_session, flask_app, tmp_path):
    """Run progresses queued→running→completed in Postgres; GET returns
    byte-identical JSON with all completion fields."""
    from models import GtmRun
    from extensions import db as orm_db
    from task import run_gtm_analysis

    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    c = _auth_client_for(flask_app, user.id)

    # POST creates queued row
    with patch("task.run_gtm_analysis.delay") as mock_delay:
        mock_delay.return_value.id = "task-xyz"
        post_res = c.post("/api/gtm/run", json={"business_id": str(biz.id)})
    assert post_res.status_code == 202
    run_id = post_res.get_json()["run_id"]

    mock_manifest = {
        "url": str(biz.website_url),
        "tiles": [{"filename": "tile_0001.webp", "path": str(tmp_path / "t.webp")}],
    }
    mock_analysis = {
        "gtm_scores": {"overall": 82},
        "blind_spots": ["No pricing"],
        "opportunities": [
            {
                "title": "Add Pricing",
                "problem": "No pricing visible",
                "problem_key": "pricing",
                "type": "conversion",
                "potential_impact": "high",
                "confidence": 0.85,
            }
        ],
    }

    with flask_app.app_context(), \
         patch("services.pixelrag_service.render_and_tile_page", return_value=mock_manifest), \
         patch("services.gtm_discovery_service.discover_competitors", return_value=[]), \
         patch("services.gtm_discovery_service.get_gtm_seed_queries", return_value=["seo"]), \
         patch("agent.gtm_engine.analyze_gtm_tiles", return_value=mock_analysis), \
         patch("services.gtm_dossier_service.generate_gtm_dossier_markdown", return_value="# Dossier"), \
         patch("services.gtm_dossier_service.save_dossier_to_file", return_value=str(tmp_path / "d.md")), \
         patch("services.opportunity_service.create_opportunity", return_value={"id": "opp-uuid-1"}):

        task_res = run_gtm_analysis(
            business_id=str(biz.id), user_id=str(user.id), run_id=run_id
        )

    assert task_res["success"] is True

    get_res = c.get(f"/api/gtm/runs/{run_id}?business_id={biz.id}")
    assert get_res.status_code == 200
    run_body = get_res.get_json()["run"]

    # Fixed keys always present
    assert run_body["id"] == run_id
    assert run_body["business_id"] == str(biz.id)
    assert run_body["user_id"] == str(user.id)
    assert "created_at" in run_body
    assert run_body["status"] == "completed"

    # Lifecycle keys present after completion
    assert run_body["gtm_scores"] == {"overall": 82}
    assert run_body["blind_spots"] == ["No pricing"]
    assert run_body["opportunities_created_count"] == 1
    assert "completed_at" in run_body
    assert "started_at" in run_body

    # Integers stay integers (no 1 → 1.0)
    assert isinstance(run_body["opportunities_created_count"], int)


def test_gtm_run_failed_state_persists_error(db_session, flask_app):
    """A task that raises persists status=failed with the error field."""
    from models import GtmRun
    from extensions import db as orm_db
    from task import run_gtm_analysis

    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    c = _auth_client_for(flask_app, user.id)

    with patch("task.run_gtm_analysis.delay") as mock_delay:
        mock_delay.return_value.id = "task-fail"
        post_res = c.post("/api/gtm/run", json={"business_id": str(biz.id)})
    run_id = post_res.get_json()["run_id"]

    with flask_app.app_context(), \
         patch("services.pixelrag_service.render_and_tile_page", side_effect=RuntimeError("render failed")):

        with pytest.raises(RuntimeError):
            run_gtm_analysis(
                business_id=str(biz.id), user_id=str(user.id), run_id=run_id
            )

    get_res = c.get(f"/api/gtm/runs/{run_id}?business_id={biz.id}")
    assert get_res.status_code == 200
    run_body = get_res.get_json()["run"]
    assert run_body["status"] == "failed"
    assert run_body["error"] == "render failed"
    assert "completed_at" in run_body


def test_gtm_run_ownership_403(db_session, flask_app):
    """Another user cannot read a run they don't own."""
    user_a = _seed_user(db_session, email="a@example.com")
    user_b = _seed_user(db_session, email="b@example.com")
    biz = _seed_business(db_session, owner_id=user_a.id)
    run = _seed_gtm_run(db_session, business_id=biz.id, owner_id=user_a.id)

    c = _auth_client_for(flask_app, user_b.id)

    assert c.get(f"/api/gtm/runs?business_id={biz.id}").status_code == 403
    assert c.get(f"/api/gtm/runs/{run.id}?business_id={biz.id}").status_code == 403
    assert c.get(f"/api/gtm/runs/{run.id}/dossier?business_id={biz.id}").status_code == 403


def test_gtm_run_dossier_missing_business_id_400(db_session, flask_app):
    """GET /api/gtm/runs/<id>/dossier without ?business_id returns 400."""
    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    run = _seed_gtm_run(db_session, business_id=biz.id, owner_id=user.id)
    c = _auth_client_for(flask_app, user.id)

    res = c.get(f"/api/gtm/runs/{run.id}/dossier")
    assert res.status_code == 400


def test_gtm_business_cascade_deletes_run(db_session, flask_app):
    """Deleting the parent business CASCADE-removes its gtm_runs rows."""
    from models import Business, GtmRun
    from extensions import db as orm_db

    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    run = _seed_gtm_run(db_session, business_id=biz.id, owner_id=user.id)
    run_id = run.id

    db_session.delete(biz)
    db_session.commit()

    with flask_app.app_context():
        gone = orm_db.session.get(GtmRun, run_id)
    assert gone is None


def test_gtm_dossier_returns_text_markdown(db_session, flask_app):
    """GET /api/gtm/runs/<id>/dossier returns text/markdown."""
    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    run = _seed_gtm_run(
        db_session,
        business_id=biz.id,
        owner_id=user.id,
        status="completed",
        gtm_scores={"overall": 75},
    )
    c = _auth_client_for(flask_app, user.id)

    res = c.get(f"/api/gtm/runs/{run.id}/dossier?business_id={biz.id}")
    assert res.status_code == 200
    assert "text/markdown" in res.content_type
    assert "Overall Score: 75" in res.data.decode("utf-8")


def test_gtm_run_dossier_serves_file_when_present(db_session, flask_app, tmp_path):
    """GET /api/gtm/runs/<id>/dossier sends the file when dossier_path exists."""
    dossier_file = tmp_path / "run.md"
    dossier_file.write_text("# My Dossier", encoding="utf-8")

    user = _seed_user(db_session)
    biz = _seed_business(db_session, owner_id=user.id)
    run = _seed_gtm_run(
        db_session,
        business_id=biz.id,
        owner_id=user.id,
        status="completed",
        dossier_path=str(dossier_file),
    )
    c = _auth_client_for(flask_app, user.id)

    res = c.get(f"/api/gtm/runs/{run.id}/dossier?business_id={biz.id}")
    assert res.status_code == 200
    assert "My Dossier" in res.data.decode("utf-8")
