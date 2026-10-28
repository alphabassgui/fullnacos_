import uuid
from datetime import datetime

import pytest
from werkzeug.security import generate_password_hash

from models import (
    Action,
    AgentRun,
    Business,
    Connection,
    Execution,
    GtmRun,
    Learning,
    Measurement,
    Observation,
    Opportunity,
    User,
)

# A syntactically valid UUID that is never seeded — the "unknown business" path
# (a non-UUID id also resolves to None, but a real UUID proves the Postgres miss).
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
# Postgres seed helpers. The parent business (slice c) and now its coupled
# pipeline children (agent_runs, opportunities, actions, ...) all live in
# Postgres (PR d-core), keyed by the business UUID.
# ──────────────────────────────────────────────


def seed_user(db_session, email="u1@example.com"):
    user = User(
        email=email,
        username="U",
        role="user",
        status="Active",
        password_hash=generate_password_hash("password123"),
    )
    db_session.add(user)
    db_session.commit()
    return user


def seed_business(db_session, owner_id, name="A", **overrides):
    fields = dict(owner_id=owner_id, name=name)
    fields.update(overrides)
    business = Business(**fields)
    db_session.add(business)
    db_session.commit()
    return business


def seed_agent_run(db_session, business_id, owner_id, **overrides):
    fields = dict(
        business_id=business_id,
        owner_id=owner_id,
        type="website_analysis",
        status="queued",
    )
    fields.update(overrides)
    run = AgentRun(**fields)
    db_session.add(run)
    db_session.commit()
    return run


def seed_opportunity(db_session, business_id, owner_id, **overrides):
    fields = dict(
        business_id=business_id,
        owner_id=owner_id,
        title="Add SEO",
        description="d",
        problem="p",
        evidence=["e"],
        potential_impact="high",
        confidence=0.9,
        type="seo",
    )
    fields.update(overrides)
    opp = Opportunity(**fields)
    db_session.add(opp)
    db_session.commit()
    return opp


def seed_action(db_session, business_id, owner_id, **overrides):
    fields = dict(
        business_id=business_id,
        owner_id=owner_id,
        action_type="social",
        status="approved",
    )
    fields.update(overrides)
    act = Action(**fields)
    db_session.add(act)
    db_session.commit()
    return act


def _count_pg_businesses(db_session, owner_id):
    return db_session.query(Business).filter_by(owner_id=owner_id).count()


def _login(client, user_id):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def test_app_boots_and_blueprints_register(flask_app):
    rules = {r.rule for r in flask_app.url_map.iter_rules()}
    assert "/api/business/<business_id>/analyze" in rules
    assert "/api/business/<business_id>/opportunities/<opportunity_id>" in rules
    assert "/api/business/<business_id>/runs/latest" in rules
    assert "/dashboard" in rules
    assert "/create-profile" in rules
    assert "/generate-logbook" in rules


# ─────────────────────────────────────────────────────────────
# analyze: the run record is a Postgres agent_runs row now. When the broker is
# down the route stamps that row failed (not a Firestore doc) and returns 503.
# ─────────────────────────────────────────────────────────────


def test_analyze_returns_503_and_fails_run_when_broker_down(db_session, monkeypatch, client):
    import routes.user as routes_user

    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://example.com")
    bid = str(business.id)

    def raise_broker(*args, **kwargs):
        raise RuntimeError("broker unreachable")

    monkeypatch.setattr(routes_user.analyze_business_website, "delay", raise_broker)

    _login(client, uid)

    resp = client.post(f"/api/business/{bid}/analyze", json={})
    assert resp.status_code == 503
    assert resp.get_json()["success"] is False

    # The Postgres agent_runs row for this business is marked failed.
    run = (
        db_session.query(AgentRun)
        .filter_by(business_id=bid)
        .order_by(AgentRun.created_at.desc())
        .first()
    )
    assert run is not None
    assert run.status == "failed"
    assert run.error == "broker unreachable"
    assert run.failed_at is not None


# ─────────────────────────────────────────────────────────────
# Read-only child routes (get_opportunity, get_latest_run) now read Postgres.
# ─────────────────────────────────────────────────────────────


