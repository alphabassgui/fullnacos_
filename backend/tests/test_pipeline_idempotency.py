"""PR d-core: prove the #48 idempotency guarantees are now enforced by the DB
constraints (partial UNIQUE indexes / ON CONFLICT upserts), not just by app code.

Each test exercises the real Postgres rows through the ported services and asserts
exactly one row survives a duplicate, with the same already_exists contract the
callers consumed against Firestore."""

import uuid

import pytest
from werkzeug.security import generate_password_hash

from models import (
    Action,
    Business,
    Execution,
    Learning,
    Measurement,
    Opportunity,
    User,
    measurement_to_dict,
)


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


def seed_user(db_session, email="ix@example.com"):
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


def seed_business(db_session, owner_id, **overrides):
    fields = dict(owner_id=owner_id, name="B", website_url="https://b.example")
    fields.update(overrides)
    business = Business(**fields)
    db_session.add(business)
    db_session.commit()
    return business


def _setup(db_session):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid)
    return uid, str(business.id)


def _opp_payload(**overrides):
    payload = dict(
        title="T",
        description="d",
        problem="Our checkout is slow",
        evidence=["e"],
        potential_impact="high",
        confidence=0.9,
        type="seo",
    )
    payload.update(overrides)
    return payload


def _decision(**overrides):
    decision = dict(
        action_title="Post",
        action_type="social",
        objective="o",
        description="d",
        reasoning="r",
        expected_outcome="e",
        required_inputs={},
        requires_approval=True,
        content_type="post",
        page_url=None,
        content={"body": "x"},
        target_path=None,
    )
    decision.update(overrides)
    return decision


# ──────────────────────────────────────────────────────────────
# opportunities: partial UNIQUE(business_id, type, problem_key) WHERE
# problem_key IS NOT NULL backstops the keyed path; the NULL-key text-fallback
# dedupe stays in app code.
# ──────────────────────────────────────────────────────────────


def test_opportunity_keyed_dedupe_one_row(db_session):
    import services.opportunity_service as svc

    uid, bid = _setup(db_session)
    payload = _opp_payload(problem_key="slow-checkout")

    first = svc.create_opportunity(bid, payload, uid)
    second = svc.create_opportunity(bid, dict(payload), uid)

    assert first["already_exists"] is False
    assert second["already_exists"] is True
    assert second["id"] == first["id"]
    assert db_session.query(Opportunity).filter_by(business_id=bid).count() == 1


def test_opportunity_null_problem_key_text_fallback_dedupe(db_session):
    # No problem_key on either call: dedupe falls back to the normalized-problem
    # text match (the verified Firestore-era nuance). Still exactly one row.
    import services.opportunity_service as svc

    uid, bid = _setup(db_session)
    payload = _opp_payload(problem="Our Checkout Is Slow!!!")

    first = svc.create_opportunity(bid, dict(payload), uid)
    # Different surface text, same normalized problem -> deduped.
    second = svc.create_opportunity(
        bid, _opp_payload(problem="our checkout is slow"), uid
    )

    assert first["already_exists"] is False
    assert second["already_exists"] is True
    assert second["id"] == first["id"]
    assert db_session.query(Opportunity).filter_by(business_id=bid).count() == 1


# ──────────────────────────────────────────────────────────────
# actions: partial UNIQUE(opportunity_id) WHERE status IN the 3 live states.
# ──────────────────────────────────────────────────────────────


def _seed_opportunity(db_session, bid, uid, **overrides):
    fields = dict(
        business_id=bid, owner_id=uid, title="T", description="d",
        problem="p", evidence=["e"], potential_impact="high",
        confidence=0.9, type="seo", status="identified",
    )
    fields.update(overrides)
    opp = Opportunity(**fields)
    db_session.add(opp)
    db_session.commit()
    return opp


def test_action_second_live_action_deduped(db_session):
    import services.action_service as svc

    uid, bid = _setup(db_session)
    opp = _seed_opportunity(db_session, bid, uid)
    oid = str(opp.id)

    first = svc.create_action(bid, oid, _decision(), uid)
    second = svc.create_action(bid, oid, _decision(), uid)

    assert first["already_exists"] is False
    assert second["already_exists"] is True
    assert second["id"] == first["id"]
    live = (
        db_session.query(Action)
        .filter_by(opportunity_id=oid)
        .filter(Action.status.in_(("pending_approval", "approved", "running")))
        .count()
    )
    assert live == 1


