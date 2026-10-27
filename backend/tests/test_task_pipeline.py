import pytest
from werkzeug.security import generate_password_hash

from models import Business, User


class _Snapshot:
    def __init__(self, data, doc_id=None):
        self.exists = data is not None
        self._data = dict(data) if data else {}
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class _Query:
    """Minimal fake of a Firestore query: supports a single '==' filter + stream()."""

    def __init__(self, snapshots):
        self._snapshots = list(snapshots)

    def stream(self):
        return iter(self._snapshots)


class _Ref:
    _auto = 0

    def __init__(self, path, data=None):
        self.path = list(path)
        self.id = self.path[-1]
        self._set_data = dict(data) if data else None
        self.updates = []
        self.children = {}

    def get(self):
        # Reflect update()s (not just set()) so reads see the merged state, as
        # real Firestore does — the re-dispatch guard reads analysis_task_id,
        # which is written via update().
        if self._set_data is None and not self.updates:
            return _Snapshot(None, self.id)
        return _Snapshot(self.data, self.id)

    @property
    def data(self):
        state = dict(self._set_data or {})
        for update in self.updates:
            state.update(update)
        return state

    def set(self, data):
        self._set_data = dict(data)

    def update(self, data):
        self.updates.append(dict(data))

    def collection(self, name):
        if name not in self.children:
            self.children[name] = _Collection(self.path + [name])
        return self.children[name]


def _new_id():
    _Ref._auto += 1
    return f"doc{_Ref._auto}"


class _Collection:
    def __init__(self, path):
        self.path = list(path)
        self.docs = {}

    def document(self, doc_id=None):
        if doc_id is None:
            doc_id = _new_id()
        if doc_id not in self.docs:
            self.docs[doc_id] = _Ref(self.path + [doc_id])
        return self.docs[doc_id]

    def where(self, *args, **kwargs):
        """Supports a single FieldFilter '==' query, as used by
        services.opportunity_service.find_existing_opportunity."""
        filt = kwargs.get("filter")
        if filt is not None:
            field, op, value = filt.field_path, filt.op_string, filt.value
        else:
            field, op, value = args[:3]
        matches = []
        for doc_id, ref in self.docs.items():
            record = ref.data
            if op == "==" and record.get(field) == value:
                matches.append(_Snapshot(record, doc_id))
        return _Query(matches)


class FakeTaskDb:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        if name not in self.collections:
            self.collections[name] = _Collection([name])
        return self.collections[name]


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
    """Seed a real Postgres user + business (slice c: the parent business lives in
    Postgres now). Returns (bid, uid) as strings — the same shape the Celery task
    receives them as arguments."""
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


@pytest.fixture
def task_env(monkeypatch, agent_modules, db_session):
    import task as task_mod

    bid, uid = _seed_business(db_session)

    # Children (agent_runs, observations, opportunities, ...) stay on Firestore,
    # keyed by the business UUID string — with NO parent business doc present, so
    # these tests also exercise the Category-B property (subcollections survive the
    # parent leaving Firestore).
    db = FakeTaskDb()
    biz_ref = db.collection("businesses").document(bid)
    biz_ref.collection("agent_runs").document("r1").set(
        {"business_id": bid, "owner_id": uid, "type": "website_analysis", "status": "queued"}
    )

    analyzer_mod, generator_mod = agent_modules
    monkeypatch.setattr(task_mod, "db", db)
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

    import services.opportunity_service as opp_service_mod
    import services.opportunity_action_service as planner_mod

    # Default offline planner so no pipeline test touches the real planner against
    # live Firestore. Tests that assert planner behavior override this locally.
    monkeypatch.setattr(
        planner_mod, "generate_actions_for_opportunities",
        lambda **kwargs: {"actions_created": 0, "actions_existing": 0},
    )
    # Redirect the opportunity service's own db binding to the fake store so the
    # real create_opportunity persists into the inspectable fake, not Firestore.
    monkeypatch.setattr(opp_service_mod, "db", db)

    return task_mod, db, bid, uid


def test_happy_path_persists_opportunities_and_completes_run(task_env, monkeypatch):
    task_mod, db, bid, uid = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(generator_mod, "generate_opportunities", lambda analysis: [
        dict(VALID_OPPORTUNITY),
        dict(VALID_OPPORTUNITY, title="Use Instagram", type="social", confidence=0.4),
    ])

    result = task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")

    assert result["success"] is True
    assert result["run_id"] == "r1"
    assert len(result["opportunity_ids"]) == 2

    obs_docs = list(biz_ref.collection("observations").docs.values())
    assert len(obs_docs) == 1
    assert obs_docs[0].data["analysis"]["title"] == "Acme"

    terminal = [u for u in run_ref.updates if u.get("status") == "awaiting_approval"]
    assert terminal == [run_ref.updates[-1]]
    assert run_ref.data["status"] == "awaiting_approval"
    assert run_ref.data["observation_id"] == result["observation_id"]
    assert run_ref.data["opportunity_ids"] == result["opportunity_ids"]

    # create_opportunity does not persist a `position` field, so inspect the
    # opportunities in insertion order (== creation order == opportunity_ids order).
    opp_docs = list(biz_ref.collection("opportunities").docs.values())
    assert [ref.id for ref in opp_docs] == result["opportunity_ids"]
    first = opp_docs[0].data
    assert first["title"] == "Add SEO"
    assert first["business_id"] == bid
    assert first["owner_id"] == uid
    assert first["created_at"]
    for key in ("title", "description", "problem", "evidence",
                "potential_impact", "confidence", "type"):
        assert key in first


