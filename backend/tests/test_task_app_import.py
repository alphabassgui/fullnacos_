"""Regression guard for ModuleNotFoundError('No module named app') in production.

Root cause: ContextTask.__call__ runs `from app import app` lazily. Under
`celery -A task worker` the worker's CWD (backend/) is not guaranteed to be on
sys.path at call time, so the import fails even though backend/app.py exists.

Fix (backend/task.py): re-insert _HERE inside __call__ immediately before the
lazy import so it survives the worker bootstrap's sys.path reset.
"""
import importlib.machinery
import os
import sys

import pytest


def test_task_defines_here_sentinel():
    """task.py must expose _HERE pointing at the directory containing app.py."""
    import task as task_mod

    assert hasattr(task_mod, "_HERE"), (
        "_HERE not defined in task.py — sys.path insertion fix not applied"
    )
    backend_dir = task_mod._HERE
    assert os.path.isfile(os.path.join(backend_dir, "task.py"))
    assert os.path.isfile(os.path.join(backend_dir, "app.py")), (
        "task._HERE does not contain app.py — fix points at wrong directory"
    )


def test_task_insert_here_into_syspath():
    """task.py must have _HERE on sys.path after import so the lazy
    `from app import app` in ContextTask.__call__ always resolves."""
    import task as task_mod

    assert task_mod._HERE in sys.path, (
        "task._HERE is not on sys.path after import — "
        "the lazy `from app import app` would raise ModuleNotFoundError"
    )


def test_context_task_call_time_path_fix(monkeypatch):
    """ContextTask.__call__ re-inserts _HERE immediately before `from app import app`
    so the lazy import succeeds even when backend/ is absent from sys.path at
    call time (the proven Render/Celery worker failure mode).

    Goes red on the diagnostic branch (no call-time reinsertion in __call__)
    and green on the fixed branch (reinsertion inside __call__).
    """
    import celery.app.task as _celery_task

    import task as task_mod
    from task import ContextTask

    backend_dir = task_mod._HERE

    # Stub super().__call__ so we exercise only the path-fix + import code
    # inside __call__, without needing a live Celery broker.
    monkeypatch.setattr(_celery_task.Task, "__call__", lambda self, *a, **kw: "sentinel")

    # Ensure SECRET_KEY is available so app.py doesn't raise RuntimeError.
    monkeypatch.setenv("SECRET_KEY", os.getenv("SECRET_KEY") or "test-secret-key-for-tests")

    # Remove the cached `app` module so the import must hit sys.path — without
    # this, `from app import app` would always return the cached module and the
    # test would pass even without the call-time path fix.
    cached_app = sys.modules.pop("app", None)
    try:
        # Simulate the worker's reset sys.path: strip backend/ and CWD markers.
        stripped = [p for p in sys.path if p not in ("", ".", backend_dir)]
        monkeypatch.setattr(sys, "path", stripped[:])

        # Premise: app must NOT be findable without _HERE.
        assert (
            importlib.machinery.PathFinder.find_spec("app", path=sys.path) is None
        ), "app is findable even without _HERE — test premise invalid (check sys.path)"

        # Call ContextTask.__call__ with the stripped sys.path.
        # Fixed __call__ re-inserts _HERE → `from app import app` succeeds → "sentinel".
        # Unfixed __call__ (no reinsertion) → ModuleNotFoundError → pytest.fail().
        task_instance = ContextTask()
        task_instance.name = "_test_context_task_call_time_path_fix"

        try:
            result = task_instance()
        except ModuleNotFoundError as exc:
            pytest.fail(
                "ContextTask.__call__ raised ModuleNotFoundError when backend/ "
                f"was absent from sys.path: {exc}\n"
                "The call-time sys.path.insert is missing or ineffective."
            )

        assert result == "sentinel"
        assert backend_dir in sys.path, (
            "_HERE was not inserted into sys.path during __call__ — "
            "call-time path fix did not execute"
        )
    finally:
        # Restore the original cached module so subsequent tests use the right app.
        if cached_app is not None:
            sys.modules["app"] = cached_app
        elif "app" in sys.modules:
            del sys.modules["app"]


def test_app_importable_from_task_here_without_cwd(monkeypatch):
    """Hermetic regression: strip '' (CWD marker) from sys.path to simulate the
    worker's environment, then confirm `app` is still findable at task._HERE.

    Uses PathFinder.find_spec with an explicit path to bypass the sys.modules
    cache — this tests filesystem resolution, not a cached import."""
    import task as task_mod

    backend_dir = task_mod._HERE

    # Strip the CWD marker and backend_dir to replicate a worker whose sys.path
    # lacks the current directory and was not pre-seeded with backend/.
    stripped = [p for p in sys.path if p not in ("", ".", backend_dir)]
    monkeypatch.setattr(sys, "path", stripped)

    # Confirm app is NOT findable on the stripped path (validates the test premise).
    spec_without_fix = importlib.machinery.PathFinder.find_spec("app", path=stripped)
    assert spec_without_fix is None, (
        "app is findable even without _HERE on the path — "
        "test premise is invalid (check sys.path)"
    )

    # Now confirm app IS findable when _HERE is present — this is what the fix
    # guarantees by inserting _HERE at task.py module load time.
    spec_with_fix = importlib.machinery.PathFinder.find_spec(
        "app", path=[backend_dir] + stripped
    )
    assert spec_with_fix is not None, (
        "app not findable at task._HERE even with it on the path — "
        "task._HERE does not point to the directory containing app.py"
    )
