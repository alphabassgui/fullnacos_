import itertools as _itertools
import uuid

import pytest
from werkzeug.security import check_password_hash, generate_password_hash

from models import SecurityLog, User, UserSession

# A syntactically valid UUID that is never seeded — used for the "unknown user"
# paths, where a non-UUID string would fail to bind and surface as a 500.
ABSENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


@pytest.fixture(autouse=True)
def clean_auth_state(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6399/15")
    import routes.auth as routes_auth
    routes_auth.login_attempts.clear()
    routes_auth.locked_ips.clear()
    routes_auth.registration_log.clear()


# ──────────────────────────────────────────────
# Fake Firestore for the collections that STAY on Firestore this slice
# (student_profiles routing, businesses/agent_runs onboarding evidence).
# Users / sessions / security_logs now live in Postgres (the db_session fixture).
# ──────────────────────────────────────────────


class AuthSnapshot:
    def __init__(self, data, doc_id):
        self.exists = data is not None
        self._data = dict(data) if data else {}
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class AuthQuery:
    def __init__(self, snapshots):
        self._snapshots = list(snapshots)

    def limit(self, n):
        return AuthQuery(self._snapshots[:n])

    def stream(self):
        return iter(self._snapshots)

    def get(self):
        return list(self._snapshots)


class AuthRef:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)
        self.id = self.path[-1]
        self.updates = []

    @property
    def data(self):
        state = dict(self._db._store.get(self.path) or {})
        for item in self.updates:
            state.update(item)
        return state

    def get(self):
        return AuthSnapshot(self._db._store.get(self.path), self.id)

    def collection(self, name):
        return AuthCollection(self._db, self.path + (name,))

    def set(self, data):
        self._db._store[self.path] = dict(data)

    def update(self, data):
        self.updates.append(dict(data))
        self._db._store[self.path] = dict(self.data)


class AuthCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)

    def document(self, doc_id=None):
        if doc_id is None:
            doc_id = f"auto-{len(self)}"
        return AuthRef(self._db, self.path + (doc_id,))

    def where(self, *args, **kwargs):
        filt = kwargs.get("filter")
        if filt is not None:
            field, op, value = filt.field_path, filt.op_string, filt.value
        else:
            field, op, value = args[:3]
        found = []
        for path, data in self._db._store.items():
            if len(path) == len(self.path) + 1 and path[: len(self.path)] == self.path:
                if op == "==" and data.get(field) == value:
                    found.append(AuthSnapshot(data, path[-1]))
        return AuthQuery(found)

    def __len__(self):
        return sum(
            1 for path in self._db._store
            if len(path) == len(self.path) + 1 and path[: len(self.path)] == self.path
        )

    def stream(self):
        return iter([
            AuthSnapshot(data, path[-1])
            for path, data in self._db._store.items()
            if len(path) == len(self.path) + 1 and path[: len(self.path)] == self.path
        ])


class AuthDb:
    def __init__(self):
        self._store = {}

    def collection(self, name):
        return AuthCollection(self, (name,))


@pytest.fixture
def fs(monkeypatch):
    """Patch the Firestore handle used by the routes that still read Firestore
    (login's student_profiles lookup, /me onboarding evidence)."""
    import routes.auth as routes_auth
    import routes.auth_api as auth_api

    db = AuthDb()
    monkeypatch.setattr(routes_auth, "db", db)
    monkeypatch.setattr(auth_api, "db", db)
    return db


# ──────────────────────────────────────────────
# Postgres seed helpers (operate on the transactional db_session fixture).
# ──────────────────────────────────────────────


def seed_user(db_session, email="alice@example.com", password="password123",
              username="Alice", role="user", status="Active", **overrides):
    fields = dict(
        email=email,
        username=username,
        role=role,
        status=status,
        password_hash=generate_password_hash(password) if password else None,
    )
    fields.update(overrides)
    user = User(**fields)
    db_session.add(user)
    db_session.commit()
    return user


def seed_session(db_session, user_id, token, device_id=None):
    db_session.add(UserSession(token=token, user_id=user_id, device_id=device_id))
    db_session.commit()


def post_json(client, path, body, ip):
    return client.post(path, json=body, headers={"X-Forwarded-For": ip})


# ══════════════════════════════════════════════
# Blueprint registration (no DB)
# ══════════════════════════════════════════════

def test_register_blueprint_registered(flask_app):
    rules = {r.rule for r in flask_app.url_map.iter_rules()}
    assert "/api/auth/register" in rules


