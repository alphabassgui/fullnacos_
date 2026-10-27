from types import SimpleNamespace

import pytest


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


# Minimal Firestore fake, mirroring tests/test_business_api.py's BizDb but
# extended so streamed snapshots expose `.reference.delete()` -- which
# delete_connection relies on to hard-delete each matching connection doc.


class FakeSnapshot:
    def __init__(self, db, path, data):
        self._db = db
        self.path = tuple(path)
        self.id = self.path[-1]
        self.exists = data is not None
        self._data = dict(data) if data else {}

    def to_dict(self):
        return dict(self._data)

    @property
    def reference(self):
        return FakeRef(self._db, self.path)


class FakeQuery:
    def __init__(self, db, parent_path, filters):
        self._db = db
        self._parent_path = tuple(parent_path)
        self._filters = list(filters)

    def where(self, field, op, value):
        return FakeQuery(
            self._db,
            self._parent_path,
            self._filters + [(field, op, value)],
        )

    def stream(self):
        results = []
        for path, data in self._db._store.items():
            if len(path) != len(self._parent_path) + 1:
                continue
            if path[: len(self._parent_path)] != self._parent_path:
                continue
            if all(
                op == "==" and data.get(field) == value
                for field, op, value in self._filters
            ):
                results.append(FakeSnapshot(self._db, path, data))
        return iter(results)


class FakeRef:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)
        self.id = self.path[-1]

    def get(self):
        return FakeSnapshot(self._db, self.path, self._db._store.get(self.path))

    def set(self, data):
        self._db._store[self.path] = dict(data)

    def delete(self):
        self._db._store.pop(self.path, None)

    def collection(self, name):
        return FakeCollection(self._db, self.path + (name,))


class FakeCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)

    def document(self, doc_id):
        return FakeRef(self._db, self.path + (doc_id,))

    def where(self, field, op, value):
        return FakeQuery(self._db, self.path, [(field, op, value)])


class FakeDb:
    def __init__(self):
        self._store = {}

    def collection(self, name):
        return FakeCollection(self, (name,))


def seed_doc(db, path, data):
    db._store[tuple(path)] = dict(data)


@pytest.fixture
def fake_db(monkeypatch):
    # delete_connection (in services.connection_service) is what touches
    # Firestore; the DELETE route delegates all db work to it.
    import services.connection_service as connection_service

    db = FakeDb()
    monkeypatch.setattr(connection_service, "db", db)
    # Slice c: the parent business lives in Postgres now and is resolved via
    # get_business_row; the connections subcollection stays on Firestore (the
    # FakeDb above). "b1" is not a UUID, so the real lookup would return None —
    # patch it to an owner-matched row so the connection path is exercised.
    business = SimpleNamespace(id="b1", owner_id="u1", name="Biz")
    monkeypatch.setattr(
        connection_service,
        "get_business_row",
        lambda business_id: business if business_id == "b1" else None,
    )
    return db


def test_disconnect_removes_connection_and_returns_200(fake_db, client):
    seed_doc(fake_db, ("businesses", "b1"), {"owner_id": "u1", "name": "Biz"})
    conn_path = ("businesses", "b1", "connections", "c1")
    seed_doc(
        fake_db,
        conn_path,
        {"provider": "github", "status": "connected", "account_id": "octocat"},
    )

    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.delete("/api/connections/github/connection?business_id=b1")

    assert resp.status_code == 200
    assert resp.get_json() == {"success": True}
    # The connection doc was hard-deleted from Firestore.
    assert conn_path not in fake_db._store


def test_disconnect_404_when_nothing_connected(fake_db, client):
    seed_doc(fake_db, ("businesses", "b1"), {"owner_id": "u1", "name": "Biz"})

    with client.session_transaction() as sess:
        sess["user_id"] = "u1"

    resp = client.delete("/api/connections/github/connection?business_id=b1")

    assert resp.status_code == 404
    assert resp.get_json() == {
        "success": False,
        "error": "GitHub connection not found",
    }


def test_disconnect_401_when_unauthenticated(fake_db, client):
    seed_doc(fake_db, ("businesses", "b1"), {"owner_id": "u1", "name": "Biz"})
    conn_path = ("businesses", "b1", "connections", "c1")
    seed_doc(
        fake_db,
        conn_path,
        {"provider": "github", "status": "connected"},
    )

    with client.session_transaction() as sess:
        sess.clear()

    resp = client.delete("/api/connections/github/connection?business_id=b1")

    assert resp.status_code == 401
    assert resp.get_json() == {
        "success": False,
        "error": "Authentication required",
    }
    # No deletion should have been attempted.
    assert conn_path in fake_db._store
