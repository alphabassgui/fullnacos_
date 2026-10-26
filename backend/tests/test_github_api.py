from urllib.parse import parse_qs, urlparse

from connectors import github_api


def test_authorization_url_forces_account_picker(monkeypatch):
    # get_authorization_url reads these as module-level globals, so stub them
    # on the module (same monkeypatch.setattr pattern the suite uses elsewhere).
    monkeypatch.setattr(github_api, "GITHUB_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(
        github_api, "GITHUB_REDIRECT_URI", "https://app.example.com/callback"
    )

    url = github_api.GitHubAPI.get_authorization_url("some-state")

    query = parse_qs(urlparse(url).query)

    # The one behavior change: GitHub is asked to show its account picker.
    assert query["prompt"] == ["select_account"]

    # The pre-existing params must still be present, so the addition did not
    # displace anything.
    assert query["client_id"] == ["test-client-id"]
    assert query["scope"] == ["repo"]
    assert query["state"] == ["some-state"]
