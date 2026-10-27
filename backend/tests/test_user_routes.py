import itertools
from types import SimpleNamespace

import pytest
from werkzeug.security import generate_password_hash

from models import Business, User

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
# Postgres seed helpers. The parent business lives in Postgres now (slice c);
# its children (agent_runs, opportunities, actions, ...) stay on Firestore,
# keyed by the business UUID string.
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
# Firestore fake for the agent_runs child write in analyze (set + update).
# The parent ownership guard reads Postgres; this fake only backs the child.
# ─────────────────────────────────────────────────────────────


class FakeRef:
    def __init__(self, db, path):
        self._db = db
        self.path = list(path)
        self.id = self.path[-1]
        self.updates = []
        self.collections = {}
        self._set = None

    def get(self):
        return FakeQuery(self.path in self._db._existing)

    def collection(self, sub):
        if sub not in self.collections:
            self.collections[sub] = FakeCollection(self._db, self.path + [sub])
        return self.collections[sub]

    def set(self, data):
        self._set = data

    def update(self, data):
        self.updates.append(data)


class FakeQuery:
    def __init__(self, exists, data=None):
        self._exists = exists
        self._data = data or {}

    @property
    def exists(self):
        return self._exists

    def to_dict(self):
        return dict(self._data)


class FakeCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = list(path)
        self.docs = {}

    def document(self, doc_id=None):
        key = doc_id or "auto_run_id"
        if key not in self.docs:
            self.docs[key] = FakeRef(self._db, self.path + [key])
        return self.docs[key]


class FakeDb:
    def __init__(self):
        self.collections = {}
        self._existing = []

    def collection(self, name):
        if name not in self.collections:
            self.collections[name] = FakeCollection(self, [name])
        return self.collections[name]


def test_analyze_returns_503_and_fails_run_when_broker_down(db_session, monkeypatch, client):
    import routes.user as routes_user

    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://example.com")
    bid = str(business.id)

    def raise_broker(*args, **kwargs):
        raise RuntimeError("broker unreachable")

    monkeypatch.setattr(routes_user.analyze_business_website, "delay", raise_broker)
    monkeypatch.setattr(routes_user, "db", FakeDb())

    _login(client, uid)

    resp = client.post(f"/api/business/{bid}/analyze", json={})
    assert resp.status_code == 503
    assert resp.get_json()["success"] is False

    biz_ref = routes_user.db.collection("businesses").document(bid)
    run_ref = biz_ref.collection("agent_runs").document("auto_run_id")
    assert run_ref.updates, "run doc should have been updated"
    assert run_ref.updates[-1]["status"] == "failed"


# ─────────────────────────────────────────────────────────────
# Read-only child routes (get_opportunity, get_latest_run). Parent in Postgres,
# children in a read-only Firestore fake keyed by the business UUID string.
# NB: none of these seed a ("businesses", <uuid>) Firestore parent doc — the
# parent lives in Postgres only, so every one is a Category-B scenario.
# ─────────────────────────────────────────────────────────────


class SeedSnapshot:
    def __init__(self, data, doc_id):
        self.exists = data is not None
        self._data = dict(data) if data else {}
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class SeedCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = path

    def document(self, doc_id):
        return SeedRef(self._db, self.path + [doc_id])

    def stream(self):
        prefix = tuple(self.path)
        return [
            SeedSnapshot(data, path[-1])
            for path, data in self._db._seed.items()
            if len(path) == len(prefix) + 1 and path[: len(prefix)] == prefix
        ]


class SeedRef:
    def __init__(self, db, path):
        self._db = db
        self.path = path

    @property
    def id(self):
        return self.path[-1]

    def get(self):
        return SeedSnapshot(self._db._seed.get(tuple(self.path)), self.id)

    def collection(self, name):
        return SeedCollection(self._db, self.path + [name])


class SeedFakeDb:
    def __init__(self, seed):
        self._seed = {tuple(k): v for k, v in seed.items()}

    def collection(self, name):
        return SeedCollection(self, [name])


