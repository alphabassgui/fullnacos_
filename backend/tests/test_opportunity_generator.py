import json

import httpx
import pytest
from groq import RateLimitError

from agent import prompts


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
        state["calls"].append({"model": model})
        item = responses[state["i"]]
        state["i"] += 1
        if isinstance(item, Exception):
            raise item
        return _Response(item)

    return _Fake(chat=_Fake(completions=_Fake(create=create))), state


@pytest.fixture
def _no_helper_sleep(monkeypatch):
    import agent.groq_client as gc

    monkeypatch.setattr(gc.time, "sleep", lambda *_a, **_k: None)


class _Fake:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)


class _Choice:
    def __init__(self, content):
        self.message = _Fake(content=content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


VALID_ITEM = {
    "title": "Missing pricing page",
    "description": "No pricing info visible.",
    "problem": "Pricing transparency gap.",
    "problem_key": "pricing_transparency",
    "evidence": ["No pricing links found in navigation"],
    "potential_impact": "high",
    "confidence": 0.9,
    "type": "conversion",
}

ANALYSIS = {
    "business_summary": "ACME sells widgets.",
    "target_audience": "SMB owners.",
    "value_proposition": "Fast, reliable widgets.",
    "products_or_services": ["Widgets"],
    "strengths": ["Clear product page"],
    "weaknesses": ["No pricing info"],
    "marketing_signals": [],
    "missing_information": ["Pricing"],
}


@pytest.fixture
def og(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    import agent.opportunity_generator as module

    # opportunity_generator calls load_dotenv() at import, which re-adds
    # GROQ_MODEL from a local .env on the first (uncached) import. Delete it
    # again post-import so the "default model" assertions hold regardless of
    # the ambient .env and test collection order.
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    return module


@pytest.fixture
def fake_client(monkeypatch):
    state = {"calls": []}

    def build(content):
        def create(*, model=None, messages=None, temperature=None, **kwargs):
            # The generator also passes response_format (JSON-schema mode); accept
            # and ignore any extra kwargs so the fake matches the real client call.
            state["calls"].append(
                {"model": model, "messages": messages, "temperature": temperature}
            )
            return _Response(content)

        return _Fake(chat=_Fake(completions=_Fake(create=create)))

    state["build"] = build
    return state


def test_valid_array_returns_validated_opportunities(og, fake_client, monkeypatch):
    payload = json.dumps({"opportunities": [VALID_ITEM]})
    monkeypatch.setattr(og, "client", fake_client["build"](payload))
    result = og.generate_opportunities(ANALYSIS)
    assert result == [VALID_ITEM]
    call = fake_client["calls"][0]
    assert call["model"] == "llama-3.3-70b-versatile"
    assert call["temperature"] == 0.2
    assert call["messages"][0]["content"] == prompts.OPPORTUNITY_GENERATION_SYSTEM_PROMPT
    assert "ACME sells widgets." in call["messages"][1]["content"]


def test_model_reads_groq_model_env(og, fake_client, monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "custom-model")
    monkeypatch.setattr(
        og, "client", fake_client["build"](json.dumps({"opportunities": [VALID_ITEM]}))
    )
    og.generate_opportunities(ANALYSIS)
    assert fake_client["calls"][0]["model"] == "custom-model"


def test_empty_response_raises(og, fake_client, monkeypatch):
    monkeypatch.setattr(og, "client", fake_client["build"](None))
    with pytest.raises(ValueError, match="Groq returned an empty response"):
        og.generate_opportunities(ANALYSIS)


def test_invalid_json_raises(og, fake_client, monkeypatch):
    monkeypatch.setattr(og, "client", fake_client["build"]("not json"))
    with pytest.raises(ValueError, match="Groq returned invalid opportunity JSON"):
        og.generate_opportunities(ANALYSIS)


def test_non_object_payload_raises(og, fake_client, monkeypatch):
    # A bare JSON array (not the expected {"opportunities": [...]} object).
    monkeypatch.setattr(og, "client", fake_client["build"](json.dumps([VALID_ITEM])))
    with pytest.raises(ValueError, match="Opportunity response must be a JSON object"):
        og.generate_opportunities(ANALYSIS)


def test_missing_opportunities_array_raises(og, fake_client, monkeypatch):
    # A JSON object without the required "opportunities" array.
    monkeypatch.setattr(og, "client", fake_client["build"]('{"a": 1}'))
    with pytest.raises(
        ValueError, match="Opportunity response must contain an 'opportunities' array"
    ):
        og.generate_opportunities(ANALYSIS)


def test_schema_violation_raises(og, fake_client, monkeypatch):
    broken = dict(VALID_ITEM, confidence=2)
    monkeypatch.setattr(
        og, "client", fake_client["build"](json.dumps({"opportunities": [broken]}))
    )
    with pytest.raises(ValueError, match="confidence 2 out of range"):
        og.generate_opportunities(ANALYSIS)


def test_retries_on_429_then_succeeds(og, monkeypatch, _no_helper_sleep):
    payload = json.dumps({"opportunities": [VALID_ITEM]})
    client, state = _sequence_client([_rate_limit_error(retry_after=1), payload])
    monkeypatch.setattr(og, "client", client)

    result = og.generate_opportunities(ANALYSIS)

    assert result == [VALID_ITEM]
    assert len(state["calls"]) == 2


def test_fails_over_to_fallback_model(og, monkeypatch, _no_helper_sleep):
    monkeypatch.setenv("GROQ_MODEL", "model-a")
    monkeypatch.setenv("GROQ_MODEL_FALLBACKS", "model-b")
    payload = json.dumps({"opportunities": [VALID_ITEM]})
    client, state = _sequence_client(
        [_rate_limit_error(), _rate_limit_error(), _rate_limit_error(), payload]
    )
    monkeypatch.setattr(og, "client", client)

    result = og.generate_opportunities(ANALYSIS)

    assert result == [VALID_ITEM]
    assert [c["model"] for c in state["calls"]] == [
        "model-a",
        "model-a",
        "model-a",
        "model-b",
    ]


def test_persistent_429_propagates(og, monkeypatch, _no_helper_sleep):
    # opportunity_generator has no retry of its own; the exhausted wrapper
    # error propagates to the caller (prior behavior: exceptions propagate).
    client, _ = _sequence_client([_rate_limit_error() for _ in range(3)])
    monkeypatch.setattr(og, "client", client)

    with pytest.raises(RateLimitError):
        og.generate_opportunities(ANALYSIS)