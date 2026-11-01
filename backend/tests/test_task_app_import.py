"""Regression guard for ModuleNotFoundError('No module named app') in production.

Root cause: ContextTask.__call__ runs `from app import app` lazily. Under
`celery -A task worker` the worker's CWD (backend/) is not guaranteed to be on
sys.path at call time, so the import fails even though backend/app.py exists.

Fix (backend/task.py): insert _HERE = os.path.dirname(os.path.abspath(__file__))
into sys.path at module load time, mirroring the precedent in app.py.
"""
import importlib.machinery
import os
import sys


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