@pytest.fixture
def seeded(db_session, client, monkeypatch):
    """Owner u1 with one business (Postgres) + an opportunity and two agent_runs
    (Firestore, keyed by the business UUID). Returns the uid/bid and the module."""
    import routes.user as routes_user

    user = seed_user(db_session, email="u1@example.com")
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, name="A", website_url="https://a.example")
    bid = str(business.id)
    seed = {
        (("businesses", bid, "opportunities", "opp1")): {
            "owner_id": uid, "title": "Add SEO", "description": "d", "problem": "p",
            "evidence": ["e"], "potential_impact": "high", "confidence": 0.9,
            "type": "seo", "position": 0,
        },
        (("businesses", bid, "agent_runs", "r1")): {
            "business_id": bid, "owner_id": uid, "type": "website_analysis",
            "status": "completed", "observation_id": "obs1",
            "opportunity_ids": ["opp1"],
            "created_at": "2026-09-16T00:00:00",
            "completed_at": "2026-09-16T00:00:01",
        },
        (("businesses", bid, "agent_runs", "r2")): {
            "business_id": bid, "owner_id": uid, "type": "website_analysis",
            "status": "running",
            "created_at": "2026-09-16T01:00:00",
        },
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    _login(client, uid)
    return SimpleNamespace(routes_user=routes_user, uid=uid, bid=bid)


def test_get_opportunity_returns_200_for_owner(client, seeded):
    resp = client.get(f"/api/business/{seeded.bid}/opportunities/opp1")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["opportunity"]["id"] == "opp1"
    assert body["opportunity"]["title"] == "Add SEO"


def test_get_opportunity_403_for_non_owner(db_session, client, monkeypatch):
    import routes.user as routes_user

    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), name="B")
    bid = str(business.id)
    seed = {
        (("businesses", bid, "opportunities", "opp1")): {
            "owner_id": str(owner.id), "title": "T",
        },
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    _login(client, str(caller.id))

    resp = client.get(f"/api/business/{bid}/opportunities/opp1")
    assert resp.status_code == 403


def test_get_latest_run_returns_most_recent(client, seeded):
    resp = client.get(f"/api/business/{seeded.bid}/runs/latest")
    assert resp.status_code == 200
    run = resp.get_json()["run"]
    assert run["run_id"] == "r2"
    assert run["status"] == "running"
    assert run["observation_id"] is None
    assert run["opportunity_ids"] is None


def test_get_latest_run_none_when_no_runs(db_session, client, monkeypatch):
    import routes.user as routes_user

    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://a.example")
    monkeypatch.setattr(routes_user, "db", SeedFakeDb({}))
    _login(client, uid)

    resp = client.get(f"/api/business/{business.id}/runs/latest")
    assert resp.status_code == 200
    assert resp.get_json()["run"] is None


def test_get_latest_run_404_missing_business(client, seeded):
    resp = client.get(f"/api/business/{ABSENT_UUID}/runs/latest")
    assert resp.status_code == 404


def test_get_latest_run_403_non_owner(db_session, client, monkeypatch):
    import routes.user as routes_user

    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), name="B")
    monkeypatch.setattr(routes_user, "db", SeedFakeDb({}))
    _login(client, str(caller.id))

    resp = client.get(f"/api/business/{business.id}/runs/latest")
    assert resp.status_code == 403


def test_get_latest_run_401_without_session(client, seeded):
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.get(f"/api/business/{seeded.bid}/runs/latest")
    assert resp.status_code == 401


