"""Resilience tests for website_analyzer.fetch_website_html.

These exercise the three scraping-resilience layers without touching the
network: realistic browser headers, a Playwright fallback on WAF-blocked
responses, and graceful failure when everything is blocked.

DNS pinning / SSRF validation (validate_and_pin + _pin_dns) do real socket
work, so they are monkeypatched to no-ops here — the fetch logic under test is
the status handling and header/fallback wiring, not the (separately tested)
network policy.
"""

import contextlib

import pytest

import website_analyzer as wa


class _FakeResponse:
    def __init__(self, status_code, *, content_type="text/html",
                 body=b"<html><title>ok</title></html>", content_length=None):
        self.status_code = status_code
        self._headers = {"Content-Type": content_type}
        if content_length is not None:
            self._headers["Content-Length"] = str(content_length)
        self._body = body
        self.closed = False

    @property
    def headers(self):
        return self._headers

    def iter_content(self, chunk_size=8192):
        yield self._body

    def close(self):
        self.closed = True


class _FakeSession:
    """Records the kwargs of each .get() and returns a preset response."""

    def __init__(self, response):
        self._response = response
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self._response


@pytest.fixture
def no_network(monkeypatch):
    """Bypass the real DNS/SSRF machinery so tests stay offline."""
    monkeypatch.setattr(wa, "validate_and_pin", lambda url: (url, "203.0.113.1"))

    @contextlib.contextmanager
    def _fake_pin(hostname, ip):
        yield

    monkeypatch.setattr(wa, "_pin_dns", _fake_pin)


URL = "https://acme.example/"


def test_200_returns_html_unchanged(no_network):
    body = b"<html><title>Acme</title></html>"
    session = _FakeSession(_FakeResponse(200, body=body))

    html, final_url = wa.fetch_website_html(URL, session=session)

    assert html == body
    assert final_url == URL


def test_outgoing_user_agent_is_a_real_browser(no_network):
    session = _FakeSession(_FakeResponse(200))

    wa.fetch_website_html(URL, session=session)

    sent = session.calls[0]["headers"]
    ua = sent["User-Agent"]
    # A realistic modern-browser UA, not the retired bot string.
    assert "Mozilla/5.0" in ua
    assert "Chrome/" in ua
    assert "Bot" not in ua
    assert ua != "AI-Growth-Agent/1.0 (Website Analysis Bot)"
    # The ordinary browser headers travel with it.
    assert "Accept" in sent and "Accept-Language" in sent


@pytest.mark.parametrize("status", [403, 429, 503])
def test_blocked_status_triggers_playwright_fallback(no_network, monkeypatch, status):
    session = _FakeSession(_FakeResponse(status))
    seen = []

    def fake_playwright(url):
        seen.append(url)
        return b"<html>via-playwright</html>"

    monkeypatch.setattr(wa, "_fetch_html_via_playwright", fake_playwright)

    html, final_url = wa.fetch_website_html(URL, session=session)

    assert html == b"<html>via-playwright</html>"
    assert final_url == URL
    assert seen == [URL]  # fallback was taken, against the validated URL


def test_both_paths_blocked_raises(no_network, monkeypatch):
    session = _FakeSession(_FakeResponse(403))
    # Playwright unavailable / also blocked -> soft-fail to None.
    monkeypatch.setattr(wa, "_fetch_html_via_playwright", lambda url: None)

    with pytest.raises(ValueError, match="HTTP 403"):
        wa.fetch_website_html(URL, session=session)


def test_playwright_helper_soft_fails_to_none(monkeypatch):
    # Simulate Chromium/Playwright launch blowing up (missing browser / OOM).
    import playwright.sync_api as pw_api

    def boom(*_a, **_k):
        raise RuntimeError("chromium not installed")

    monkeypatch.setattr(pw_api, "sync_playwright", boom)

    assert wa._fetch_html_via_playwright(URL) is None