def test_api_auth_blueprint_registered(flask_app):
    rules = {r.rule for r in flask_app.url_map.iter_rules()}
    for rule in ("/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/me"):
        assert rule in rules


# ══════════════════════════════════════════════
# Register
# ══════════════════════════════════════════════

def test_register_creates_user(db_session, client):
    resp = post_json(client, "/api/auth/register", {
        "username": "Alice",
        "email": "Alice@Example.com",
        "password": "password123",
    }, "10.0.0.1")

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["success"] is True
    # The id is now a DB-generated UUID, returned as a string.
    uuid.UUID(body["user_id"])

    user = db_session.query(User).filter(User.email == "alice@example.com").one()
    assert str(user.id) == body["user_id"]
    assert user.username == "Alice"
    assert user.role == "user"
    assert user.status == "Active"
    assert user.has_completed_onboarding is False
    assert user.password_hash != "password123"
    assert check_password_hash(user.password_hash, "password123") is True


def test_register_missing_fields(client):
    for body in ({}, {"username": "A", "password": "password123"}, {"username": "A", "email": "a@b.co"}):
        resp = post_json(client, "/api/auth/register", body, "10.0.0.2")
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "All fields are required."


def test_register_short_password(client):
    resp = post_json(client, "/api/auth/register", {
        "username": "Bob",
        "email": "bob@example.com",
        "password": "123",
    }, "10.0.0.3")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Password must be at least 8 characters."


def test_register_duplicate_email(db_session, client):
    # The UNIQUE(email) constraint (citext, case-insensitive) rejects the
    # duplicate on commit → IntegrityError → the same 409 response.
    seed_user(db_session, email="used@example.com", username="Used")

    resp = post_json(client, "/api/auth/register", {
        "username": "Dup",
        "email": "Used@Example.com",
        "password": "password123",
    }, "10.0.0.4")

    assert resp.status_code == 409
    assert resp.get_json()["error"] == "Email already registered. Please login or use another email."
    # No second row was created.
    assert db_session.query(User).filter(User.email == "used@example.com").count() == 1


def test_register_rate_limit(db_session, client):
    ip = "10.0.0.9"
    for i in range(3):
        resp = post_json(client, "/api/auth/register", {
            "username": f"R{i}", "email": f"r{i}@example.com", "password": "password123",
        }, ip)
        assert resp.status_code == 201
    resp = post_json(client, "/api/auth/register", {
        "username": "R4", "email": "r4@example.com", "password": "password123",
    }, ip)
    assert resp.status_code == 429
    assert resp.get_json()["error"] == "Too many registrations from this IP. Try again later."


def test_register_500_on_unexpected_error(client, monkeypatch):
    import routes.auth_api as auth_api

    def boom(ip):
        raise RuntimeError("limiter down")

    monkeypatch.setattr(auth_api.auth, "check_registration_limit", boom)

    resp = post_json(client, "/api/auth/register", {
        "username": "C",
        "email": "c@example.com",
        "password": "password123",
    }, "10.0.0.5")

    assert resp.status_code == 500
    assert resp.get_json()["success"] is False


# ══════════════════════════════════════════════
# Login — sessions now live in user_sessions (one row per device)
# ══════════════════════════════════════════════

def test_login_success_sets_session(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)

    resp = post_json(client, "/api/auth/login", {
        "email": "alice@example.com", "password": "password123",
    }, "5.6.7.8")

    assert resp.status_code == 200
    assert resp.get_json() == {
        "success": True, "user_id": uid, "email": "alice@example.com", "role": "user",
    }

    with client.session_transaction() as sess:
        assert sess["user_id"] == uid
        assert sess["email"] == "alice@example.com"
        assert sess["role"] == "user"
        token = sess["session_token"]
    assert len(token) == 128
    # A user_sessions row was INSERTed for this device.
    row = db_session.query(UserSession).filter_by(token=token).one()
    assert str(row.user_id) == uid


def test_second_login_does_not_invalidate_first(db_session, client):
    # Core regression: a second login must NOT drop the first device's row —
    # both user_sessions rows stay valid.
    user = seed_user(db_session)
    uid = str(user.id)

    resp1 = post_json(client, "/api/auth/login", {
        "email": "alice@example.com", "password": "password123",
    }, "5.6.7.8")
    assert resp1.status_code == 200
    with client.session_transaction() as sess:
        token1 = sess["session_token"]

    resp2 = post_json(client, "/api/auth/login", {
        "email": "alice@example.com", "password": "password123",
    }, "9.8.7.6")
    assert resp2.status_code == 200
    with client.session_transaction() as sess:
        token2 = sess["session_token"]

    assert token1 != token2
    tokens = {
        t for (t,) in db_session.query(UserSession.token).filter_by(user_id=uid).all()
    }
    assert token1 in tokens
    assert token2 in tokens
    assert len(tokens) == 2


