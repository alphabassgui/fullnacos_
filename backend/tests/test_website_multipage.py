"""Tests for website_analyzer.analyze_site — the multi-page enrichment that
follows key internal links so the opportunity generator stops hallucinating
gaps for pages that actually exist.

Like test_fetch_resilience, these stay offline: validate_and_pin / _pin_dns are
monkeypatched to no-ops, and a per-URL fake session serves preset HTML.
"""

import contextlib

import pytest

import website_analyzer as wa


class _FakeResponse:
    def __init__(self, body, status_code=200, content_type="text/html"):
        self.status_code = status_code
        self._headers = {"Content-Type": content_type}
        self._body = body
        self.closed = False

    @property
    def headers(self):
        return self._headers

    def iter_content(self, chunk_size=8192):
        yield self._body

    def close(self):
        self.closed = True


class _MultiSession:
    """Serves a different response per URL; 404s anything not in the map."""

    def __init__(self, bodies):
        # bodies: {url: html_bytes}
        self._bodies = bodies
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        body = self._bodies.get(url)
        if body is None:
            return _FakeResponse(b"", status_code=404)
        return _FakeResponse(body)


@pytest.fixture
def no_network(monkeypatch):
    monkeypatch.setattr(wa, "validate_and_pin", lambda url: (url, "203.0.113.1"))

    @contextlib.contextmanager
    def _fake_pin(hostname, ip):
        yield

    monkeypatch.setattr(wa, "_pin_dns", _fake_pin)
    # Never fall through to a real headless browser in these tests.
    monkeypatch.setattr(wa, "_fetch_html_via_playwright", lambda url: None)


BASE = "https://acme.example/"

HOMEPAGE_LINKS = [
    {"text": "Pricing", "href": "/pricing"},
    {"text": "Contact us", "href": "/contact"},
    {"text": "About", "href": "/about"},
    {"text": "Follow us", "href": "https://twitter.com/acme"},  # off-site
    {"text": "Home", "href": "/"},  # self-link, must be skipped
]


def _homepage_analysis(links=HOMEPAGE_LINKS):
    return {
        "title": "Acme",
        "description": "Acme home",
        "meta_description": "Acme home",
        "headings": ["Welcome"],
        "links": links,
    }


def test_follows_key_internal_links_and_builds_inventory(no_network):
    session = _MultiSession({
        "https://acme.example/pricing": b"<html><title>Pricing</title>"
                                        b"<h2>Plans</h2></html>",
        "https://acme.example/contact": b"<html><title>Contact</title></html>",
        "https://acme.example/about": b"<html><title>About</title></html>",
    })

    enriched = wa.analyze_site(_homepage_analysis(), BASE, session=session)

    inv = enriched["site_inventory"]
    assert inv["has_pricing_page"] is True
    assert inv["has_contact_page"] is True
    assert inv["has_about_page"] is True
    assert inv["has_services_page"] is False  # none linked
    assert inv["pages_fetched"] == 3

    categories = {p["category"] for p in enriched["pages"]}
    assert categories == {"pricing", "contact", "about"}
    pricing = next(p for p in enriched["pages"] if p["category"] == "pricing")
    assert pricing["title"] == "Pricing"
    assert "Plans" in pricing["headings"]


def test_homepage_fields_preserved_unchanged(no_network):
    session = _MultiSession({"https://acme.example/pricing": b"<title>P</title>"})
    original = _homepage_analysis()

    enriched = wa.analyze_site(original, BASE, session=session)

    for key in ("title", "description", "meta_description", "headings", "links"):
        assert enriched[key] == original[key]


def test_offsite_and_self_links_are_not_followed(no_network):
    session = _MultiSession({
        "https://acme.example/pricing": b"<title>P</title>",
        "https://acme.example/contact": b"<title>C</title>",
        "https://acme.example/about": b"<title>A</title>",
    })

    wa.analyze_site(_homepage_analysis(), BASE, session=session)

    # The off-site twitter link and the "/" self-link are never fetched.
    assert "https://twitter.com/acme" not in session.calls
    assert BASE not in session.calls


def test_flag_stays_true_when_subpage_fetch_fails(no_network):
    # Pricing is linked on the homepage but its page 404s on fetch.
    session = _MultiSession({
        "https://acme.example/contact": b"<title>Contact</title>",
    })

    enriched = wa.analyze_site(_homepage_analysis(), BASE, session=session)

    # Evidence is the homepage link, so the flag is True even though the
    # fetch failed — this is exactly what kills the false "no pricing" gap.
    assert enriched["site_inventory"]["has_pricing_page"] is True
    # ...but only successfully-read pages carry content.
    assert {p["category"] for p in enriched["pages"]} == {"contact"}


def test_extra_page_cap_is_respected(no_network):
    links = [
        {"text": "Pricing", "href": "/pricing"},
        {"text": "Contact", "href": "/contact"},
        {"text": "About", "href": "/about"},
        {"text": "Services", "href": "/services"},
    ]
    bodies = {
        f"https://acme.example/{p}": b"<title>x</title>"
        for p in ("pricing", "contact", "about", "services")
    }
    session = _MultiSession(bodies)

    enriched = wa.analyze_site(
        _homepage_analysis(links), BASE, session=session, max_extra_pages=2
    )

    assert enriched["site_inventory"]["pages_discovered"] == 2
    assert len(session.calls) == 2
