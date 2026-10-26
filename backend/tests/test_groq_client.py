"""
Unit tests for agent.groq_client (429 retry + model failover wrapper).
"""
import httpx
import pytest
from groq import RateLimitError

import agent.groq_client as gc


class _Fake:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)


class _Choice:
    def __init__(self, content):
        self.message = _Fake(content=content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


def _rate_limit_error(retry_after=None):
    """Build a genuine groq.RateLimitError, optionally carrying retry-after."""
    headers = {}
    if retry_after is not None:
        headers["retry-after"] = str(retry_after)
    request = httpx.Request(
        "POST", "https://api.groq.com/openai/v1/chat/completions"
    )
    response = httpx.Response(status_code=429, headers=headers, request=request)
    return RateLimitError("rate limited", response=response, body=None)


def _sequence_client(responses):
    """
    Fake Groq client whose create() yields one entry from ``responses`` per
    call. An Exception entry is raised; anything else is wrapped as content.
    Records every call's model so failover can be asserted.
    """
    state = {"i": 0, "calls": []}

    def create(*, model=None, messages=None, temperature=None, **kwargs):
        state["calls"].append({"model": model, "messages": messages})
        item = responses[state["i"]]
        state["i"] += 1
        if isinstance(item, Exception):
            raise item
        return _Response(item)

    client = _Fake(chat=_Fake(completions=_Fake(create=create)))
    return client, state


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    # Never actually sleep; record the waits the wrapper chose.
    waits = []
    monkeypatch.setattr(gc.time, "sleep", lambda s: waits.append(s))
    return waits


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in (
        "GROQ_MODEL",
        "GROQ_VISION_MODEL",
        "GROQ_MODEL_FALLBACKS",
        "GROQ_VISION_MODEL_FALLBACKS",
    ):
        monkeypatch.delenv(var, raising=False)


def test_effective_models_primary_only_when_fallbacks_unset():
    assert gc.effective_models("text") == ["llama-3.3-70b-versatile"]
    assert gc.effective_models("vision") == ["qwen/qwen3.8-27b"]


def test_effective_models_appends_fallbacks(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "primary-text")
    monkeypatch.setenv("GROQ_MODEL_FALLBACKS", " fb-1 , fb-2 ,fb-1, ")
    # Dedup + strip + skip empties, primary first.
    assert gc.effective_models("text") == ["primary-text", "fb-1", "fb-2"]


def test_success_first_call_returns_response():
    client, state = _sequence_client(["ok"])
    resp = gc.create_chat_completion(client, messages=[], model_kind="text")
    assert resp.choices[0].message.content == "ok"
    assert len(state["calls"]) == 1
    assert state["calls"][0]["model"] == "llama-3.3-70b-versatile"


def test_429_then_success_same_model(_no_sleep):
    client, state = _sequence_client([_rate_limit_error(), "ok"])
    resp = gc.create_chat_completion(client, messages=[], model_kind="text")
    assert resp.choices[0].message.content == "ok"
    # Two calls, both on the same primary model (no failover yet).
    assert [c["model"] for c in state["calls"]] == [
        "llama-3.3-70b-versatile",
        "llama-3.3-70b-versatile",
    ]


def test_retry_after_header_honored(_no_sleep):
    client, state = _sequence_client([_rate_limit_error(retry_after=7), "ok"])
    gc.create_chat_completion(client, messages=[], model_kind="text")
    # The wait used the header value, not exponential backoff.
    assert _no_sleep == [7.0]


def test_backoff_used_when_no_retry_after(_no_sleep):
    client, _ = _sequence_client(
        [_rate_limit_error(), _rate_limit_error(), "ok"]
    )
    gc.create_chat_completion(client, messages=[], model_kind="text")
    # Exponential backoff 1s then 2s across two retries on the same model.
    assert _no_sleep == [1.0, 2.0]


def test_failover_to_next_model(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "model-a")
    monkeypatch.setenv("GROQ_MODEL_FALLBACKS", "model-b")
    # model-a exhausts its 3 attempts with 429s, then model-b succeeds.
    client, state = _sequence_client(
        [
            _rate_limit_error(),
            _rate_limit_error(),
            _rate_limit_error(),
            "ok",
        ]
    )
    resp = gc.create_chat_completion(client, messages=[], model_kind="text")
    assert resp.choices[0].message.content == "ok"
    models = [c["model"] for c in state["calls"]]
    assert models == ["model-a", "model-a", "model-a", "model-b"]


def test_all_models_exhausted_raises_rate_limit_error(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "model-a")
    monkeypatch.setenv("GROQ_MODEL_FALLBACKS", "model-b")
    # Both models 429 on every attempt (3 + 3 calls).
    client, state = _sequence_client([_rate_limit_error() for _ in range(6)])
    with pytest.raises(RateLimitError):
        gc.create_chat_completion(client, messages=[], model_kind="text")
    assert len(state["calls"]) == 6


def test_non_429_exception_propagates_without_retry():
    client, state = _sequence_client([RuntimeError("boom"), "ok"])
    with pytest.raises(RuntimeError, match="boom"):
        gc.create_chat_completion(client, messages=[], model_kind="text")
    # No retry on a non-429 error.
    assert len(state["calls"]) == 1


def test_response_format_omitted_when_none():
    captured = {}

    def create(*, model=None, messages=None, temperature=None, **kwargs):
        captured["kwargs"] = kwargs
        return _Response("ok")

    client = _Fake(chat=_Fake(completions=_Fake(create=create)))
    gc.create_chat_completion(client, messages=[], model_kind="text")
    assert "response_format" not in captured["kwargs"]


def test_response_format_forwarded_when_set():
    captured = {}

    def create(*, model=None, messages=None, temperature=None, **kwargs):
        captured["kwargs"] = kwargs
        return _Response("ok")

    client = _Fake(chat=_Fake(completions=_Fake(create=create)))
    gc.create_chat_completion(
        client,
        messages=[],
        model_kind="text",
        response_format={"type": "json_object"},
    )
    assert captured["kwargs"]["response_format"] == {"type": "json_object"}
