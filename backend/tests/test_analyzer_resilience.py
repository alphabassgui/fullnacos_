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


class _Fake:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)


class _Choice:
    def __init__(self, content):
        self.message = _Fake(content=content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


VALID_ANALYSIS = {
    "business_summary": "ACME sells widgets.",
    "target_audience": "SMB owners.",
    "value_proposition": "Fast, reliable widgets.",
    "products_or_services": ["Widgets"],
    "strengths": ["Clear product page"],
    "weaknesses": ["No pricing info"],
    "marketing_signals": [],
    "missing_information": ["Pricing"],
}

OBSERVATION = {
    "source_url": "https://acme.test",
    "final_url": "https://acme.test/",
    "analysis": {
        "title": "ACME Widgets",
        "meta_description": "We sell widgets.",
        "headings": ["Welcome"],
        "links": ["https://acme.test/about"],
    },
}


@pytest.fixture
def analyzer(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    import agent.analyzer as module

    # Never actually sleep during the retry backoff.
    monkeypatch.setattr(module.time, "sleep", lambda *_a, **_k: None)
    return module


def _sequence_client(responses):
    """
    Build a fake Groq client whose create() yields one entry from
    ``responses`` per call. An entry that is an Exception is raised;
    otherwise it is treated as the message content and wrapped in a
    response object.
    """

    state = {"i": 0, "calls": []}

    def create(*, model=None, messages=None, temperature=None,
               response_format=None):
        state["calls"].append(
            {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "response_format": response_format,
            }
        )
        item = responses[state["i"]]
        state["i"] += 1
        if isinstance(item, Exception):
            raise item
        return _Response(item)

    client = _Fake(chat=_Fake(completions=_Fake(create=create)))
    return client, state


def test_salvage_recovers_fenced_json_with_prose(analyzer, monkeypatch):
    messy = (
        "Here is the analysis you asked for:\n"
        "```json\n" + json.dumps(VALID_ANALYSIS) + "\n```\n"
        "Let me know if you need anything else."
    )
    client, state = _sequence_client([messy])
    monkeypatch.setattr(analyzer, "client", client)

    result = analyzer.analyze_observation(OBSERVATION)

    assert result == VALID_ANALYSIS
    # Succeeded on the first attempt via the salvage path.
    assert len(state["calls"]) == 1
    call = state["calls"][0]
    assert call["response_format"] == {"type": "json_object"}
    assert call["model"] == "llama-3.3-70b-versatile"
    assert call["temperature"] == 0.2
    assert (
        call["messages"][0]["content"]
        == prompts.OBSERVATION_ANALYSIS_SYSTEM_PROMPT
    )


def test_retries_then_succeeds(analyzer, monkeypatch):
    client, state = _sequence_client(
        [
            RuntimeError("transient API error"),
            "",  # empty response -> retried
            json.dumps(VALID_ANALYSIS),
        ]
    )
    monkeypatch.setattr(analyzer, "client", client)

    result = analyzer.analyze_observation(OBSERVATION)

    assert result == VALID_ANALYSIS
    assert len(state["calls"]) == 3


def test_all_attempts_garbage_raises_value_error(analyzer, monkeypatch):
    client, state = _sequence_client(
        ["not json at all", "still not json", "nope"]
    )
    monkeypatch.setattr(analyzer, "client", client)

    with pytest.raises(ValueError, match="after 3 attempts"):
        analyzer.analyze_observation(OBSERVATION)

    assert len(state["calls"]) == 3


@pytest.fixture
def _no_helper_sleep(monkeypatch):
    # The 429 backoff sleeps inside the groq_client wrapper, not analyzer.
    import agent.groq_client as gc

    monkeypatch.setattr(gc.time, "sleep", lambda *_a, **_k: None)


def test_analyzer_retries_on_429_then_succeeds(
    analyzer, monkeypatch, _no_helper_sleep
):
    client, state = _sequence_client(
        [_rate_limit_error(retry_after=1), json.dumps(VALID_ANALYSIS)]
    )
    monkeypatch.setattr(analyzer, "client", client)

    result = analyzer.analyze_observation(OBSERVATION)

    assert result == VALID_ANALYSIS
    # Wrapper absorbed the 429 and retried on the same primary model.
    assert [c["model"] for c in state["calls"]] == [
        "llama-3.3-70b-versatile",
        "llama-3.3-70b-versatile",
    ]


def test_analyzer_fails_over_to_fallback_model(
    analyzer, monkeypatch, _no_helper_sleep
):
    monkeypatch.setenv("GROQ_MODEL", "model-a")
    monkeypatch.setenv("GROQ_MODEL_FALLBACKS", "model-b")
    # model-a 429s on all 3 attempts, then model-b returns valid analysis.
    client, state = _sequence_client(
        [
            _rate_limit_error(),
            _rate_limit_error(),
            _rate_limit_error(),
            json.dumps(VALID_ANALYSIS),
        ]
    )
    monkeypatch.setattr(analyzer, "client", client)

    result = analyzer.analyze_observation(OBSERVATION)

    assert result == VALID_ANALYSIS
    assert [c["model"] for c in state["calls"]] == [
        "model-a",
        "model-a",
        "model-a",
        "model-b",
    ]


def test_analyzer_persistent_429_still_raises_value_error(
    analyzer, monkeypatch, _no_helper_sleep
):
    # Every call 429s; the wrapper exhausts and analyzer's JSON-recovery loop
    # surfaces the same ValueError it always has.
    client, state = _sequence_client([_rate_limit_error() for _ in range(20)])
    monkeypatch.setattr(analyzer, "client", client)

    with pytest.raises(ValueError, match="after 3 attempts"):
        analyzer.analyze_observation(OBSERVATION)