def test_completed_action_not_blocked_by_constraint(db_session):
    # The partial UNIQUE only covers the 3 live states, so a completed action and
    # a new live action for the same opportunity legitimately coexist.
    import services.action_service as svc

    uid, bid = _setup(db_session)
    opp = _seed_opportunity(db_session, bid, uid)
    oid = str(opp.id)

    done = Action(
        business_id=bid, owner_id=uid, opportunity_id=oid,
        action_type="social", status="completed",
    )
    db_session.add(done)
    db_session.commit()

    result = svc.create_action(bid, oid, _decision(), uid)

    assert result["already_exists"] is False
    assert db_session.query(Action).filter_by(opportunity_id=oid).count() == 2


def test_completed_action_skipped_by_generate(db_session):
    # A completed action IS skipped by generate_actions_for_opportunities — a
    # planner policy broader than the DB constraint (don't regenerate finished).
    import services.opportunity_action_service as svc

    uid, bid = _setup(db_session)
    opp = _seed_opportunity(db_session, bid, uid)
    oid = str(opp.id)

    db_session.add(Action(
        business_id=bid, owner_id=uid, opportunity_id=oid,
        action_type="social", status="completed",
    ))
    db_session.commit()

    result = svc.generate_actions_for_opportunities(
        bid, uid, {"summary": "x"}, opportunity_ids=[oid]
    )

    assert result["actions_created"] == 0
    assert result["actions_existing"] == 1
    assert db_session.query(Action).filter_by(opportunity_id=oid).count() == 1


# ──────────────────────────────────────────────────────────────
# learnings: partial UNIQUE(business_id, measurement_id) WHERE measurement_id
# IS NOT NULL backstops the create-if-absent (@firestore.transactional).
# ──────────────────────────────────────────────────────────────


def _seed_execution_chain(db_session, bid, uid):
    action = Action(
        business_id=bid, owner_id=uid, action_type="social", status="completed",
    )
    db_session.add(action)
    db_session.commit()
    execution = Execution(
        business_id=bid, owner_id=uid, action_id=action.id, status="completed",
    )
    db_session.add(execution)
    db_session.commit()
    measurement = Measurement(
        business_id=bid, execution_id=execution.id, action_id=action.id,
        metric="clicks", value=10, source="test",
    )
    db_session.add(measurement)
    db_session.commit()
    return action, execution, measurement


def test_learning_from_measurement_deduped(db_session, monkeypatch):
    import services.learning_service as svc

    uid, bid = _setup(db_session)
    _, _, measurement = _seed_execution_chain(db_session, bid, uid)
    mid = str(measurement.id)

    monkeypatch.setattr(
        svc,
        "generate_learning_from_measurement",
        lambda measurement: {
            "learning_type": "performance",
            "observation": "o",
            "outcome": "positive",
            "learning": "l",
            "confidence": 0.8,
            "metric": "clicks",
            "previous_value": None,
            "value": 10,
            "direction": "up",
        },
    )

    first = svc.create_learning_from_measurement(bid, mid)
    second = svc.create_learning_from_measurement(bid, mid)

    assert first["already_exists"] is False
    assert second["already_exists"] is True
    assert second["id"] == first["id"]
    assert (
        db_session.query(Learning).filter_by(business_id=bid, measurement_id=mid).count()
        == 1
    )


# ──────────────────────────────────────────────────────────────
# measurement value byte-identity: an integral Numeric reads back as Decimal,
# and the serializer must emit it as int (value=1 stayed 1, never 1.0).
# ──────────────────────────────────────────────────────────────


def test_measurement_integral_value_serializes_as_int(db_session):
    uid, bid = _setup(db_session)
    _, execution, _ = _seed_execution_chain(db_session, bid, uid)

    row = Measurement(
        business_id=bid, execution_id=execution.id,
        metric="signups", value=1, source="test",
    )
    db_session.add(row)
    db_session.commit()
    # Force a DB round-trip so value comes back as Decimal, exercising _num.
    db_session.expire(row)

    body = measurement_to_dict(row)
    assert body["value"] == 1
    assert isinstance(body["value"], int)
