import os
import pytest
from unittest.mock import MagicMock

# ── Environment defaults for GTM tests ──────────────────────────────────────
os.environ.setdefault("GROQ_API_KEY", "test-groq-api-key")

# ── Shared app/client fixtures (self-contained, matching repo convention) ───
# Our tests/ suite is flat and has no tests/search_console package to re-export
# from, so these mirror the module-level `app` + session_transaction pattern
# used throughout the existing test files.

@pytest.fixture
def flask_app():
    import app as app_module
    app_module.app.config["TESTING"] = True
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


@pytest.fixture
def auth_client(flask_app):
    c = flask_app.test_client()
    with c.session_transaction() as sess:
        sess["user_id"] = "user-1"  # matches mock_gtm_business_doc owner_id
    return c


# ── GTM-Specific Shared Fixtures ────────────────────────────────────────────

@pytest.fixture
def mock_gtm_business_doc():
    """Firestore business document fixture with owner_id and website_url."""
    doc = MagicMock()
    doc.exists = True
    doc.id = "biz-1"
    doc.to_dict.return_value = {
        "owner_id": "user-1",
        "website_url": "https://example.com",
        "business_name": "Example Corp",
        "industry": "Software",
    }
    return doc


@pytest.fixture
def mock_playwright_page():
    """MagicMock simulating Playwright Page, viewport settings, and screenshot buffers."""
    page = MagicMock()
    page.viewport_size = {"width": 1280, "height": 800}
    page.evaluate.return_value = 2400
    page.screenshot.return_value = b"fake-webp-bytes"
    page.goto.return_value = None
    page.wait_for_load_state.return_value = None
    page.query_selector_all.return_value = []
    page.locator.return_value.count.return_value = 0
    return page


@pytest.fixture
def mock_vision_response():
    """Dict simulating Vision LLM GTM evaluation output across the 4 pillars."""
    return {
        "gtm_scores": {
            "overall": 80,
            "above_the_fold": 75,
            "pricing_clarity": 85,
            "social_proof": 70,
            "cro_friction": 90,
        },
        "blind_spots": [
            "Competitor has explicit pricing, user does not",
        ],
        "opportunities": [
            {
                "title": "Add Transparent Pricing Tier Above The Fold",
                "problem": "Competitor Acme displays $29/mo while user requires contacting sales.",
                "type": "gtm_pricing",
                "potential_impact": "High",
                "confidence": 0.85,
            }
        ],
    }
