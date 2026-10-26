"""
Unit tests for agent.decision_engine (generate_action + 429 retry/failover).
"""
import json

import httpx
import pytest
from groq import RateLimitError

from agent import prompts


class _Fake:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)


class _Choice:
    def __init__(self, content):
        self.message = _Fake(content=content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


VALID_ACTION = {
    "action_title": "Publish transparent pricing page",
    "action_type": "website",
    "objective": "Increase conversion by clarifying pricing.",
    "description": "Create a pricing page with three tiers.",
    "reasoning": "Competitors expose pricing; the user does not.",
    "expected_outcome": "Higher trial sign-up rate.",
    "required_inputs": ["pricing tiers"],
    "requires_approval": True,
    "content_type": "page",
    "page_url": "https://acme.test/pricing",
    "content": "Starter / Pro / Enterprise",
    "target_path": "/pricing",
}

OPPORTUNITY = {"title": "Missing pricing page", "problem_key": "pricing_transparency"}
ANALYSIS = {"business_summary": "ACME sells widgets."}


def _rate_limit_error(retry_after=None):
    headers = {}
    if retry_after is not None:
        headers["retry-after"] = str(retry_after)
    request = httpx.Request(
        "POST", "https://api.groq.com/openai/v1/chat/completions"
    )
    response = httpx.Response(status_code=429, headers=headers, request=request)
    return RateLimitError("rate limited", response=response, body=None)


def _sequence_client(responses):
    state = {"i": 0, "calls": []}

    def create(*, model=None, messages=None, temperature=None, **kwargs):
        state["calls"].append({"model": model, "kwargs": kwargs})
        item = responses[state["i"]]
        state["i"] += 1
        if isinstance(item, Exception):
            raise item
        return _Response(item)

    return _Fake(chat=_Fake(completions=_Fake(create=create))), state


@pytest.fixture
def de(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    import agent.decision_engine as module

    # generate_action pulls historical learnings from Firestore; stub it out.
    monkeypatch.setattr(module, "get_business_learnings", lambda **_k: [])
    # 429 backoff sleeps inside the groq_client wrapper.
    import agent.groq_client as gc

    monkeypatch.setattr(gc.time, "sleep", lambda *_a, **_k: None)
    return module


def test_generate_action_success(de, monkeypatch):
    client, state = _sequence_client([json.dumps(VALID_ACTION)])
    monkeypatch.setattr(de, "client", client)

    result = de.generate_action(OPPORTUNITY, ANALYSIS, business_id="biz-1")

    assert result["action_title"] == VALID_ACTION["action_title"]
    assert len(state["calls"]) == 1
    # decision_engine sends no response_format; wrapper must not inject one.
    assert state["calls"][0]["kwargs"] == {}


def test_generate_action_requires_business_id(de):
    with pytest.raises(ValueError, match="business_id is required"):
        de.generate_action(OPPORTUNITY, ANALYSIS, business_id="")


def test_generate_action_retries_on_429_then_succeeds(de, monkeypatch):
    client, state = _sequence_client(
        [_rate_limit_error(retry_after=1), json.dumps(VALID_ACTION)]
    )
    monkeypatch.setattr(de, "client", client)

    result = de.generate_action(OPPORTUNITY, ANALYSIS, business_id="biz-1")

    assert result["action_title"] == VALID_ACTION["action_title"]
    assert len(state["calls"]) == 2


def test_generate_action_fails_over_to_fallback_model(de, monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "model-a")
    monkeypatch.setenv("GROQ_MODEL_FALLBACKS", "model-b")
    client, state = _sequence_client(
        [
            _rate_limit_error(),
            _rate_limit_error(),
            _rate_limit_error(),
            json.dumps(VALID_ACTION),
        ]
    )
    monkeypatch.setattr(de, "client", client)

    result = de.generate_action(OPPORTUNITY, ANALYSIS, business_id="biz-1")

    assert result["action_title"] == VALID_ACTION["action_title"]
    assert [c["model"] for c in state["calls"]] == [
        "model-a",
        "model-a",
        "model-a",
        "model-b",
    ]


def test_generate_action_persistent_429_propagates(de, monkeypatch):
    # decision_engine has no retry of its own; the exhausted wrapper error
    # propagates to the caller (prior behavior: exceptions propagate).
    client, _ = _sequence_client([_rate_limit_error() for _ in range(3)])
    monkeypatch.setattr(de, "client", client)

    with pytest.raises(RateLimitError):
        de.generate_action(OPPORTUNITY, ANALYSIS, business_id="biz-1")