def test_login_wrong_password_increments_attempts(db_session, client):
    import routes.auth as routes_auth
    seed_user(db_session)

    resp = post_json(client, "/api/auth/login", {
        "email": "alice@example.com", "password": "wrongpass",
    }, "5.6.7.9")

    assert resp.status_code == 401
    assert resp.get_json()["error"] == "Invalid credentials."
    assert routes_auth.login_attempts.get("5.6.7.9", 0) == 1


def test_login_unknown_email_returns_401(db_session, client):
    import routes.auth as routes_auth

    resp = post_json(client, "/api/auth/login", {
        "email": "nobody@example.com", "password": "password123",
    }, "5.6.7.10")

    assert resp.status_code == 401
    assert resp.get_json()["error"] == "Invalid credentials."
    assert routes_auth.login_attempts.get("5.6.7.10", 0) == 1


def test_login_disabled_user_returns_403(db_session, client):
    seed_user(db_session, email="bob@example.com", status="Disabled")

    resp = post_json(client, "/api/auth/login", {
        "email": "bob@example.com", "password": "password123",
    }, "5.6.7.11")

    assert resp.status_code == 403
    assert resp.get_json()["error"] == "Account disabled. Contact support."


def test_login_ip_locked_out_returns_423(db_session, client):
    seed_user(db_session)

    body = {"email": "alice@example.com", "password": "wrongpass"}
    for _ in range(5):
        resp = post_json(client, "/api/auth/login", body, "9.9.9.9")
        assert resp.status_code == 401

    resp = post_json(client, "/api/auth/login", body, "9.9.9.9")
    assert resp.status_code == 423
    assert "Too many failed attempts. Try again in" in resp.get_json()["error"]


# ══════════════════════════════════════════════
# Logout — deletes only the current device's row
# ══════════════════════════════════════════════

def test_logout_removes_only_current_token(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    seed_session(db_session, uid, "tok-A")
    seed_session(db_session, uid, "tok-B")
    with client.session_transaction() as sess:
        sess["user_id"] = uid
        sess["session_token"] = "tok-A"

    resp = client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True, "message": "Logged out."}

    remaining = {
        t for (t,) in db_session.query(UserSession.token).filter_by(user_id=uid).all()
    }
    assert remaining == {"tok-B"}
    with client.session_transaction() as sess:
        assert "user_id" not in sess


# ══════════════════════════════════════════════
# /me
# ══════════════════════════════════════════════

def test_me_returns_logged_in_user(db_session, fs, client):
    user = seed_user(db_session)
    uid = str(user.id)
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.get_json() == {
        "success": True,
        "user": {
            "id": uid,
            "username": "Alice",
            "email": "alice@example.com",
            "role": "user",
            "status": "Active",
            "has_completed_tour": False,
            "has_completed_onboarding": False,
        },
    }


def test_me_returns_onboarding_flag_true(db_session, client):
    user = seed_user(db_session, has_completed_onboarding=True)
    with client.session_transaction() as sess:
        sess["user_id"] = str(user.id)

    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.get_json()["user"]["has_completed_onboarding"] is True


def test_me_derives_onboarding_from_completed_run(db_session, fs, client):
    # Stored flag False, but the user owns a business with a completed analysis
    # run → /me derives has_completed_onboarding True (hybrid evidence path).
    user = seed_user(db_session)
    uid = str(user.id)
    business_ref = fs.collection("businesses").document("b1")
    business_ref.set({"owner_id": uid, "name": "Ada's Bakery"})
    business_ref.collection("agent_runs").document("r1").set({
        "owner_id": uid, "analysis_status": "completed",
    })
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.get_json()["user"]["has_completed_onboarding"] is True


def test_me_onboarding_false_without_completed_run(db_session, fs, client):
    user = seed_user(db_session)
    uid = str(user.id)
    business_ref = fs.collection("businesses").document("b1")
    business_ref.set({"owner_id": uid, "name": "Ada's Bakery"})
    business_ref.collection("agent_runs").document("r1").set({
        "owner_id": uid, "analysis_status": "running",
    })
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.get_json()["user"]["has_completed_onboarding"] is False


