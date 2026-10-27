import pytest
from werkzeug.security import generate_password_hash

from models import AgentRun, Business, Observation, Opportunity, User


VALID_OPPORTUNITY = {
    "title": "Add SEO",
    "description": "Desc",
    "problem": "Problem",
    "evidence": ["e1"],
    "potential_impact": "high",
    "confidence": 0.9,
    "type": "seo",
}


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def agent_modules(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    import agent.analyzer as analyzer_mod
    import agent.opportunity_generator as generator_mod
    return analyzer_mod, generator_mod


def _seed_business(db_session, website_url="https://acme.example"):
    """Seed a real Postgres user + business. Returns (bid, uid) as strings — the
    same shape the Celery task receives them as arguments."""
    user = User(
        email="owner@example.com",
        username="U",
        role="user",
        status="Active",
        password_hash=generate_password_hash("password123"),
    )
    db_session.add(user)
    db_session.commit()
    business = Business(owner_id=user.id, name="Acme", website_url=website_url)
    db_session.add(business)
    db_session.commit()
    return str(business.id), str(user.id)


def _observations(db_session, bid):
    return db_session.query(Observation).filter_by(business_id=bid).all()


def _opportunities(db_session, bid):
    return db_session.query(Opportunity).filter_by(business_id=bid).all()


def _run(db_session, run_id):
    db_session.expire_all()
    return db_session.get(AgentRun, run_id)


@pytest.fixture
def task_env(monkeypatch, agent_modules, db_session):
    import task as task_mod

    bid, uid = _seed_business(db_session)

    # The analyze_business route pre-creates the agent_run row before dispatch
    # (observations.run_id FKs agent_runs.id), so seed one here and pass its id.
    run = AgentRun(
        business_id=bid, owner_id=uid, type="website_analysis", status="queued"
    )
    db_session.add(run)
    db_session.commit()
    run_id = str(run.id)

    analyzer_mod, generator_mod = agent_modules
    monkeypatch.setattr(
        task_mod, "fetch_website_html",
        lambda url: ("<html><title>Acme</title></html>", url),
    )
    monkeypatch.setattr(
        task_mod, "analyze_html",
        lambda html: {"title": "Acme", "headings": [], "links": [], "meta_description": "Acme"},
    )
    monkeypatch.setattr(
        analyzer_mod, "analyze_observation",
        lambda observation: {"business_summary": "Acme sells widgets."},
    )
    monkeypatch.setattr(generator_mod, "generate_opportunities", lambda analysis: [])

    import services.opportunity_action_service as planner_mod

    # Default offline planner so no pipeline test touches the real planner.
    monkeypatch.setattr(
        planner_mod, "generate_actions_for_opportunities",
        lambda **kwargs: {"actions_created": 0, "actions_existing": 0},
    )

    return task_mod, db_session, bid, uid, run_id


def test_happy_path_persists_opportunities_and_completes_run(task_env, monkeypatch):
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(generator_mod, "generate_opportunities", lambda analysis: [
        dict(VALID_OPPORTUNITY),
        dict(VALID_OPPORTUNITY, title="Use Instagram", type="social", confidence=0.4),
    ])

    result = task_mod.analyze_business_website.run(bid, uid, run_id)

    assert result["success"] is True
    assert result["run_id"] == run_id
    assert len(result["opportunity_ids"]) == 2

    obs = _observations(db_session, bid)
    assert len(obs) == 1
    assert obs[0].analysis["title"] == "Acme"

    run = _run(db_session, run_id)
    assert run.status == "awaiting_approval"
    assert str(run.observation_id) == result["observation_id"]
    assert run.opportunity_ids == result["opportunity_ids"]

    opps = [db_session.get(Opportunity, oid) for oid in result["opportunity_ids"]]
    first = opps[0]
    assert first.title == "Add SEO"
    assert str(first.business_id) == bid
    assert str(first.owner_id) == uid
    assert first.created_at


def test_observation_groq_failure_marks_run_failed(task_env, monkeypatch):
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.analyzer as analyzer_mod

    monkeypatch.setattr(
        analyzer_mod, "analyze_observation",
        lambda observation: (_ for _ in ()).throw(RuntimeError("groq down")),
    )

    with pytest.raises(RuntimeError, match="groq down"):
        task_mod.analyze_business_website.run(bid, uid, run_id)

    run = _run(db_session, run_id)
    assert run.status == "failed"
    assert run.error == "groq down"
    assert len(_observations(db_session, bid)) == 1
    assert not _opportunities(db_session, bid)


def test_fetch_failure_fails_run_gracefully_without_raising(task_env, monkeypatch):
    """A blocked/unreachable site must end the run in a clean failed state the
    frontend can display — NOT crash the Celery task."""
    task_mod, db_session, bid, uid, run_id = task_env

    monkeypatch.setattr(
        task_mod, "fetch_website_html",
        lambda url: (_ for _ in ()).throw(ValueError("Website returned HTTP 403.")),
    )

    result = task_mod.analyze_business_website.run(bid, uid, run_id)

    assert result["success"] is False
    assert "403" in result["error"]

    run = _run(db_session, run_id)
    assert run.analysis_status == "failed"
    assert run.status == "failed"
    assert run.error == "Website returned HTTP 403."
    assert run.completed_at
    assert not _observations(db_session, bid)
    assert not _opportunities(db_session, bid)


def test_opportunity_groq_failure_marks_run_failed(task_env, monkeypatch):
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: (_ for _ in ()).throw(ValueError("bad JSON")),
    )

    with pytest.raises(ValueError, match="bad JSON"):
        task_mod.analyze_business_website.run(bid, uid, run_id)

    run = _run(db_session, run_id)
    assert run.status == "failed"
    assert run.error == "bad JSON"
    assert len(_observations(db_session, bid)) == 1
    assert not _opportunities(db_session, bid)