@pytest.fixture
def seeded(db_session, client):
    """Owner u1 with one business + an opportunity and two agent_runs, all in
    Postgres. Returns the uid/bid and the seeded opportunity/run rows."""
    user = seed_user(db_session, email="u1@example.com")
    uid = str(user.id)
    business = seed_business(
        db_session, owner_id=uid, name="A", website_url="https://a.example"
    )
    bid = str(business.id)
    opp = seed_opportunity(
        db_session, bid, uid, title="Add SEO", description="d", problem="p",
        evidence=["e"], potential_impact="high", confidence=0.9, type="seo",
    )
    r1 = seed_agent_run(
        db_session, bid, uid, status="completed",
        observation_id=uuid.uuid4(), opportunity_ids=[str(opp.id)],
        created_at=datetime(2026, 9, 16, 0, 0, 0),
        completed_at=datetime(2026, 9, 16, 0, 0, 1),
    )
    r2 = seed_agent_run(
        db_session, bid, uid, status="running",
        created_at=datetime(2026, 9, 16, 1, 0, 0),
    )
    _login(client, uid)
    return type("S", (), {"uid": uid, "bid": bid, "opp": opp, "r1": r1, "r2": r2})()


def test_get_opportunity_returns_200_for_owner(client, seeded):
    resp = client.get(f"/api/business/{seeded.bid}/opportunities/{seeded.opp.id}")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["opportunity"]["id"] == str(seeded.opp.id)
    assert body["opportunity"]["title"] == "Add SEO"


def test_get_opportunity_404_unknown_id(client, seeded):
    resp = client.get(f"/api/business/{seeded.bid}/opportunities/{ABSENT_UUID}")
    assert resp.status_code == 404


def test_get_opportunity_403_for_non_owner(db_session, client):
    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), name="B")
    bid = str(business.id)
    opp = seed_opportunity(db_session, bid, str(owner.id), title="T")
    _login(client, str(caller.id))

    resp = client.get(f"/api/business/{bid}/opportunities/{opp.id}")
    assert resp.status_code == 403


def test_get_latest_run_returns_most_recent(client, seeded):
    resp = client.get(f"/api/business/{seeded.bid}/runs/latest")
    assert resp.status_code == 200
    run = resp.get_json()["run"]
    assert run["run_id"] == str(seeded.r2.id)
    assert run["status"] == "running"
    assert run["observation_id"] is None
    assert run["opportunity_ids"] is None


def test_get_latest_run_none_when_no_runs(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://a.example")
    _login(client, uid)

    resp = client.get(f"/api/business/{business.id}/runs/latest")
    assert resp.status_code == 200
    assert resp.get_json()["run"] is None


def test_get_latest_run_404_missing_business(client, seeded):
    resp = client.get(f"/api/business/{ABSENT_UUID}/runs/latest")
    assert resp.status_code == 404


def test_get_latest_run_403_non_owner(db_session, client):
    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), name="B")
    _login(client, str(caller.id))

    resp = client.get(f"/api/business/{business.id}/runs/latest")
    assert resp.status_code == 403


def test_get_latest_run_401_without_session(client, seeded):
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.get(f"/api/business/{seeded.bid}/runs/latest")
    assert resp.status_code == 401


