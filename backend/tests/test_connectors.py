import inspect

import pytest

from connectors import get_connector
from connectors.dry_run import DryRunConnector
from connectors.github import GitHubConnector
from connectors.instagram import InstagramConnector
from connectors.draft_only import DraftOnlyConnector


# Types with no real write path. They used to raise (content/seo/…) or fake a
# dry-run success (website); now they all route to the honest draft-only fallback.
DRAFT_ONLY_TYPES = ["website", "content", "seo", "email", "research", "other"]


@pytest.mark.parametrize(
    "connector_cls",
    [InstagramConnector, DryRunConnector, DraftOnlyConnector, GitHubConnector],
)
def test_execute_accepts_execution_id_kwarg(connector_cls):
    # The execution engine calls connector.execute(action, business_id, user_id,
    # execution_id=execution_id), so every connector must accept that keyword or
    # a real execution raises TypeError.
    params = inspect.signature(connector_cls.execute).parameters
    assert "execution_id" in params


def test_get_connector_social_returns_instagram_connector():
    connector = get_connector({"action_type": "social"})
    assert isinstance(connector, InstagramConnector)


def test_get_connector_github_returns_github_connector():
    connector = get_connector({"action_type": "github"})
    assert isinstance(connector, GitHubConnector)


@pytest.mark.parametrize("action_type", DRAFT_ONLY_TYPES)
def test_get_connector_no_write_path_returns_draft_only(action_type):
    # No crash on approve: these resolve to the honest draft-only fallback.
    connector = get_connector({"action_type": action_type})
    assert isinstance(connector, DraftOnlyConnector)


def test_draft_only_execute_is_honest_not_a_fake_success():
    # success is True (the draft exists), but the status/message make clear nothing
    # was published — never the old "validated successfully" wording.
    result = DraftOnlyConnector().execute(
        {"action_type": "seo", "action_title": "Improve meta description"},
        "biz-1",
        "user-1",
        execution_id="exec-1",
    )
    assert result["success"] is True
    assert result["status"] == "drafted_pending_manual"
    assert "nothing was published" in result["message"].lower()
    assert "validated successfully" not in result["message"].lower()


@pytest.mark.parametrize(
    "action",
    [{}, {"action_type": None}, {"action_type": ""}],
)
def test_get_connector_missing_or_blank_action_type_raises(action):
    # A malformed action (no type) is a bug, not a draft — it still raises.
    with pytest.raises(ValueError, match="No connector available for action type"):
        get_connector(action)


class _FakeInstagramAPI:
    """Stubs the Instagram Graph API so the connector's publish flow runs offline."""

    def __init__(self, access_token=None):
        self.access_token = access_token

    def create_media_container(self, image_url=None, caption=None):
        return "container-123"

    def get_media_container_status(self, container_id):
        return {"status_code": "FINISHED"}

    def publish_media(self, container_id):
        return "media-456"


def test_instagram_connector_publishes_social_image_action(monkeypatch):
    import connectors.instagram as ig

    monkeypatch.setattr(
        ig, "get_connection",
        lambda **kwargs: {"access_token": "tok", "account_id": "acct-1"},
    )
    monkeypatch.setattr(ig, "InstagramAPI", _FakeInstagramAPI)

    action = {
        "action_type": "social",
        "content_type": "image",
        "image_url": "https://example.com/pic.jpg",
        "caption": "hello",
    }
    result = InstagramConnector().execute(action, "b1", "u1")

    assert result["success"] is True
    assert result["status"] == "published"
    assert result["instagram_media_id"] == "media-456"
    assert result["container_id"] == "container-123"
    assert result["instagram_account_id"] == "acct-1"


def test_instagram_connector_rejects_non_social_action():
    with pytest.raises(ValueError, match="only supports social actions"):
        InstagramConnector().execute({"action_type": "email"}, "b1", "u1")