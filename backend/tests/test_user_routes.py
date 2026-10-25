import pytest


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


class FakeQuery:
    def __init__(self, exists, data=None):
        self._exists = exists
        self._data = data or {}

    @property
    def exists(self):
        return self._exists

    def to_dict(self):
        return dict(self._data)


class FakeRef:
    def __init__(self, db, path):
        self._db = db
        self.path = list(path)
        self.id = self.path[-1]
        self.updates = []
        self.collections = {}

    def get(self):
        if self.id == "b1":
            return FakeQuery(
                True,
                {"owner_id": "u1", "name": "Test Biz", "website_url": "https://example.com"},
            )
        return FakeQuery(False)

    def collection(self, sub):
        if sub not in self.collections:
            self.collections[sub] = FakeCollection(self._db, self.path + [sub])
        return self.collections[sub]

    def set(self, data):
        self._set = data

    def update(self, data):
        self.updates.append(data)


class FakeCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = list(path)
        self.docs = {}

    def document(self, doc_id=None):
        key = doc_id or "auto_run_id"
        path = self.path + [key]
        if key not in self.docs:
            self.docs[key] = FakeRef(self._db, path)
        return self.docs[key]


class FakeDb:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        if name not in self.collections:
            self.collections[name] = FakeCollection(self, [name])
        return self.collections[name]


def test_app_boots_and_blueprints_register(flask_app):
    rules = {r.rule for r in flask_app.url_map.iter_rules()}
    assert "/api/business/<business_id>/analyze" in rules
    assert "/api/business/<business_id>/opportunities/<opportunity_id>" in rules
    assert "/api/business/<business_id>/runs/latest" in rules
    assert "/dashboard" in rules
    assert "/create-profile" in rules
    assert "/generate-logbook" in rules


