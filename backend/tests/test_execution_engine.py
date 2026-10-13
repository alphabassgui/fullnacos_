import pytest


class _Snapshot:
    def __init__(self, data):
        self.exists = data is not None
        self._data = dict(data) if data else {}

    def to_dict(self):
        return dict(self._data)


class _Ref:
    _auto = 0

    def __init__(self, path, data=None):
        self.path = list(path)
        self.id = self.path[-1]
        self._set_data = dict(data) if data else None
        self.updates = []
        self.children = {}

    def get(self):
        return _Snapshot(self._set_data)

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


class FakeTaskDb:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        if name not in self.collections:
            self.collections[name] = _Collection([name])
        return self.collections[name]


@pytest.fixture
def execution_env(monkeypatch):
    import services.execution_engine as execution_engine

    db = FakeTaskDb()
    monkeypatch.setattr(execution_engine, "db", db)
    return execution_engine, db


def test_execute_action_completed_social(execution_env):
    execution_engine, db = execution_env
    biz_ref = db.collection("businesses").document("b1")
    biz_ref.collection("executions").document("e1").set({"action_id": "a1"})
    biz_ref.collection("actions").document("a1").set(
        {"action_type": "social", "status": "approved"}
    )

    result = execution_engine.execute_action("b1", "e1")

    assert result["success"] is True
    assert result["status"] == "not_implemented"

    execution_ref = biz_ref.collection("executions").document("e1")
    assert execution_ref.data["status"] == "completed"
    assert execution_ref.data["result"] == result
    assert execution_ref.data["started_at"]
    assert execution_ref.data["completed_at"]
    assert execution_ref.data["updated_at"]


def test_execute_action_unrouted_type_marks_failed(execution_env):
    execution_engine, db = execution_env
    biz_ref = db.collection("businesses").document("b1")
    biz_ref.collection("executions").document("e1").set(
        {"action_id": "a1", "status": "queued"}
    )
    biz_ref.collection("actions").document("a1").set(
        {"action_type": "email", "status": "approved"}
    )

    with pytest.raises(
        ValueError, match="No connector available for action type: email"
    ):
        execution_engine.execute_action("b1", "e1")

    execution_ref = biz_ref.collection("executions").document("e1")
    assert execution_ref.data["status"] == "failed"
    assert (
        execution_ref.data["error"]
        == "No connector available for action type: email"
    )
    assert execution_ref.data["completed_at"]

    # The action doc must mirror the failure, with the same error string.
    action_ref = biz_ref.collection("actions").document("a1")
    assert action_ref.data["status"] == "failed"
    assert (
        action_ref.data["error"]
        == "No connector available for action type: email"
    )
    assert action_ref.data["updated_at"]


def test_execute_action_missing_execution_raises(execution_env):
    execution_engine, _ = execution_env

    with pytest.raises(ValueError, match="Execution not found"):
        execution_engine.execute_action("b1", "missing")


def test_execute_action_missing_action_raises(execution_env):
    execution_engine, db = execution_env
    biz_ref = db.collection("businesses").document("b1")
    biz_ref.collection("executions").document("e1").set({"action_id": "nope"})

    with pytest.raises(ValueError, match="Action not found"):
        execution_engine.execute_action("b1", "e1")


def test_execute_action_unapproved_action_raises(execution_env):
    execution_engine, db = execution_env
    biz_ref = db.collection("businesses").document("b1")
    biz_ref.collection("executions").document("e1").set({"action_id": "a1"})
    biz_ref.collection("actions").document("a1").set(
        {"action_type": "social", "status": "pending"}
    )

    with pytest.raises(ValueError, match="Action must be approved before execution"):
        execution_engine.execute_action("b1", "e1")


class _FakeConnector:
    """A connector stub that records nothing external — isolates the engine's
    action-doc / gate logic from the real connector layer."""

    def __init__(self, result):
        self._result = result

    def execute(self, action, business_id, user_id, execution_id=None):
        return self._result


def _stub_post_execute(execution_engine, monkeypatch):
    """Stub the measurement + learning side effects so a completed execution
    doesn't reach the real Firestore / Groq services over the network."""
    monkeypatch.setattr(
        execution_engine, "record_measurement", lambda **kwargs: {"id": "m1"}
    )
    monkeypatch.setattr(
        execution_engine,
        "create_learning_from_measurement",
        lambda **kwargs: {"id": "l1"},
    )


def test_execute_action_writes_completed_to_action(execution_env, monkeypatch):
    # The real fix: on a completed execution the ACTION doc (which the Campaigns
    # list reads) must also reach "completed", so the UI leaves "Running".
    execution_engine, db = execution_env
    biz_ref = db.collection("businesses").document("b1")
    biz_ref.collection("executions").document("e1").set(
        {"action_id": "a1", "status": "queued"}
    )
    biz_ref.collection("actions").document("a1").set(
        {"action_type": "website", "status": "approved"}
    )

    monkeypatch.setattr(
        execution_engine,
        "get_connector",
        lambda action: _FakeConnector({"success": True, "status": "ok"}),
    )
    _stub_post_execute(execution_engine, monkeypatch)

    execution_engine.execute_action("b1", "e1")

    execution_ref = biz_ref.collection("executions").document("e1")
    action_ref = biz_ref.collection("actions").document("a1")
    assert execution_ref.data["status"] == "completed"
    assert action_ref.data["status"] == "completed"
    assert action_ref.data["completed_at"]
    assert action_ref.data["updated_at"]


def test_execute_action_running_action_retry_safe(execution_env, monkeypatch):
    # Retry-safety: a re-queued execution re-enters with the action already at
    # "running" (the first attempt mirrored the lifecycle onto the action). It
    # must execute, not raise "Action must be approved before execution".
    execution_engine, db = execution_env
    biz_ref = db.collection("businesses").document("b1")
    biz_ref.collection("executions").document("e1").set(
        {"action_id": "a1", "status": "queued"}
    )
    biz_ref.collection("actions").document("a1").set(
        {"action_type": "website", "status": "running"}
    )

    monkeypatch.setattr(
        execution_engine,
        "get_connector",
        lambda action: _FakeConnector({"success": True, "status": "ok"}),
    )
    _stub_post_execute(execution_engine, monkeypatch)

    execution_engine.execute_action("b1", "e1")

    assert biz_ref.collection("executions").document("e1").data["status"] == "completed"
    assert biz_ref.collection("actions").document("a1").data["status"] == "completed"