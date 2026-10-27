import itertools
import uuid
from datetime import datetime

import pytest
from werkzeug.security import generate_password_hash

from models import Action, AgentRun, Business, Execution, Opportunity, User

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
# delete_business (DELETE /api/business/<id>): deletes the Postgres row (its
# Postgres children cascade via ON DELETE CASCADE), then recursively deletes the
# remaining Firestore children (connections, gtm_runs) addressed by the same
# UUID string. The Firestore fake below backs only that recursive_delete.
# ─────────────────────────────────────────────────────────────


class CrudRef:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)
        self.id = self.path[-1]

    def collection(self, name):
        return CrudCollection(self._db, self.path + (name,))


class CrudCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)

    def document(self, doc_id=None):
        if doc_id is None:
            doc_id = f"auto-{next(self._db._ids)}"
        return CrudRef(self._db, self.path + (doc_id,))


class CrudDb:
    def __init__(self):
        self._store = {}
        self._ids = itertools.count(1)

    def collection(self, name):
        return CrudCollection(self, (name,))

    def recursive_delete(self, ref):
        prefix = tuple(ref.path)
        for path in [p for p in self._store if p[: len(prefix)] == prefix]:
            del self._store[path]


@pytest.fixture
def crud_db(monkeypatch):
    import routes.user as routes_user

    db = CrudDb()
    monkeypatch.setattr(routes_user, "db", db)
    return db


def _seed_firestore_children(fs, bid, owner):
    # Only the children still living in Firestore this slice (connections,
    # gtm_runs). opportunities/actions/etc. are Postgres rows now.
    fs._store[("businesses", bid, "connections", "con1")] = {"owner_id": owner}
    fs._store[("businesses", bid, "gtm_runs", "gtm1")] = {"owner_id": owner}


def test_delete_cascades_subcollections(db_session, crud_db, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://acme.example")
    bid = str(business.id)
    # Postgres children that must cascade-delete with the business row.
    opp = seed_opportunity(db_session, bid, uid)
    seed_action(db_session, bid, uid)
    seed_agent_run(db_session, bid, uid)
    # Firestore children that recursive_delete must still reap.
    _seed_firestore_children(crud_db, bid, uid)
    _login(client, uid)

    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    # Postgres row gone AND its Postgres children cascaded.
    assert db_session.get(Business, bid) is None
    assert db_session.query(Opportunity).filter_by(business_id=bid).count() == 0
    assert db_session.query(Action).filter_by(business_id=bid).count() == 0
    assert db_session.query(AgentRun).filter_by(business_id=bid).count() == 0
    # Firestore connections/gtm_runs recursively deleted.
    remaining = [p for p in crud_db._store if p[:2] == ("businesses", bid)]
    assert remaining == []


def test_delete_non_owner_403_nothing_deleted(db_session, crud_db, client):
    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), website_url="https://acme.example")
    bid = str(business.id)
    _seed_firestore_children(crud_db, bid, str(owner.id))
    before = dict(crud_db._store)
    _login(client, str(caller.id))

    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 403
    assert crud_db._store == before
    assert db_session.get(Business, bid) is not None


def test_delete_missing_business_404(db_session, crud_db, client):
    user = seed_user(db_session)
    _login(client, str(user.id))
    resp = client.delete(f"/api/business/{ABSENT_UUID}")
    assert resp.status_code == 404


def test_delete_unauthenticated_401(db_session, crud_db, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://acme.example")
    bid = str(business.id)
    _seed_firestore_children(crud_db, bid, uid)
    before = dict(crud_db._store)
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 401
    assert crud_db._store == before
    assert db_session.get(Business, bid) is not None


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
