"""Tests for GitHubConnector.execute — it must branch, commit, and open a
Pull Request (the PR is the draft the owner reviews/merges), not stop at a
commit. GitHubAPI and the stored connection are stubbed so nothing touches the
network, matching the monkeypatch style in test_connectors.py.
"""

import base64

import pytest

import connectors.github as gh
from connectors.github import GitHubConnector


_EXISTING_HTML = (
    b"<html><head><title>Old title</title>"
    b"<meta name='description' content='old'></head>"
    b"<body><h1>Welcome</h1></body></html>"
)


class _FakeGitHubAPI:
    """Minimal in-memory GitHub API: enough for branch -> commit -> PR."""

    def __init__(self, access_token=None):
        self.access_token = access_token

    def get_repository(self, owner, repo):
        return {
            "id": 1,
            "full_name": f"{owner}/{repo}",
            "default_branch": "main",
            "private": False,
        }

    def get_branch(self, owner, repo, branch):
        if branch == "main":
            return {"name": "main", "sha": "basesha", "protected": True}
        return None  # the agent branch does not exist yet

    def create_branch(self, owner, repo, branch_name, sha):
        return {"ref": branch_name, "sha": sha}

    def get_file(self, owner, repo, path, ref=None):
        return {
            "name": path,
            "path": path,
            "sha": "filesha",
            "content": base64.b64encode(_EXISTING_HTML).decode("utf-8"),
            "encoding": "base64",
            "download_url": None,
        }

    def update_file(self, owner, repo, path, content, message, branch, sha=None):
        return {
            "commit_sha": "commitsha",
            "content_sha": "newfilesha",
            "path": path,
        }

    def list_pull_requests(self, owner, repo, head=None, base=None, state="open"):
        return []  # no existing PR for this branch

    def create_pull_request(self, owner, repo, title, head, base, body=None):
        return {
            "number": 7,
            "url": "https://github.com/acme/site/pull/7",
            "state": "open",
            "head": head,
            "base": base,
        }


@pytest.fixture
def github_offline(monkeypatch):
    monkeypatch.setattr(gh, "GitHubAPI", _FakeGitHubAPI)
    monkeypatch.setattr(
        gh, "get_connection",
        lambda **kwargs: {
            "access_token": "tok",
            "repository": "acme/site",
            "default_branch": "main",
        },
    )


def _github_action(**overrides):
    action = {
        "action_type": "github",
        "action_title": "Tighten homepage title tag",
        "description": "Rewrite the <title> for clearer SEO.",
        "reasoning": "The current title is generic.",
        "content": (
            "<html><head><title>Acme — Fast Lagos Logistics</title>"
            "<meta name='description' content='Same-day delivery across Lagos'>"
            "</head><body><h1>Welcome</h1></body></html>"
        ),
        "target_path": "index.html",
    }
    action.update(overrides)
    return action


def test_execute_opens_a_pull_request(github_offline):
    result = GitHubConnector().execute(
        _github_action(), "biz-1", "user-1", execution_id="exec-1234567890ab"
    )

    assert result["success"] is True
    assert result["status"] == "github_pr_opened"
    assert result["repository"] == "acme/site"
    assert result["target_path"] == "index.html"

    pr = result["pull_request"]
    assert pr["number"] == 7
    assert pr["url"] == "https://github.com/acme/site/pull/7"
    assert pr["base"] == "main"


def test_execute_never_targets_the_default_branch(github_offline):
    result = GitHubConnector().execute(
        _github_action(), "biz-1", "user-1", execution_id="exec-1234567890ab"
    )
    # The commit lands on an agent/* branch, and the PR targets main — a direct
    # push to the default branch is never performed.
    assert result["branch"]["base_branch"] == "main"
    assert result["branch"]["branch"].startswith("agent/")
    assert result["pull_request"]["head"] != "main"


def test_execute_generates_content_when_absent(github_offline, monkeypatch):
    # A planned action has content=None: the connector must generate it from
    # the real file (Option 1), confirming the path first, then open the PR.
    import services.github_edit_service as edit_svc

    seen = {}

    def fake_resolve(github_api, owner, repo, base_sha, evidenced_path=None,
                     **kwargs):
        seen["resolved"] = evidenced_path
        return {"status": "confirmed", "path": evidenced_path}

    def fake_generate(path, original_content, action):
        seen["generated_from"] = original_content
        return {
            "content": original_content.replace("Old title", "New title"),
            "summary": "Updated the homepage <title>.",
        }

    monkeypatch.setattr(edit_svc, "resolve_target_file", fake_resolve)
    monkeypatch.setattr(edit_svc, "generate_grounded_edit", fake_generate)

    result = GitHubConnector().execute(
        _github_action(content=None),
        "biz-1", "user-1", execution_id="exec-1234567890ab",
    )

    assert result["status"] == "github_pr_opened"
    assert result["pull_request"]["number"] == 7
    assert seen["resolved"] == "index.html"
    # The edit was generated from the file's REAL current contents.
    assert "Old title" in seen["generated_from"]


def test_execute_rejects_path_not_in_tree(github_offline, monkeypatch):
    import services.github_edit_service as edit_svc

    monkeypatch.setattr(
        edit_svc, "resolve_target_file",
        lambda *a, **k: {"status": "needs_confirmation",
                         "candidates": ["index.html", "about.html"]},
    )

    with pytest.raises(ValueError, match="was not found in the repository"):
        GitHubConnector().execute(
            _github_action(content=None, target_path="pricing.html"),
            "biz-1", "user-1", execution_id="exec-1234567890ab",
        )


def test_execute_rejects_absolute_target_path(github_offline):
    with pytest.raises(ValueError, match="relative to the repository root"):
        GitHubConnector().execute(
            _github_action(target_path="/etc/passwd"),
            "biz-1", "user-1", execution_id="exec-1234567890ab",
        )


def test_execute_rejects_path_traversal(github_offline):
    with pytest.raises(ValueError, match="parent-directory traversal"):
        GitHubConnector().execute(
            _github_action(target_path="../../secrets.txt"),
            "biz-1", "user-1", execution_id="exec-1234567890ab",
        )


def test_pr_body_states_it_is_a_proposal():
    body = GitHubConnector._build_pr_body(_github_action())
    assert "Rewrite the <title>" in body
    assert "nothing is live until you review and merge" in body