def test_get_latest_run_returns_full_run_from_completed(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://a.example")
    bid = str(business.id)
    obs_id = uuid.uuid4()
    run = seed_agent_run(
        db_session, bid, uid, status="completed",
        observation_id=obs_id, opportunity_ids=["opp1"],
        created_at=datetime(2026, 9, 16, 0, 0, 0),
        completed_at=datetime(2026, 9, 16, 0, 0, 1),
    )
    _login(client, uid)

    resp = client.get(f"/api/business/{bid}/runs/latest")
    run_body = resp.get_json()["run"]
    assert run_body == {
        "run_id": str(run.id), "status": "completed", "observation_id": str(obs_id),
        "opportunity_ids": ["opp1"], "error": None,
        "created_at": "2026-09-16T00:00:00", "completed_at": "2026-09-16T00:00:01",
    }


# ─────────────────────────────────────────────────────────────
# create_business (POST /api/business): dedupe is a Postgres SELECT +
# partial-UNIQUE backstop. No Firestore write at all. Counts are Postgres rows.
# ─────────────────────────────────────────────────────────────


def test_create_first_business_returns_201(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    _login(client, uid)
    resp = client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    assert resp.status_code == 201
    assert resp.get_json()["success"] is True
    assert _count_pg_businesses(db_session, uid) == 1


def test_create_duplicate_website_returns_409_and_no_second_doc(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    _login(client, uid)
    first = client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    assert first.status_code == 201
    first_id = first.get_json()["business"]["id"]

    dup = client.post("/api/business", json={
        "name": "Acme Again", "website_url": "https://acme.example",
    })
    assert dup.status_code == 409
    body = dup.get_json()
    assert body["success"] is False
    assert body["error"] == "You already have a business with this website."
    assert body["existing_business"]["id"] == first_id
    assert _count_pg_businesses(db_session, uid) == 1


def test_create_different_website_same_owner_returns_201(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    _login(client, uid)
    client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    resp = client.post("/api/business", json={
        "name": "Beta", "website_url": "https://beta.example",
    })
    assert resp.status_code == 201
    assert _count_pg_businesses(db_session, uid) == 2


def test_create_name_only_not_blocked_even_repeated(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    _login(client, uid)
    first = client.post("/api/business", json={"name": "No Site Co"})
    assert first.status_code == 201
    second = client.post("/api/business", json={"name": "No Site Co"})
    assert second.status_code == 201
    assert _count_pg_businesses(db_session, uid) == 2


def test_create_same_website_different_owner_not_blocked(db_session, client):
    u1 = seed_user(db_session, email="u1@example.com")
    u2 = seed_user(db_session, email="u2@example.com")
    _login(client, str(u1.id))
    client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    _login(client, str(u2.id))
    resp = client.post("/api/business", json={
        "name": "Acme Clone", "website_url": "https://acme.example",
    })
    assert resp.status_code == 201
    assert _count_pg_businesses(db_session, str(u1.id)) == 1
    assert _count_pg_businesses(db_session, str(u2.id)) == 1


def test_create_unrelated_leaves_preexisting_business_untouched(db_session, client):
    # A user who already has one business (seeded directly) creating an unrelated
    # business is not blocked and keeps the original.
    user = seed_user(db_session)
    uid = str(user.id)
    existing = seed_business(
        db_session, owner_id=uid, name="Original", website_url="https://original.example",
    )
    existing_id = str(existing.id)
    _login(client, uid)
    resp = client.post("/api/business", json={
        "name": "New One", "website_url": "https://new.example",
    })
    assert resp.status_code == 201
    assert _count_pg_businesses(db_session, uid) == 2
    still_there = db_session.get(Business, existing_id)
    assert still_there is not None
    assert still_there.name == "Original"
    assert still_there.website_url == "https://original.example"


def test_create_unauthenticated_401(db_session, client):
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.post("/api/business", json={"name": "Acme"})
    assert resp.status_code == 401


def test_create_missing_name_400(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    _login(client, uid)
    resp = client.post("/api/business", json={"website_url": "https://acme.example"})
    assert resp.status_code == 400
    assert _count_pg_businesses(db_session, uid) == 0


# ─────────────────────────────────────────────────────────────
# delete_business (DELETE /api/business/<id>): deletes the Postgres business row;
# FK ON DELETE CASCADE removes all pipeline children (agent_runs, observations,
# opportunities, actions, executions, measurements, learnings, gtm_runs,
# connections). No Firestore interaction.
# ─────────────────────────────────────────────────────────────


def test_delete_cascades_subcollections(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://acme.example")
    bid = str(business.id)
    # Postgres children that must cascade-delete with the business row.
    opp = seed_opportunity(db_session, bid, uid)
    seed_action(db_session, bid, uid)
    seed_agent_run(db_session, bid, uid)
    _login(client, uid)

    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    # Postgres row gone AND its children cascaded via FK ON DELETE CASCADE.
    assert db_session.get(Business, bid) is None
    assert db_session.query(Opportunity).filter_by(business_id=bid).count() == 0
    assert db_session.query(Action).filter_by(business_id=bid).count() == 0
    assert db_session.query(AgentRun).filter_by(business_id=bid).count() == 0


def test_delete_non_owner_403_nothing_deleted(db_session, client):
    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), website_url="https://acme.example")
    bid = str(business.id)
    _login(client, str(caller.id))

    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 403
    assert db_session.get(Business, bid) is not None


def test_delete_missing_business_404(db_session, client):
    user = seed_user(db_session)
    _login(client, str(user.id))
    resp = client.delete(f"/api/business/{ABSENT_UUID}")
    assert resp.status_code == 404


def test_delete_unauthenticated_401(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://acme.example")
    bid = str(business.id)
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 401
    assert db_session.get(Business, bid) is not None


def test_delete_business_cascades_full_postgres_tree(db_session, client):
    """Deleting one business removes ALL Postgres descendants at every level via
    FK ON DELETE CASCADE; a second business under the same owner is untouched."""
    owner = seed_user(db_session)
    uid = str(owner.id)

    # Business 1: full multi-level tree
    biz1 = seed_business(db_session, owner_id=uid, website_url="https://b1.example")
    bid1 = str(biz1.id)

    conn1 = Connection(business_id=bid1, provider="github", status="connected", access_token="dummy")
    db_session.add(conn1)
    gtm1 = GtmRun(business_id=bid1, owner_id=uid, status="queued")
    db_session.add(gtm1)
    run1 = seed_agent_run(db_session, bid1, uid)
    obs1 = Observation(run_id=run1.id, business_id=bid1, owner_id=uid)
    db_session.add(obs1)
    opp1 = seed_opportunity(db_session, bid1, uid)
    act1 = seed_action(db_session, bid1, uid, opportunity_id=opp1.id)
    exc1 = Execution(business_id=bid1, owner_id=uid, status="queued")
    db_session.add(exc1)
    db_session.commit()
    meas1 = Measurement(business_id=bid1, execution_id=exc1.id, metric="clicks", value=1)
    db_session.add(meas1)
    lrn1 = Learning(business_id=bid1, execution_id=exc1.id, learning_type="outcome")
    db_session.add(lrn1)
    db_session.commit()

    # Save IDs before the delete — expire_all() + reload after cascade-delete raises.
    conn1_id = conn1.id
    gtm1_id = gtm1.id
    run1_id = run1.id
    opp1_id = opp1.id
    act1_id = act1.id
    exc1_id = exc1.id
    meas1_id = meas1.id
    lrn1_id = lrn1.id

    # Business 2: isolation check (same owner)
    biz2 = seed_business(db_session, owner_id=uid, website_url="https://b2.example")
    bid2 = str(biz2.id)
    conn2 = Connection(business_id=bid2, provider="github", status="connected", access_token="dummy2")
    db_session.add(conn2)
    db_session.commit()
    conn2_id = conn2.id

    _login(client, uid)
    resp = client.delete(f"/api/business/{bid1}")
    assert resp.status_code == 200

    db_session.expire_all()

    # Business 1 and all descendants gone
    assert db_session.get(Business, bid1) is None
    assert db_session.get(Connection, conn1_id) is None
    assert db_session.get(GtmRun, gtm1_id) is None
    assert db_session.get(AgentRun, run1_id) is None
    assert db_session.get(Observation, run1_id) is None  # run_id is PK
    assert db_session.get(Opportunity, opp1_id) is None
    assert db_session.get(Action, act1_id) is None
    assert db_session.get(Execution, exc1_id) is None
    assert db_session.get(Measurement, meas1_id) is None
    assert db_session.get(Learning, lrn1_id) is None

    # Business 2 and its children untouched
    assert db_session.get(Business, bid2) is not None
    assert db_session.get(Connection, conn2_id) is not None


# ─────────────────────────────────────────────────────────────
# approve_action idempotency (replaces the @firestore.transactional): a double
# approve creates exactly ONE execution, returns the SAME execution_id, and
# enqueues the task exactly once.
# ─────────────────────────────────────────────────────────────


def test_double_approve_one_execution_same_id_enqueued_once(db_session, monkeypatch, client):
    import routes.user as routes_user

    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://acme.example")
    bid = str(business.id)
    opp = seed_opportunity(db_session, bid, uid)
    action = seed_action(
        db_session, bid, uid, opportunity_id=opp.id, status="pending_approval",
    )
    aid = str(action.id)

    enqueues = []

    def fake_delay(business_id, execution_id):
        enqueues.append(execution_id)
        return type("T", (), {"id": f"task-{len(enqueues)}"})()

    monkeypatch.setattr(routes_user.execute_approved_action, "delay", fake_delay)
    _login(client, uid)

    first = client.post(f"/api/business/{bid}/actions/{aid}/approve")
    assert first.status_code == 202
    first_body = first.get_json()
    assert first_body["already_approved"] is False
    exec_id = first_body["execution_id"]

    second = client.post(f"/api/business/{bid}/actions/{aid}/approve")
    assert second.status_code == 200
    second_body = second.get_json()
    assert second_body["already_approved"] is True
    assert second_body["execution_id"] == exec_id

    # Exactly one execution row, and the task was enqueued exactly once.
    assert db_session.query(Execution).filter_by(action_id=aid).count() == 1
    assert enqueues == [exec_id]
