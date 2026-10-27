import uuid

import pytest
from werkzeug.security import generate_password_hash

from models import Business, User, business_to_dict

# A syntactically valid UUID that is never seeded — the "unknown business" path.
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
# Postgres seed helpers (slice c: businesses live in Postgres now).
# ──────────────────────────────────────────────


def seed_user(db_session, email="owner@example.com"):
    user = User(
        email=email,
        username="Owner",
        role="user",
        status="Active",
        password_hash=generate_password_hash("password123"),
    )
    db_session.add(user)
    db_session.commit()
    return user


def seed_business(db_session, owner_id, name="One", **overrides):
    fields = dict(owner_id=owner_id, name=name)
    fields.update(overrides)
    business = Business(**fields)
    db_session.add(business)
    db_session.commit()
    return business


def test_business_api_blueprint_registered(flask_app):
    rules = {r.rule for r in flask_app.url_map.iter_rules()}
    assert "/api/business" in rules
    assert "/api/business/<business_id>" in rules


def test_list_unauthenticated_401(client):
    resp = client.get("/api/business")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}


def test_list_returns_only_callers_businesses(db_session, client):
    owner = seed_user(db_session, email="u1@example.com")
    other = seed_user(db_session, email="u2@example.com")
    uid = str(owner.id)
    mine = seed_business(db_session, owner_id=uid, name="One")
    seed_business(db_session, owner_id=str(other.id), name="Two")
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.get("/api/business")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["businesses"] == [business_to_dict(mine)]


def test_list_empty(db_session, client):
    owner = seed_user(db_session)
    with client.session_transaction() as sess:
        sess["user_id"] = str(owner.id)

    resp = client.get("/api/business")
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True, "businesses": []}


def test_get_unauthenticated_401(client):
    resp = client.get(f"/api/business/{ABSENT_UUID}")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}


def test_get_not_found_404(db_session, client):
    owner = seed_user(db_session)
    with client.session_transaction() as sess:
        sess["user_id"] = str(owner.id)

    # A non-UUID id resolves to None (not a 500) and returns the same 404.
    resp = client.get("/api/business/missing")
    assert resp.status_code == 404
    assert resp.get_json() == {"success": False, "error": "Business not found"}


def test_get_non_owner_403(db_session, client):
    owner = seed_user(db_session, email="u2@example.com")
    caller = seed_user(db_session, email="u1@example.com")
    business = seed_business(db_session, owner_id=str(owner.id), name="Two")
    with client.session_transaction() as sess:
        sess["user_id"] = str(caller.id)

    resp = client.get(f"/api/business/{business.id}")
    assert resp.status_code == 403
    assert resp.get_json() == {
        "success": False,
        "error": "You do not have permission to view this business",
    }


def test_get_owner_200(db_session, client):
    owner = seed_user(db_session)
    uid = str(owner.id)
    business = seed_business(
        db_session,
        owner_id=uid,
        name="One",
        website_url="https://example.com",
        industry="retail",
        description="desc",
    )
    with client.session_transaction() as sess:
        sess["user_id"] = uid

    resp = client.get(f"/api/business/{business.id}")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["business"] == business_to_dict(business)
    # id serialized as a string; owner_id still present in the body.
    assert body["business"]["id"] == str(business.id)
    uuid.UUID(body["business"]["id"])
    assert body["business"]["owner_id"] == uid


def test_guard_order_unauthenticated_beats_404(db_session, client):
    owner = seed_user(db_session)
    business = seed_business(db_session, owner_id=str(owner.id), name="One")

    resp = client.get(f"/api/business/{business.id}")
    assert resp.status_code == 401  # no session → 401, NOT 404 or 403