def test_me_requires_auth(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}


def test_me_unknown_user_clears_session(db_session, client):
    with client.session_transaction() as sess:
        sess["user_id"] = ABSENT_UUID

    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}
    with client.session_transaction() as sess:
        assert "user_id" not in sess


# ══════════════════════════════════════════════
# Onboarding
# ══════════════════════════════════════════════

def test_onboarding_complete_sets_flag(db_session, client):
    user = seed_user(db_session)
    uid = str(user.id)
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.post("/api/auth/onboarding/complete")
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True}
    assert db_session.query(User).filter_by(id=uid).one().has_completed_onboarding is True


def test_onboarding_complete_is_idempotent(db_session, client):
    user = seed_user(db_session, has_completed_onboarding=True)
    uid = str(user.id)
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.post("/api/auth/onboarding/complete")
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True}
    assert db_session.query(User).filter_by(id=uid).one().has_completed_onboarding is True


def test_onboarding_complete_requires_auth(client):
    resp = client.post("/api/auth/onboarding/complete")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}


def test_onboarding_complete_unknown_user_clears_session(db_session, client):
    with client.session_transaction() as sess:
        sess["user_id"] = ABSENT_UUID

    resp = client.post("/api/auth/onboarding/complete")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}
    with client.session_transaction() as sess:
        assert "user_id" not in sess


# ──────────────────────────────────────────────
# login_required decorator — validates against user_sessions (EXISTS)
# ──────────────────────────────────────────────

def _run_guarded(flask_app, user_id, session_token):
    """Apply login_required to a trivial view and invoke it inside a request
    context with the given session. Returns the view's return value ("ok" when
    the guard passes) or the redirect Response (when it rejects)."""
    import decorators
    from flask import session as flask_session

    @decorators.login_required
    def view():
        return "ok"

    with flask_app.test_request_context("/"):
        if user_id is not None:
            flask_session["user_id"] = user_id
        if session_token is not None:
            flask_session["session_token"] = session_token
        return view()


def test_login_required_passes_for_known_token(db_session, flask_app):
    user = seed_user(db_session)
    uid = str(user.id)
    seed_session(db_session, uid, "tok-A")
    seed_session(db_session, uid, "tok-B")

    # Both concurrent devices validate.
    assert _run_guarded(flask_app, uid, "tok-A") == "ok"
    assert _run_guarded(flask_app, uid, "tok-B") == "ok"


def test_login_required_rejects_unknown_token(db_session, flask_app):
    user = seed_user(db_session)
    uid = str(user.id)
    seed_session(db_session, uid, "tok-A")

    resp = _run_guarded(flask_app, uid, "tok-UNKNOWN")
    assert getattr(resp, "status_code", None) == 302


def test_login_required_rejects_when_no_sessions(db_session, flask_app):
    user = seed_user(db_session)
    uid = str(user.id)

    resp = _run_guarded(flask_app, uid, "anything")
    assert getattr(resp, "status_code", None) == 302


def test_login_required_rejects_absent_token(db_session, flask_app):
    user = seed_user(db_session)
    uid = str(user.id)
    seed_session(db_session, uid, "tok-A")

    # No session_token in the cookie at all → rejected.
    resp = _run_guarded(flask_app, uid, None)
    assert getattr(resp, "status_code", None) == 302


# ──────────────────────────────────────────────
# DELETE /api/auth/account — split-store hard deletion
#
# The user row (+ cascade of user_sessions / security_logs) is in Postgres; the
# businesses cascade and student_profiles stay on Firestore (the DelDb fake).
# ──────────────────────────────────────────────


class DelSnapshot:
    def __init__(self, data, doc_id):
        self.exists = data is not None
        self._data = dict(data) if data else {}
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class DelQuery:
    """Supports chained .where(...).stream() with == filters."""

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
        return DelQuery(self._db, self._parent_path, self._filters + [(field, op, value)])

    def stream(self):
        out = []
        for path, data in self._db._store.items():
            if len(path) != len(self._parent_path) + 1:
                continue
            if path[: len(self._parent_path)] != self._parent_path:
                continue
            if all(op == "==" and data.get(field) == value
                   for field, op, value in self._filters):
                out.append(DelSnapshot(data, path[-1]))
        return iter(out)


class DelRef:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)
        self.id = self.path[-1]

    def get(self):
        return DelSnapshot(self._db._store.get(self.path), self.id)

    def set(self, data):
        self._db._store[self.path] = dict(data)

    def delete(self):
        self._db._store.pop(self.path, None)

    def collection(self, name):
        return DelCollection(self._db, self.path + (name,))