def test_invalid_opportunity_data_marks_run_failed(task_env, monkeypatch):
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod
    from agent.opportunity_validation import validate_opportunities

    broken = dict(VALID_OPPORTUNITY, problem_key="seo_visibility", confidence=2)

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: validate_opportunities([broken]),
    )

    with pytest.raises(ValueError, match="out of range"):
        task_mod.analyze_business_website.run(bid, uid, run_id)

    run = _run(db_session, run_id)
    assert run.status == "failed"
    assert len(_observations(db_session, bid)) == 1
    assert not _opportunities(db_session, bid)


def test_invalid_middle_opportunity_is_skipped_and_run_completes(task_env, monkeypatch):
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod
    import services.opportunity_service as opp_service
    import services.opportunity_action_service as planner_mod

    items = [
        dict(VALID_OPPORTUNITY, title="One"),
        dict(VALID_OPPORTUNITY, title="Bad", type="not-a-type"),
        dict(VALID_OPPORTUNITY, title="Three"),
    ]
    monkeypatch.setattr(
        generator_mod, "generate_opportunities", lambda analysis: items
    )

    def fake_create(business_id, opportunity, owner_id):
        if opportunity["title"] == "Bad":
            raise ValueError("Opportunity 1: type 'not-a-type' not in [...]")
        return {"id": f"opp-{opportunity['title']}"}

    monkeypatch.setattr(opp_service, "create_opportunity", fake_create)

    seen = {}

    def fake_planner(business_id, owner_id, business_analysis, opportunity_ids=None):
        seen["ids"] = list(opportunity_ids)
        return {"actions_created": len(opportunity_ids), "actions_existing": 0}

    monkeypatch.setattr(
        planner_mod, "generate_actions_for_opportunities", fake_planner
    )

    result = task_mod.analyze_business_website.run(bid, uid, run_id)

    assert result["success"] is True
    assert result["opportunity_ids"] == ["opp-One", "opp-Three"]
    assert "opp-Bad" not in result["opportunity_ids"]
    assert seen["ids"] == result["opportunity_ids"]

    run = _run(db_session, run_id)
    assert run.analysis_status == "completed"
    assert run.status == "awaiting_approval"
    assert run.opportunity_ids == result["opportunity_ids"]


def test_all_opportunities_skipped_still_completes_with_empty_ids(task_env, monkeypatch):
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod
    import services.opportunity_service as opp_service
    import services.opportunity_action_service as planner_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [
            dict(VALID_OPPORTUNITY, title="A"),
            dict(VALID_OPPORTUNITY, title="B"),
        ],
    )

    def fake_create(business_id, opportunity, owner_id):
        raise ValueError("every opportunity is invalid")

    monkeypatch.setattr(opp_service, "create_opportunity", fake_create)

    seen = {}

    def fake_planner(business_id, owner_id, business_analysis, opportunity_ids=None):
        seen["ids"] = list(opportunity_ids)
        return {"actions_created": 0, "actions_existing": 0}

    monkeypatch.setattr(
        planner_mod, "generate_actions_for_opportunities", fake_planner
    )

    result = task_mod.analyze_business_website.run(bid, uid, run_id)

    assert result["success"] is True
    assert result["opportunity_ids"] == []
    assert seen["ids"] == []

    run = _run(db_session, run_id)
    assert run.analysis_status == "completed"
    assert run.status == "awaiting_approval"
    assert run.opportunity_ids == []