def test_analyze_returns_503_and_fails_run_when_broker_down(monkeypatch, flask_app, client):
    import routes.user as routes_user

    def raise_broker(*args, **kwargs):
        raise RuntimeError("broker unreachable")

    monkeypatch.setattr(routes_user.analyze_business_website, "delay", raise_broker)
    monkeypatch.setattr(routes_user, "db", FakeDb())

    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.post("/api/business/b1/analyze", json={})
    assert resp.status_code == 503
    assert resp.get_json()["success"] is False

    biz_ref = routes_user.db.collection("businesses").document("b1")
    run_ref = biz_ref.collection("agent_runs").document("auto_run_id")
    assert run_ref.updates, "run doc should have been updated"
    assert run_ref.updates[-1]["status"] == "failed"


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
def seeded(client, monkeypatch):
    import routes.user as routes_user

    seed = {
        ("businesses", "b1"): {
            "owner_id": "u1", "name": "A", "website_url": "https://a.example",
        },
        ("businesses", "b1", "opportunities", "opp1"): {
            "owner_id": "u1", "title": "Add SEO", "description": "d", "problem": "p",
            "evidence": ["e"], "potential_impact": "high", "confidence": 0.9,
            "type": "seo", "position": 0,
        },
        ("businesses", "b1", "agent_runs", "r1"): {
            "business_id": "b1", "owner_id": "u1", "type": "website_analysis",
            "status": "completed", "observation_id": "obs1",
            "opportunity_ids": ["opp1"],
            "created_at": "2026-09-16T00:00:00",
            "completed_at": "2026-09-16T00:00:01",
        },
        ("businesses", "b1", "agent_runs", "r2"): {
            "business_id": "b1", "owner_id": "u1", "type": "website_analysis",
            "status": "running",
            "created_at": "2026-09-16T01:00:00",
        },
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"
    return routes_user


def test_get_opportunity_returns_200_for_owner(client, seeded):
    resp = client.get("/api/business/b1/opportunities/opp1")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["opportunity"]["id"] == "opp1"
    assert body["opportunity"]["title"] == "Add SEO"


def test_get_opportunity_403_for_non_owner(client, seeded, monkeypatch):
    import routes.user as routes_user

    seed = {
        ("businesses", "b2"): {"owner_id": "u2", "name": "B", "website_url": "https://b.example"},
        ("businesses", "b2", "opportunities", "opp1"): {"owner_id": "u2", "title": "T"},
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"
    resp = client.get("/api/business/b2/opportunities/opp1")
    assert resp.status_code == 403


def test_get_latest_run_returns_most_recent(client, seeded):
    resp = client.get("/api/business/b1/runs/latest")
    assert resp.status_code == 200
    run = resp.get_json()["run"]
    assert run["run_id"] == "r2"
    assert run["status"] == "running"
    assert run["observation_id"] is None
    assert run["opportunity_ids"] is None


def test_get_latest_run_none_when_no_runs(client, seeded, monkeypatch):
    import routes.user as routes_user

    seed = {
        ("businesses", "b1"): {"owner_id": "u1", "name": "A", "website_url": "https://a.example"},
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"
    resp = client.get("/api/business/b1/runs/latest")
    assert resp.status_code == 200
    assert resp.get_json()["run"] is None


def test_get_latest_run_404_missing_business(client, seeded):
    resp = client.get("/api/business/nope/runs/latest")
    assert resp.status_code == 404


def test_get_latest_run_403_non_owner(client, seeded, monkeypatch):
    import routes.user as routes_user

    seed = {
        ("businesses", "b2"): {"owner_id": "u2", "name": "B", "website_url": "https://b.example"},
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"
    resp = client.get("/api/business/b2/runs/latest")
    assert resp.status_code == 403


def test_get_latest_run_401_without_session(client, seeded):
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.get("/api/business/b1/runs/latest")
    assert resp.status_code == 401


def test_get_latest_run_returns_full_run_from_completed(client, seeded, monkeypatch):
    import routes.user as routes_user

    seed = {
        ("businesses", "b1"): {"owner_id": "u1", "name": "A", "website_url": "https://a.example"},
        ("businesses", "b1", "agent_runs", "r1"): {
            "business_id": "b1", "owner_id": "u1", "type": "website_analysis",
            "status": "completed", "observation_id": "obs1", "opportunity_ids": ["opp1"],
            "created_at": "2026-09-16T00:00:00", "completed_at": "2026-09-16T00:00:01",
        },
    }
    monkeypatch.setattr(routes_user, "db", SeedFakeDb(seed))
    with client.session_transaction() as sess:
        sess["user_id"] = "u1"
    resp = client.get("/api/business/b1/runs/latest")
    run = resp.get_json()["run"]
    assert run == {
        "run_id": "r1", "status": "completed", "observation_id": "obs1",
        "opportunity_ids": ["opp1"], "error": None,
        "created_at": "2026-09-16T00:00:00", "completed_at": "2026-09-16T00:00:01",
    }


# ─────────────────────────────────────────────────────────────
# create_business (POST /api/business) + delete_business
# (DELETE /api/business/<id>) — dedupe guard + cascade delete.
#
# These need a fake Firestore that supports chained .where().where(),
# auto-id .document(), .delete(), and db.recursive_delete(ref) over
# nested subcollections, which the fakes above do not provide.
# ─────────────────────────────────────────────────────────────

import itertools


class CrudSnapshot:
    def __init__(self, data, doc_id):
        self.exists = data is not None
        self._data = dict(data) if data else {}
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class CrudQuery:
    """Supports chained .where(...).where(...).stream()."""

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


def _login(client, user_id="u1"):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def _count_businesses(db):
    return sum(1 for path in db._store if len(path) == 2 and path[0] == "businesses")


# ---- create_business: dedupe guard ----

def test_create_first_business_returns_201(crud_db, client):
    _login(client)
    resp = client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    assert resp.status_code == 201
    assert resp.get_json()["success"] is True
    assert _count_businesses(crud_db) == 1


def test_create_duplicate_website_returns_409_and_no_second_doc(crud_db, client):
    _login(client)
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
    # No second business doc was created.
    assert _count_businesses(crud_db) == 1


def test_create_different_website_same_owner_returns_201(crud_db, client):
    _login(client)
    client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    resp = client.post("/api/business", json={
        "name": "Beta", "website_url": "https://beta.example",
    })
    assert resp.status_code == 201
    assert _count_businesses(crud_db) == 2


def test_create_name_only_not_blocked_even_repeated(crud_db, client):
    _login(client)
    first = client.post("/api/business", json={"name": "No Site Co"})
    assert first.status_code == 201
    second = client.post("/api/business", json={"name": "No Site Co"})
    assert second.status_code == 201
    assert _count_businesses(crud_db) == 2


def test_create_same_website_different_owner_not_blocked(crud_db, client):
    _login(client, "u1")
    client.post("/api/business", json={
        "name": "Acme", "website_url": "https://acme.example",
    })
    _login(client, "u2")
    resp = client.post("/api/business", json={
        "name": "Acme Clone", "website_url": "https://acme.example",
    })
    assert resp.status_code == 201
    assert _count_businesses(crud_db) == 2


def test_create_unrelated_leaves_preexisting_business_untouched(crud_db, client):
    # A user who already has one business (seeded directly, not via the route)
    # creating an unrelated business is not blocked and keeps the original.
    crud_db._store[("businesses", "existing")] = {
        "owner_id": "u1", "name": "Original", "website_url": "https://original.example",
    }
    _login(client)
    resp = client.post("/api/business", json={
        "name": "New One", "website_url": "https://new.example",
    })
    assert resp.status_code == 201
    assert _count_businesses(crud_db) == 2
    assert crud_db._store[("businesses", "existing")] == {
        "owner_id": "u1", "name": "Original", "website_url": "https://original.example",
    }


def test_create_unauthenticated_401(crud_db, client):
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.post("/api/business", json={"name": "Acme"})
    assert resp.status_code == 401
    assert _count_businesses(crud_db) == 0


def test_create_missing_name_400(crud_db, client):
    _login(client)
    resp = client.post("/api/business", json={"website_url": "https://acme.example"})
    assert resp.status_code == 400
    assert _count_businesses(crud_db) == 0


# ---- delete_business: cascade ----

def _seed_business_with_subcollections(db, biz_id="b1", owner="u1"):
    db._store[("businesses", biz_id)] = {
        "owner_id": owner, "name": "Acme", "website_url": "https://acme.example",
    }
    db._store[("businesses", biz_id, "opportunities", "opp1")] = {"owner_id": owner}
    db._store[("businesses", biz_id, "opportunities", "opp2")] = {"owner_id": owner}
    db._store[("businesses", biz_id, "actions", "act1")] = {"owner_id": owner}
    db._store[("businesses", biz_id, "connections", "con1")] = {"owner_id": owner}
    db._store[("businesses", biz_id, "gtm_runs", "gtm1")] = {"owner_id": owner}


def test_delete_cascades_subcollections(crud_db, client):
    _seed_business_with_subcollections(crud_db)
    _login(client, "u1")

    resp = client.delete("/api/business/b1")
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    # Business doc AND every subcollection doc are gone.
    remaining = [p for p in crud_db._store if p[:2] == ("businesses", "b1")]
    assert remaining == []


def test_delete_non_owner_403_nothing_deleted(crud_db, client):
    _seed_business_with_subcollections(crud_db, owner="u2")
    before = dict(crud_db._store)
    _login(client, "u1")

    resp = client.delete("/api/business/b1")
    assert resp.status_code == 403
    assert crud_db._store == before


def test_delete_missing_business_404(crud_db, client):
    _login(client, "u1")
    resp = client.delete("/api/business/nope")
    assert resp.status_code == 404


def test_delete_unauthenticated_401(crud_db, client):
    _seed_business_with_subcollections(crud_db)
    before = dict(crud_db._store)
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.delete("/api/business/b1")
    assert resp.status_code == 401
    assert crud_db._store == before