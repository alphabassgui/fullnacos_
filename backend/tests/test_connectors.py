import pytest

from connectors import get_connector
from connectors.instagram import InstagramConnector


# "website" and "social" are routed; these remain without a connector.
UNROUTED_TYPES = ["content", "seo", "email", "research", "other"]


def test_get_connector_social_returns_instagram_connector():
    connector = get_connector({"action_type": "social"})
    assert isinstance(connector, InstagramConnector)


@pytest.mark.parametrize("action_type", UNROUTED_TYPES)
def test_get_connector_unrouted_action_type_raises(action_type):
    with pytest.raises(ValueError, match="No connector available for action type"):
        get_connector({"action_type": action_type})


@pytest.mark.parametrize(
    "action",
    [{}, {"action_type": None}, {"action_type": ""}],
)
def test_get_connector_missing_or_blank_action_type_raises(action):
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