"""Smoke test: the Flask app must import and boot cleanly with no firebase
packages available. This is the key guard against any lingering module-level
import of firebase_admin or google.cloud.firestore that would crash startup
once the packages are removed from requirements.txt."""
import sys


def test_app_boots_without_firebase(monkeypatch):
    # Block firebase packages at the import level so this test proves the app
    # can boot in an environment where they are not installed.
    monkeypatch.setitem(sys.modules, "firebase_admin", None)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore", None)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore_v1", None)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore_v1.base_query", None)

    import importlib
    import app as app_module
    importlib.reload(app_module)
    assert app_module.app is not None
