"""
Shared Groq chat-completions wrapper with rate-limit resilience.

Centralizes two concerns that free-tier Groq usage needs across every call
site (analyzer, opportunity_generator, decision_engine, gtm_engine):

1. 429-aware retry. On a Groq ``RateLimitError`` (HTTP 429) the call is
   retried a bounded number of times. The wait honors the response's
   ``retry-after`` header when present, otherwise exponential backoff.
2. Model failover. The call runs against an ordered model list
   (``[primary] + fallbacks``). ``primary`` is the existing GROQ_MODEL /
   GROQ_VISION_MODEL; fallbacks come from the GROQ_MODEL_FALLBACKS /
   GROQ_VISION_MODEL_FALLBACKS comma-separated env vars. When the fallback
   env var is unset the list is just the primary, preserving prior behavior.

The wrapper returns the raw Groq response object unchanged, so callers keep
their existing parsing. Non-429 exceptions propagate immediately — callers
(e.g. analyzer's JSON-recovery retry, gtm_engine's graceful empty default)
continue to own those paths.
"""

import logging
import os
import time

from openai import OpenAI, RateLimitError

logger = logging.getLogger(__name__)

# OpenRouter is OpenAI-compatible, so we use the OpenAI SDK pointed at
# OpenRouter's base URL. Default endpoint can be overridden via env.
_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

# Hardcoded safety-net model for code editing: an OpenRouter-valid free coder
# so a removed/renamed primary never breaks the pipeline entirely.
_CODE_SAFETY_NET = "recursive/flint-v1.0:free"

# Bounded retries per model before failing over to the next model in the list.
_MAX_ATTEMPTS_PER_MODEL = 3
# Exponential backoff base used only when no retry-after header is provided.
_BASE_BACKOFF_SECONDS = 1.0

# kind -> (new primary env, legacy primary env, default model,
#          new fallbacks env, legacy fallbacks env)
#
# New OPENROUTER_* env vars are read first; the legacy GROQ_* names are kept
# as a fallback so a missed Render rename can't take the pipeline down. All
# defaults are OpenRouter model IDs (the legacy Groq IDs are not valid here).
_MODEL_KINDS = {
    "text": (
        "OPENROUTER_MODEL", "GROQ_MODEL",
        "cohere/north-mini-code:free",
        "OPENROUTER_MODEL_FALLBACKS", "GROQ_MODEL_FALLBACKS",
    ),
    # NOTE: vision needs a multimodal free model. qwen3.8-27b:free is listed
    # free on OpenRouter but its vision support is UNVERIFIED — confirm before
    # relying on image calls, or point OPENROUTER_VISION_MODEL at a known
    # multimodal model.
    "vision": (
        "OPENROUTER_VISION_MODEL", "GROQ_VISION_MODEL",
        "qwen/qwen3.8-27b:free",
        "OPENROUTER_VISION_MODEL_FALLBACKS", "GROQ_VISION_MODEL_FALLBACKS",
    ),
    # Code-editing calls send full file contents. OpenRouter's free tier is
    # request-limited, not token-per-minute limited, so large single-file
    # edits that the old Groq free tier rejected now go through. Primary and
    # fallback are both free coding models with large context windows; the
    # safety net (below) backstops a pulled/renamed primary.
    "code": (
        "OPENROUTER_CODE_MODEL", "GROQ_CODE_MODEL",
        "cohere/north-mini-code:free",
        "OPENROUTER_CODE_MODEL_FALLBACKS", "GROQ_CODE_MODEL_FALLBACKS",
    ),
}


def build_client():
    """Build an OpenRouter (OpenAI-compatible) client, or None if no key.

    Returns None when no API key is configured so importing a call-site
    module never fails just because the key is absent (e.g. in tests, which
    mock ``create_chat_completion`` and never touch the client). Reads the new
    OPENROUTER_API_KEY first, falling back to the legacy GROQ_API_KEY.
    """

    api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("GROQ_API_KEY")
    if not api_key:
        return None
    base_url = os.getenv("OPENROUTER_BASE_URL", _DEFAULT_BASE_URL)
    return OpenAI(api_key=api_key, base_url=base_url)


def effective_models(model_kind):
    """
    Resolve the ordered model list for ``model_kind`` ("text" | "vision").

    Returns ``[primary] + fallbacks`` with duplicates removed while keeping
    order. When the fallbacks env var is unset/empty the result is just the
    primary model, which preserves today's single-model behavior.
    """

    try:
        (
            primary_env, legacy_primary_env, default_model,
            fallbacks_env, legacy_fallbacks_env,
        ) = _MODEL_KINDS[model_kind]
    except KeyError as exc:
        raise ValueError(f"Unknown model_kind: {model_kind!r}") from exc

    # New OPENROUTER_* env wins; legacy GROQ_* is the fallback; then default.
    primary = (
        os.getenv(primary_env)
        or os.getenv(legacy_primary_env)
        or default_model
    )
    fallbacks_raw = (
        os.getenv(fallbacks_env)
        or os.getenv(legacy_fallbacks_env)
        or ""
    )

    models = [primary]
    for candidate in fallbacks_raw.split(","):
        candidate = candidate.strip()
        if candidate and candidate not in models:
            models.append(candidate)

    # Always include a hardcoded safety-net fallback for code editing so a
    # removed or renamed model doesn't break the pipeline entirely.
    if model_kind == "code" and _CODE_SAFETY_NET not in models:
        models.append(_CODE_SAFETY_NET)

    return models


def _retry_after_seconds(exc):
    """Read the ``retry-after`` header (seconds) from a RateLimitError, or None."""

    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None

    value = headers.get("retry-after")
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        # Groq returns seconds; an HTTP-date would not parse -> fall back to backoff.
        return None


def _backoff_seconds(attempt):
    """Exponential backoff: 1s, 2s, 4s, ... for attempt 0, 1, 2, ..."""

    return _BASE_BACKOFF_SECONDS * (2 ** attempt)


def create_chat_completion(
    client,
    *,
    messages,
    model_kind="text",
    temperature=0.2,
    response_format=None,
):
    """
    Run ``client.chat.completions.create`` with 429 retry + model failover.

    Args:
        client: an instantiated Groq client (injected so callers keep their
            own module-level/per-call client and remain patchable in tests).
        messages: the chat messages payload (text or multimodal).
        model_kind: "text" or "vision" — selects which env model list is used.
        temperature: forwarded unchanged.
        response_format: forwarded only when not None (decision_engine sends
            no response_format, so we must not inject one).

    Returns the raw Groq response object. Raises the last RateLimitError if
    every model in the list is exhausted; any non-429 exception propagates
    immediately on first occurrence.
    """

    models = effective_models(model_kind)

    extra = {}
    if response_format is not None:
        extra["response_format"] = response_format

    last_error = None

    for model in models:
        for attempt in range(_MAX_ATTEMPTS_PER_MODEL):
            try:
                return client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    **extra,
                )
            except RateLimitError as exc:
                last_error = exc
                if attempt < _MAX_ATTEMPTS_PER_MODEL - 1:
                    wait = _retry_after_seconds(exc)
                    if wait is None:
                        wait = _backoff_seconds(attempt)
                    logger.warning(
                        "429 on model %s (attempt %d/%d); retrying in %.2fs",
                        model,
                        attempt + 1,
                        _MAX_ATTEMPTS_PER_MODEL,
                        wait,
                    )
                    time.sleep(wait)
                else:
                    logger.warning(
                        "429 exhausted retries on model %s; failing over",
                        model,
                    )

    raise last_error
