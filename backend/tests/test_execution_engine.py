import uuid

import pytest
from werkzeug.security import generate_password_hash

from models import Action, Business, Execution, User

# A syntactically valid UUID that is never seeded, used to prove the defensive
# "Action not found" branch (executions.action_id is an unconstrained UUID now,
# mirroring the Firestore free-string action_id).
ABSENT_UUID = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


def seed_user(db_session, email="ex@example.com"):
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


def seed_action(db_session, business_id, owner_id, **overrides):
    fields = dict(
        business_id=business_id,
        owner_id=owner_id,
        action_type="social",
        status="approved",
    )
    fields.update(overrides)
    action = Action(**fields)
    db_session.add(action)
    db_session.commit()
    return action


def seed_execution(db_session, business_id, owner_id, action_id, **overrides):
    fields = dict(
        business_id=business_id,
        owner_id=owner_id,
        action_id=action_id,
        status="queued",
    )
    fields.update(overrides)
    execution = Execution(**fields)
    db_session.add(execution)
    db_session.commit()
    return execution


class _FakeConnector:
    """A connector stub that records nothing external — isolates the engine's
    action-row / gate logic from the real connector layer."""

    def __init__(self, result):
        self._result = result

    def execute(self, action, business_id, user_id, execution_id=None):
        return self._result


def _stub_post_execute(execution_engine, monkeypatch):
    """Stub the measurement + learning side effects so a completed execution
    doesn't reach the real services / Groq over the network."""
    monkeypatch.setattr(
        execution_engine, "record_measurement", lambda **kwargs: {"id": "m1"}
    )
    monkeypatch.setattr(
        execution_engine,
        "create_learning_from_measurement",
        lambda **kwargs: {"id": "l1"},
    )


def _setup(db_session):
    user = seed_user(db_session)
    uid = str(user.id)
    business = seed_business(db_session, owner_id=uid)
    return uid, str(business.id)


def test_execute_action_completed_social(db_session, monkeypatch):
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    action = seed_action(db_session, bid, uid, action_type="social", status="approved")
    execution = seed_execution(db_session, bid, uid, action.id, status="queued")

    monkeypatch.setattr(
        execution_engine,
        "get_connector",
        lambda action: _FakeConnector({"success": True, "status": "published"}),
    )
    _stub_post_execute(execution_engine, monkeypatch)

    result = execution_engine.execute_action(bid, str(execution.id))

    assert result["success"] is True
    assert result["status"] == "published"

    db_session.refresh(execution)
    db_session.refresh(action)
    assert execution.status == "completed"
    assert execution.result == result
    assert execution.started_at
    assert execution.completed_at
    assert execution.updated_at
    # The action row mirrors the completed lifecycle (the Campaigns list reads it).
    assert action.status == "completed"


def test_execute_action_unrouted_type_marks_failed(db_session):
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    action = seed_action(db_session, bid, uid, action_type="email", status="approved")
    execution = seed_execution(db_session, bid, uid, action.id, status="queued")

    with pytest.raises(
        ValueError, match="No connector available for action type: email"
    ):
        execution_engine.execute_action(bid, str(execution.id))

    db_session.refresh(execution)
    db_session.refresh(action)
    assert execution.status == "failed"
    assert execution.error == "No connector available for action type: email"
    assert execution.completed_at

    assert action.status == "failed"
    assert action.error == "No connector available for action type: email"
    assert action.updated_at


def test_execute_action_missing_execution_raises(db_session):
    import services.execution_engine as execution_engine

    _setup(db_session)
    with pytest.raises(ValueError, match="Execution not found"):
        execution_engine.execute_action("b1", "missing")


def test_execute_action_missing_action_raises(db_session):
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    # action_id references no action row (FK was intentionally dropped so this
    # defensive branch stays reachable, as it was against Firestore).
    execution = seed_execution(db_session, bid, uid, ABSENT_UUID, status="queued")

    with pytest.raises(ValueError, match="Action not found"):
        execution_engine.execute_action(bid, str(execution.id))


def test_execute_action_unapproved_action_raises(db_session):
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    action = seed_action(db_session, bid, uid, action_type="social", status="pending")
    execution = seed_execution(db_session, bid, uid, action.id, status="queued")

    with pytest.raises(
        ValueError, match="Action must be approved before execution"
    ):
        execution_engine.execute_action(bid, str(execution.id))


def test_execute_action_writes_completed_to_action(db_session, monkeypatch):
    # On a completed execution the ACTION row (which the Campaigns list reads)
    # must also reach "completed", so the UI leaves "Running".
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    action = seed_action(db_session, bid, uid, action_type="website", status="approved")
    execution = seed_execution(db_session, bid, uid, action.id, status="queued")

    monkeypatch.setattr(
        execution_engine,
        "get_connector",
        lambda action: _FakeConnector({"success": True, "status": "ok"}),
    )
    _stub_post_execute(execution_engine, monkeypatch)

    execution_engine.execute_action(bid, str(execution.id))

    db_session.refresh(execution)
    db_session.refresh(action)
    assert execution.status == "completed"
    assert action.status == "completed"
    assert action.completed_at
    assert action.updated_at


def test_execute_action_running_action_retry_safe(db_session, monkeypatch):
    # Retry-safety: a re-queued execution re-enters with the action already at
    # "running" (the first attempt mirrored the lifecycle). It must execute, not
    # raise "Action must be approved before execution".
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    action = seed_action(db_session, bid, uid, action_type="website", status="running")
    execution = seed_execution(db_session, bid, uid, action.id, status="queued")

    monkeypatch.setattr(
        execution_engine,
        "get_connector",
        lambda action: _FakeConnector({"success": True, "status": "ok"}),
    )
    _stub_post_execute(execution_engine, monkeypatch)

    execution_engine.execute_action(bid, str(execution.id))

    db_session.refresh(execution)
    db_session.refresh(action)
    assert execution.status == "completed"
    assert action.status == "completed"


def test_execute_action_completed_is_noop_on_redelivery(db_session, monkeypatch):
    # acks_late redelivery after a completed execution must be a pure no-op: it
    # returns the stored result and writes NO second measurement/learning.
    import services.execution_engine as execution_engine

    uid, bid = _setup(db_session)
    stored_result = {"success": True, "status": "published"}
    action = seed_action(db_session, bid, uid, action_type="social", status="completed")
    execution = seed_execution(
        db_session, bid, uid, action.id, status="completed", result=stored_result
    )

    counts = {"measurement": 0, "learning": 0}

    def fake_measurement(**kwargs):
        counts["measurement"] += 1
        return {"id": "m1"}

    def fake_learning(**kwargs):
        counts["learning"] += 1
        return {"id": "l1"}

    monkeypatch.setattr(execution_engine, "record_measurement", fake_measurement)
    monkeypatch.setattr(
        execution_engine, "create_learning_from_measurement", fake_learning
    )

    result = execution_engine.execute_action(bid, str(execution.id))

    assert result == stored_result
    assert counts == {"measurement": 0, "learning": 0}