def test_observation_groq_failure_marks_run_failed(task_env, monkeypatch):
    task_mod, db, bid, uid = task_env
    import agent.analyzer as analyzer_mod

    monkeypatch.setattr(
        analyzer_mod, "analyze_observation",
        lambda observation: (_ for _ in ()).throw(RuntimeError("groq down")),
    )

    with pytest.raises(RuntimeError, match="groq down"):
        task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")
    assert run_ref.data["status"] == "failed"
    assert run_ref.data["error"] == "groq down"
    assert len(biz_ref.collection("observations").docs) == 1
    assert not biz_ref.collection("opportunities").docs


def test_fetch_failure_fails_run_gracefully_without_raising(task_env, monkeypatch):
    """A blocked/unreachable site (both the plain request and the Playwright
    fallback failed) must end the run in a clean failed state the frontend can
    display — NOT crash the Celery task. This is the core regression this fix
    exists to prevent.
    """
    task_mod, db, bid, uid = task_env

    monkeypatch.setattr(
        task_mod, "fetch_website_html",
        lambda url: (_ for _ in ()).throw(ValueError("Website returned HTTP 403.")),
    )

    # Must NOT raise — returns a graceful failure envelope instead.
    result = task_mod.analyze_business_website.run(bid, uid, "r1")

    assert result["success"] is False
    assert "403" in result["error"]

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")
    assert run_ref.data["analysis_status"] == "failed"
    assert run_ref.data["status"] == "failed"
    assert run_ref.data["error"] == "Website returned HTTP 403."
    assert run_ref.data["completed_at"]
    # Run short-circuits before any observation/opportunity work.
    assert not biz_ref.collection("observations").docs
    assert not biz_ref.collection("opportunities").docs


def test_opportunity_groq_failure_marks_run_failed(task_env, monkeypatch):
    task_mod, db, bid, uid = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: (_ for _ in ()).throw(ValueError("bad JSON")),
    )

    with pytest.raises(ValueError, match="bad JSON"):
        task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")
    assert run_ref.data["status"] == "failed"
    assert run_ref.data["error"] == "bad JSON"
    assert len(biz_ref.collection("observations").docs) == 1
    assert not biz_ref.collection("opportunities").docs


def test_invalid_opportunity_data_marks_run_failed(task_env, monkeypatch):
    task_mod, db, bid, uid = task_env
    import agent.opportunity_generator as generator_mod
    from agent.opportunity_validation import validate_opportunities

    # Give a valid problem_key (a required field per opportunity_validation) so the
    # item fails specifically on the out-of-range confidence, not the missing key.
    broken = dict(VALID_OPPORTUNITY, problem_key="seo_visibility", confidence=2)

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: validate_opportunities([broken]),
    )

    with pytest.raises(ValueError, match="out of range"):
        task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")
    assert run_ref.data["status"] == "failed"
    assert len(biz_ref.collection("observations").docs) == 1
    assert not biz_ref.collection("opportunities").docs


def test_invalid_middle_opportunity_is_skipped_and_run_completes(task_env, monkeypatch):
    task_mod, db, bid, uid = task_env
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

    result = task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")

    # Run completes; the two valid opportunities persist, the bad one is skipped.
    assert result["success"] is True
    assert result["opportunity_ids"] == ["opp-One", "opp-Three"]
    assert "opp-Bad" not in result["opportunity_ids"]
    # The planner received exactly the surviving ids.
    assert seen["ids"] == result["opportunity_ids"]
    # Terminal state is completed, not failed.
    assert run_ref.data["analysis_status"] == "completed"
    assert run_ref.data["status"] == "awaiting_approval"
    assert run_ref.data["opportunity_ids"] == result["opportunity_ids"]
    assert not any(u.get("analysis_status") == "failed" for u in run_ref.updates)


def test_all_opportunities_skipped_still_completes_with_empty_ids(task_env, monkeypatch):
    task_mod, db, bid, uid = task_env
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
        # Must not crash on an empty list; record what it received.
        seen["ids"] = list(opportunity_ids)
        return {"actions_created": 0, "actions_existing": 0}

    monkeypatch.setattr(
        planner_mod, "generate_actions_for_opportunities", fake_planner
    )

    # No exception even though all opportunities were skipped.
    result = task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")

    assert result["success"] is True
    assert result["opportunity_ids"] == []
    assert seen["ids"] == []
    assert run_ref.data["analysis_status"] == "completed"
    assert run_ref.data["status"] == "awaiting_approval"
    assert run_ref.data["opportunity_ids"] == []
    assert not any(u.get("analysis_status") == "failed" for u in run_ref.updates)