class DelCollection:
    def __init__(self, db, path):
        self._db = db
        self.path = tuple(path)

    def document(self, doc_id=None):
        if doc_id is None:
            doc_id = f"auto-{next(self._db._ids)}"
        return DelRef(self._db, self.path + (doc_id,))

    def where(self, *args, **kwargs):
        return DelQuery(self._db, self.path, []).where(*args, **kwargs)

    def stream(self):
        return DelQuery(self._db, self.path, []).stream()


class DelDb:
    def __init__(self):
        self._store = {}
        self._ids = _itertools.count(1)

    def collection(self, name):
        return DelCollection(self, (name,))

    def recursive_delete(self, ref):
        prefix = tuple(ref.path)
        for path in [p for p in self._store if p[: len(prefix)] == prefix]:
            del self._store[path]


@pytest.fixture
def account_db(monkeypatch):
    """Rich in-memory Firestore for account-deletion tests, with the best-effort
    provider/tile helpers stubbed so tests NEVER hit real GitHub/Google/Supabase."""
    import routes.auth_api as auth_api

    db = DelDb()
    monkeypatch.setattr(auth_api, "db", db)
    monkeypatch.setattr(auth_api.connection_service, "get_connection", lambda *a, **k: None)
    monkeypatch.setattr(auth_api.connection_service, "revoke_github_token", lambda *a, **k: True)
    monkeypatch.setattr(auth_api.connection_service, "revoke_google_token", lambda *a, **k: True)
    monkeypatch.setattr(auth_api.tile_storage_service, "delete_tiles_for_business", lambda *a, **k: None)
    return db, auth_api


def _seed_account(db_session, fs_db, email="alice@example.com"):
    """Seed the full footprint of one account: the Postgres user plus a
    security_logs row (cascade targets), and the Firestore business (with
    subcollections) + student_profile that stay on Firestore this slice."""
    user = seed_user(db_session, email=email)
    uid = str(user.id)
    db_session.add(SecurityLog(type="device_mismatch", user_id=uid))
    db_session.commit()

    biz = ("businesses", f"{uid}-b1")
    fs_db._store[biz] = {"owner_id": uid, "name": "Ada's Bakery"}
    fs_db._store[biz + ("opportunities", "opp1")] = {"owner_id": uid}
    fs_db._store[biz + ("opportunities", "opp2")] = {"owner_id": uid}
    fs_db._store[biz + ("actions", "act1")] = {"owner_id": uid}
    fs_db._store[biz + ("connections", "con1")] = {"owner_id": uid, "provider": "github"}
    fs_db._store[biz + ("gtm_runs", "gtm1")] = {"owner_id": uid}
    fs_db._store[("student_profiles", uid)] = {"bio": "hi"}
    return uid


def _login(client, user_id):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def _user_rows(db_session, uid):
    return db_session.query(User).filter_by(id=uid).count()


def _security_log_rows(db_session, uid):
    return db_session.query(SecurityLog).filter_by(user_id=uid).count()


def test_delete_account_hard_deletes_everything(account_db, db_session, client):
    # Required case: deletion removes the Postgres user + its cascade AND still
    # triggers the Firestore recursive_delete business cascade.
    fs_db, auth_api = account_db
    uid = _seed_account(db_session, fs_db, "alice@example.com")
    _login(client, uid)

    # Confirmation is re-verified case-insensitively (stored email is lowercased).
    resp = client.delete("/api/auth/account", json={"confirm_email": "Alice@Example.com"})
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True, "message": "Account deleted"}

    # Firestore: business + every subcollection doc + student_profile gone.
    assert [p for p in fs_db._store if p[:2] == ("businesses", f"{uid}-b1")] == []
    assert ("student_profiles", uid) not in fs_db._store
    # Postgres: user + its security_logs (and any sessions) gone via FK cascade.
    assert _user_rows(db_session, uid) == 0
    assert _security_log_rows(db_session, uid) == 0
    with client.session_transaction() as sess:
        assert "user_id" not in sess


def test_delete_account_isolates_other_users(account_db, db_session, client):
    fs_db, auth_api = account_db
    uid1 = _seed_account(db_session, fs_db, "alice@example.com")
    uid2 = _seed_account(db_session, fs_db, "bob@example.com")
    _login(client, uid1)

    resp = client.delete("/api/auth/account", json={"confirm_email": "alice@example.com"})
    assert resp.status_code == 200

    # Everything belonging to u2 is untouched (both stores).
    assert ("businesses", f"{uid2}-b1") in fs_db._store
    assert ("businesses", f"{uid2}-b1", "opportunities", "opp1") in fs_db._store
    assert ("student_profiles", uid2) in fs_db._store
    assert _user_rows(db_session, uid2) == 1
    assert _security_log_rows(db_session, uid2) == 1


