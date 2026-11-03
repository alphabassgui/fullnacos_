"""Tests for services.github_edit_service — tree-validated file resolution and
the grounded (real-source) edit generator. The GitHub tree API and the Groq
call are both stubbed so nothing hits the network.
"""

import json
import types

import pytest

import services.github_edit_service as svc


class _TreeAPI:
    def __init__(self, paths, dirs=()):
        self._paths = paths
        self._dirs = dirs

    def get_repository_tree(self, owner, repo, sha):
        tree = [{"path": p, "type": "blob"} for p in self._paths]
        tree += [{"path": d, "type": "tree"} for d in self._dirs]
        return {"sha": sha, "truncated": False, "tree": tree}


# --------------------------------------------------------------------------
# resolve_target_file
# --------------------------------------------------------------------------

def test_evidenced_path_that_exists_is_confirmed():
    api = _TreeAPI(["index.html", "about.html", "src/app/page.tsx"])
    out = svc.resolve_target_file(api, "o", "r", "sha", evidenced_path="about.html")
    assert out == {"status": "confirmed", "path": "about.html"}


def test_evidenced_path_is_normalized_before_matching():
    api = _TreeAPI(["index.html"])
    out = svc.resolve_target_file(api, "o", "r", "sha", evidenced_path="./index.html")
    assert out["status"] == "confirmed"
    assert out["path"] == "index.html"


def test_missing_path_returns_ranked_candidates():
    api = _TreeAPI([
        "README.md",
        "index.html",
        "src/app/layout.tsx",
        "src/utils/math.ts",
    ])
    out = svc.resolve_target_file(api, "o", "r", "sha", evidenced_path="pricing.html")
    assert out["status"] == "needs_confirmation"
    # index.html (homepage) should outrank a deep utility file.
    assert out["candidates"][0] == "index.html"
    assert "src/utils/math.ts" in out["candidates"]  # editable, just low-ranked


def test_build_and_dependency_dirs_are_excluded():
    api = _TreeAPI([
        "node_modules/react/index.js",
        ".next/server/page.js",
        "dist/bundle.js",
        "index.html",
    ])
    out = svc.resolve_target_file(api, "o", "r", "sha", evidenced_path=None)
    assert out["status"] == "needs_confirmation"
    assert out["candidates"] == ["index.html"]


def test_no_editable_files_returns_no_candidates():
    api = _TreeAPI(["data.csv", "image.png", "LICENSE"])
    out = svc.resolve_target_file(api, "o", "r", "sha", evidenced_path="x.html")
    assert out == {"status": "no_candidates"}


# --------------------------------------------------------------------------
# generate_grounded_edit
# --------------------------------------------------------------------------

@pytest.fixture
def llm_client(monkeypatch):
    """A non-None client so the configured-key guard passes; the actual Groq
    call is mocked per-test via create_chat_completion."""
    monkeypatch.setattr(svc, "client", object())


def _fake_response(payload_dict):
    content = json.dumps(payload_dict)
    message = types.SimpleNamespace(content=content)
    choice = types.SimpleNamespace(message=message)
    return types.SimpleNamespace(choices=[choice])


ORIGINAL = "<html><head><title>Old</title></head><body></body></html>"
ACTION = {
    "action_title": "Improve title",
    "description": "Make the title specific.",
}


def test_grounded_edit_returns_changed_content(monkeypatch, llm_client):
    new = ORIGINAL.replace("Old", "Acme Logistics — Lagos")
    monkeypatch.setattr(
        svc, "create_chat_completion",
        lambda *a, **k: _fake_response(
            {"changed": True, "summary": "Rewrote title", "content": new}
        ),
    )
    out = svc.generate_grounded_edit("index.html", ORIGINAL, ACTION)
    assert out["content"] == new
    assert out["summary"] == "Rewrote title"


def test_grounded_edit_rejects_no_change(monkeypatch, llm_client):
    monkeypatch.setattr(
        svc, "create_chat_completion",
        lambda *a, **k: _fake_response(
            {"changed": False, "summary": "Out of scope", "content": ORIGINAL}
        ),
    )
    with pytest.raises(ValueError, match="produced no change"):
        svc.generate_grounded_edit("index.html", ORIGINAL, ACTION)


def test_grounded_edit_rejects_identical_content(monkeypatch, llm_client):
    monkeypatch.setattr(
        svc, "create_chat_completion",
        lambda *a, **k: _fake_response(
            {"changed": True, "summary": "x", "content": ORIGINAL}
        ),
    )
    with pytest.raises(ValueError, match="left the file unchanged"):
        svc.generate_grounded_edit("index.html", ORIGINAL, ACTION)


def test_grounded_edit_rejects_empty_content(monkeypatch, llm_client):
    monkeypatch.setattr(
        svc, "create_chat_completion",
        lambda *a, **k: _fake_response(
            {"changed": True, "summary": "x", "content": "   "}
        ),
    )
    with pytest.raises(ValueError, match="no usable content"):
        svc.generate_grounded_edit("index.html", ORIGINAL, ACTION)


def test_grounded_edit_rejects_invalid_json(monkeypatch, llm_client):
    bad = types.SimpleNamespace(
        choices=[types.SimpleNamespace(
            message=types.SimpleNamespace(content="not json"))]
    )
    monkeypatch.setattr(svc, "create_chat_completion", lambda *a, **k: bad)
    with pytest.raises(ValueError, match="invalid JSON"):
        svc.generate_grounded_edit("index.html", ORIGINAL, ACTION)