def test_get_latest_run_returns_full_run_from_completed(db_session, client, monkeypatch):
    import routes.user as routes_user

    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://a.example")
    bid = str(business.id)
    seed = {
        (("businesses", bid, "agent_runs", "r1")): {
            "business_id": bid, "owner_id": uid, "type": "website_analysis",
            "status": "completed", "observation_id": "obs1", "opportunity_ids": ["opp1"],
            "created_at": "2026-09-16T00:00:00", "completed_at": "2026-09-16T00:00:01",
        },
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    _login(client, uid)

    resp = client.get(f"/api/business/{bid}/runs/latest")
    run = resp.get_json()["run"]
    assert run == {
        "run_id": "r1", "status": "completed", "observation_id": "obs1",
        "opportunity_ids": ["opp1"], "error": None,
        "created_at": "2026-09-16T00:00:00", "completed_at": "2026-09-16T00:00:01",
    }


# ─────────────────────────────────────────────────────────────
# Category-B regression: a child write survives the parent leaving Firestore.
# With NO ("businesses", <uuid>) Firestore parent doc present, a child document
# addressed by the business UUID is still readable through the route. This is
# the explicit proof that subcollections persist independently of the parent.
# ─────────────────────────────────────────────────────────────


def test_child_survives_without_firestore_parent_doc(db_session, client, monkeypatch):
    import routes.user as routes_user

    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://a.example")
    bid = str(business.id)

    fs = CrudDb()
    # Deliberately NO ("businesses", bid) parent doc in Firestore — only the child.
    fs._store[("businesses", bid, "agent_runs", "r1")] = {
        "business_id": bid, "owner_id": uid, "status": "completed",
        "observation_id": "obs1", "opportunity_ids": ["opp1"],
        "created_at": "2026-09-16T00:00:00", "completed_at": "2026-09-16T00:00:01",
    }
    monkeypatch.setattr(routes_user, "db", fs)
    _login(client, uid)

    resp = client.get(f"/api/business/{bid}/runs/latest")
    assert resp.status_code == 200
    run = resp.get_json()["run"]
    assert run["run_id"] == "r1"
    assert run["status"] == "completed"
    # The parent business doc never existed in Firestore — it lives in Postgres.
    assert ("businesses", bid) not in fs._store


# ─────────────────────────────────────────────────────────────
# create_business (POST /api/business): dedupe is a Postgres SELECT now +
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
# delete_business (DELETE /api/business/<id>): deletes the Postgres row, then
# recursively deletes the Firestore children addressed by the same UUID string.
# ─────────────────────────────────────────────────────────────


class CrudSnapshot:
    def __init__(self, data, doc_id):
        self.exists = data is not None
        self._data = dict(data) if data else {}
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class CrudQuery:
    def __init__(self, db, parent_path, filters):
        self._db = db
        self._parent_path = tuple(parent_path)
        self._filters = list(filters)

    def where(self, *args, **kwargs):
        if kwargs.get("filter") is not None:
            f = kwargs["filter"]
            field, op, value = f.field_path, f.op_string, f.value
        else:
            field, op, value = args[:3]
        return CrudQuery(self._db, self._parent_path, self._filters + [(field, op, value)])

    def stream(self):
        out = []
        for path, data in self._db._store.items():
            if len(path) != len(self._parent_path) + 1:
                continue
            if path[: len(self._parent_path)] != self._parent_path:
                continue
            if all(op == "==" and data.get(field) == value
                   for field, op, value in self._filters):
                out.append(CrudSnapshot(data, path[-1]))
        return iter(out)


class CrudRef:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)
        self.id = self.path[-1]

    def get(self):
        return CrudSnapshot(self._db._store.get(self.path), self.id)

    def set(self, data):
        self._db._store[self.path] = dict(data)

    def delete(self):
        self._db._store.pop(self.path, None)

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

    def where(self, *args, **kwargs):
        return CrudQuery(self._db, self.path, []).where(*args, **kwargs)

    def stream(self):
        return CrudQuery(self._db, self.path, []).stream()


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
    fs._store[("businesses", bid, "opportunities", "opp1")] = {"owner_id": owner}
    fs._store[("businesses", bid, "opportunities", "opp2")] = {"owner_id": owner}
    fs._store[("businesses", bid, "actions", "act1")] = {"owner_id": owner}
    fs._store[("businesses", bid, "connections", "con1")] = {"owner_id": owner}
    fs._store[("businesses", bid, "gtm_runs", "gtm1")] = {"owner_id": owner}


def test_delete_cascades_subcollections(db_session, crud_db, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid, website_url="https://acme.example")
    bid = str(business.id)
    _seed_firestore_children(crud_db, bid, uid)
    _login(client, uid)

    resp = client.delete(f"/api/business/{bid}")
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    # Postgres row gone AND every Firestore subcollection doc gone.
    assert db_session.get(Business, bid) is None
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