def test_delete_account_revokes_and_cleans_tiles_when_connected(account_db, db_session, client):
    fs_db, auth_api = account_db
    uid = _seed_account(db_session, fs_db, "alice@example.com")
    _login(client, uid)

    gh_calls, goog_calls, tile_calls = [], [], []
    conn = {"access_token": "gh-access", "refresh_token": "goog-refresh"}
    auth_api.connection_service.get_connection = lambda *a, **k: dict(conn)
    auth_api.connection_service.revoke_github_token = lambda t: gh_calls.append(t) or True
    auth_api.connection_service.revoke_google_token = lambda t: goog_calls.append(t) or True
    auth_api.tile_storage_service.delete_tiles_for_business = lambda b: tile_calls.append(b)

    resp = client.delete("/api/auth/account", json={"confirm_email": "alice@example.com"})
    assert resp.status_code == 200
    assert gh_calls == ["gh-access"]
    assert goog_calls == ["goog-refresh"]  # refresh token preferred
    assert tile_calls == [f"{uid}-b1"]
    assert _user_rows(db_session, uid) == 0


def test_delete_account_best_effort_failures_still_delete(account_db, db_session, client):
    # Even if the revoke helpers AND the tile helper RAISE, the hard delete must
    # still complete and return 200.
    fs_db, auth_api = account_db
    uid = _seed_account(db_session, fs_db, "alice@example.com")
    _login(client, uid)

    def boom(*a, **k):
        raise RuntimeError("provider down")

    auth_api.connection_service.get_connection = lambda *a, **k: {
        "access_token": "x", "refresh_token": "y",
    }
    auth_api.connection_service.revoke_github_token = boom
    auth_api.connection_service.revoke_google_token = boom
    auth_api.tile_storage_service.delete_tiles_for_business = boom

    resp = client.delete("/api/auth/account", json={"confirm_email": "alice@example.com"})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert _user_rows(db_session, uid) == 0
    assert [p for p in fs_db._store if p[:2] == ("businesses", f"{uid}-b1")] == []
    assert _security_log_rows(db_session, uid) == 0


def test_delete_account_wrong_email_400_nothing_deleted(account_db, db_session, client):
    fs_db, auth_api = account_db
    uid = _seed_account(db_session, fs_db, "alice@example.com")
    fs_before = dict(fs_db._store)
    _login(client, uid)

    resp = client.delete("/api/auth/account", json={"confirm_email": "wrong@example.com"})
    assert resp.status_code == 400
    assert resp.get_json() == {"success": False, "error": "Email confirmation does not match"}
    assert fs_db._store == fs_before
    assert _user_rows(db_session, uid) == 1
    assert _security_log_rows(db_session, uid) == 1


def test_delete_account_missing_email_400_nothing_deleted(account_db, db_session, client):
    fs_db, auth_api = account_db
    uid = _seed_account(db_session, fs_db, "alice@example.com")
    fs_before = dict(fs_db._store)
    _login(client, uid)

    resp = client.delete("/api/auth/account", json={})
    assert resp.status_code == 400
    assert resp.get_json() == {"success": False, "error": "Email confirmation does not match"}
    assert fs_db._store == fs_before
    assert _user_rows(db_session, uid) == 1


def test_delete_account_unauthenticated_401(account_db, client):
    fs_db, auth_api = account_db
    with client.session_transaction() as sess:
        sess.clear()

    resp = client.delete("/api/auth/account", json={"confirm_email": "alice@example.com"})
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}


def test_delete_account_missing_user_404(account_db, db_session, client):
    fs_db, auth_api = account_db
    _login(client, ABSENT_UUID)

    resp = client.delete("/api/auth/account", json={"confirm_email": "alice@example.com"})
    assert resp.status_code == 404
    assert resp.get_json() == {"success": False, "error": "User not found"}
    with client.session_transaction() as sess:
        assert "user_id" not in sess


def test_delete_account_route_registered(flask_app):
    rule = next(
        (r for r in flask_app.url_map.iter_rules() if r.rule == "/api/auth/account"),
        None,
    )
    assert rule is not None
    assert "DELETE" in rule.methods