def test_empty_opportunities_completes_run_with_no_docs(task_env):
    task_mod, db, bid, uid = task_env

    result = task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")
    assert result["opportunity_ids"] == []
    assert run_ref.data["status"] == "awaiting_approval"
    assert run_ref.data["opportunity_ids"] == []
    assert not biz_ref.collection("opportunities").docs


def test_observation_not_duplicated_on_rerun(task_env, monkeypatch):
    """acks_late redelivery: running analyze_business_website twice with the same
    run_id must leave exactly ONE observation doc (deterministic id overwrites)."""
    task_mod, db, bid, uid = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [dict(VALID_OPPORTUNITY)],
    )

    first = task_mod.analyze_business_website.run(bid, uid, "r1")
    second = task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    obs_docs = biz_ref.collection("observations").docs
    assert len(obs_docs) == 1
    # Deterministic id == run_id, and the result envelope stays correct.
    assert "r1" in obs_docs
    assert first["observation_id"] == "r1"
    assert second["observation_id"] == "r1"


def test_opportunities_not_duplicated_on_rerun(task_env, monkeypatch):
    """A second delivery of analyze_business_website must not create duplicate
    opportunities — the create_opportunity type+problem dedupe guard holds."""
    task_mod, db, bid, uid = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [
            dict(VALID_OPPORTUNITY, title="Add SEO", type="seo"),
            dict(VALID_OPPORTUNITY, title="Use Instagram", type="social"),
        ],
    )

    task_mod.analyze_business_website.run(bid, uid, "r1")
    task_mod.analyze_business_website.run(bid, uid, "r1")

    biz_ref = db.collection("businesses").document(bid)
    opp_docs = biz_ref.collection("opportunities").docs
    assert len(opp_docs) == 2  # not 4


def test_run_agent_cycle_skips_second_dispatch(task_env, monkeypatch):
    """acks_late redelivery of run_agent_cycle must NOT enqueue a second analysis
    child once the run already carries an analysis_task_id."""
    task_mod, db, bid, uid = task_env

    calls = []

    class _FakeAsyncResult:
        def __init__(self, task_id):
            self.id = task_id

    def fake_delay(**kwargs):
        calls.append(kwargs)
        return _FakeAsyncResult("analysis-task-123")

    monkeypatch.setattr(task_mod.analyze_business_website, "delay", fake_delay)

    biz_ref = db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("r1")

    first = task_mod.run_agent_cycle.run(bid, uid, "r1")
    assert first["success"] is True
    assert first["analysis_task_id"] == "analysis-task-123"
    assert first.get("already_dispatched") is not True
    assert len(calls) == 1
    assert run_ref.data["analysis_task_id"] == "analysis-task-123"

    second = task_mod.run_agent_cycle.run(bid, uid, "r1")
    assert second["already_dispatched"] is True
    assert second["analysis_task_id"] == "analysis-task-123"
    # No second child enqueued.
    assert len(calls) == 1


def test_analyze_finds_postgres_only_business_not_falsely_missing(task_env, monkeypatch):
    """Slice-c regression: the business exists ONLY in Postgres (no Firestore
    parent doc). analyze_business_website must resolve the parent via the Postgres
    `get_business_row` lookup and run to completion — it must NOT short-circuit
    with "Business not found" the way the old Firestore `.get().exists` check
    would once the parent left Firestore."""
    task_mod, db, bid, uid = task_env
    import agent.opportunity_generator as generator_mod

    monkeypatch.setattr(
        generator_mod, "generate_opportunities",
        lambda analysis: [dict(VALID_OPPORTUNITY)],
    )

    # No Firestore parent business doc is seeded by task_env — the only record of
    # the business is the Postgres row. (The business id resolves a Firestore ref,
    # but that doc does not "exist" in Firestore.)
    assert db.collection("businesses").document(bid).get().exists is False

    result = task_mod.analyze_business_website.run(bid, uid, "r1")

    assert result["success"] is True
    assert result.get("error") != "Business not found"
    run_ref = db.collection("businesses").document(bid).collection("agent_runs").document("r1")
    assert run_ref.data["status"] == "awaiting_approval"
    assert not any(u.get("error") == "Business not found" for u in run_ref.updates)


def test_context_task_wraps_body_in_app_context():
    """The ContextTask base (added for slice c) must push a Flask app context
    around every task body so the Postgres `db.session` lookups work in the
    worker, which never pushes one itself. Calling the task object (not `.run`)
    goes through `ContextTask.__call__`; the body observes an active app context."""
    import flask

    import task as task_mod

    seen = {}

    @task_mod.celery.task(name="tests.probe_app_context")
    def _probe():
        seen["in_context"] = flask.has_app_context()
        return "ok"

    # Invoking the task object routes through Task.__call__ -> ContextTask.__call__.
    result = _probe()

    assert result == "ok"
    assert seen["in_context"] is True