def test_empty_opportunities_completes_run_with_no_docs(task_env):
    task_mod, db_session, bid, uid, run_id = task_env

    result = task_mod.analyze_business_website.run(bid, uid, run_id)

    run = _run(db_session, run_id)
    assert result["opportunity_ids"] == []
    assert run.status == "awaiting_approval"
    assert run.opportunity_ids == []
    assert not _opportunities(db_session, bid)


def test_observation_not_duplicated_on_rerun(task_env, monkeypatch):
    """acks_late redelivery: running analyze_business_website twice with the same
    run_id must leave exactly ONE observation row (PK upsert overwrites)."""
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [dict(VALID_OPPORTUNITY)],
    )

    first = task_mod.analyze_business_website.run(bid, uid, run_id)
    second = task_mod.analyze_business_website.run(bid, uid, run_id)

    obs = _observations(db_session, bid)
    assert len(obs) == 1
    assert str(obs[0].run_id) == run_id
    assert first["observation_id"] == run_id
    assert second["observation_id"] == run_id


def test_opportunities_not_duplicated_on_rerun(task_env, monkeypatch):
    """A second delivery must not create duplicate opportunities — the
    create_opportunity type+problem dedupe guard holds."""
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [
            dict(VALID_OPPORTUNITY, title="Add SEO", type="seo"),
            dict(VALID_OPPORTUNITY, title="Use Instagram", type="social"),
        ],
    )

    task_mod.analyze_business_website.run(bid, uid, run_id)
    task_mod.analyze_business_website.run(bid, uid, run_id)

    assert len(_opportunities(db_session, bid)) == 2  # not 4


def test_run_agent_cycle_skips_second_dispatch(task_env, monkeypatch):
    """acks_late redelivery of run_agent_cycle must NOT enqueue a second analysis
    child once the run already carries an analysis_task_id."""
    task_mod, db_session, bid, uid, run_id = task_env

    calls = []

    class _FakeAsyncResult:
        def __init__(self, task_id):
            self.id = task_id

    def fake_delay(**kwargs):
        calls.append(kwargs)
        return _FakeAsyncResult("analysis-task-123")

    monkeypatch.setattr(task_mod.analyze_business_website, "delay", fake_delay)

    first = task_mod.run_agent_cycle.run(bid, uid, run_id)
    assert first["success"] is True
    assert first["analysis_task_id"] == "analysis-task-123"
    assert first.get("already_dispatched") is not True
    assert len(calls) == 1
    assert _run(db_session, run_id).analysis_task_id == "analysis-task-123"

    second = task_mod.run_agent_cycle.run(bid, uid, run_id)
    assert second["already_dispatched"] is True
    assert second["analysis_task_id"] == "analysis-task-123"
    assert len(calls) == 1


def test_analyze_finds_postgres_only_business_not_falsely_missing(task_env, monkeypatch):
    """The business exists only in Postgres. analyze_business_website must resolve
    the parent via get_business_row and run to completion — never short-circuit
    with "Business not found"."""
    task_mod, db_session, bid, uid, run_id = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [dict(VALID_OPPORTUNITY)],
    )

    result = task_mod.analyze_business_website.run(bid, uid, run_id)

    assert result["success"] is True
    assert result.get("error") != "Business not found"
    run = _run(db_session, run_id)
    assert run.status == "awaiting_approval"
    assert run.error is None


def test_context_task_wraps_body_in_app_context():
    """The ContextTask base must push a Flask app context around every task body
    so the Postgres db.session lookups work in the worker."""
    import flask

    import task as task_mod

    seen = {}

    @task_mod.celery.task(name="tests.probe_app_context")
    def _probe():
        seen["in_context"] = flask.has_app_context()
        return "ok"

    result = _probe()

    assert result == "ok"
    assert seen["in_context"] is True
