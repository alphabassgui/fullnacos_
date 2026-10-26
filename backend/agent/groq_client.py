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

from groq import RateLimitError

logger = logging.getLogger(__name__)

# Bounded retries per model before failing over to the next model in the list.
_MAX_ATTEMPTS_PER_MODEL = 3
# Exponential backoff base used only when no retry-after header is provided.
_BASE_BACKOFF_SECONDS = 1.0

# kind -> (primary env var, default model, fallbacks env var)
_MODEL_KINDS = {
    "text": ("GROQ_MODEL", "llama-3.3-70b-versatile", "GROQ_MODEL_FALLBACKS"),
    "vision": ("GROQ_VISION_MODEL", "qwen/qwen3.8-27b", "GROQ_VISION_MODEL_FALLBACKS"),
}


def effective_models(model_kind):
    """
    Resolve the ordered model list for ``model_kind`` ("text" | "vision").

    Returns ``[primary] + fallbacks`` with duplicates removed while keeping
    order. When the fallbacks env var is unset/empty the result is just the
    primary model, which preserves today's single-model behavior.
    """

    try:
        primary_env, default_model, fallbacks_env = _MODEL_KINDS[model_kind]
    except KeyError as exc:
        raise ValueError(f"Unknown model_kind: {model_kind!r}") from exc

    primary = os.getenv(primary_env, default_model)
    fallbacks_raw = os.getenv(fallbacks_env, "")

    models = [primary]
    for candidate in fallbacks_raw.split(","):
        candidate = candidate.strip()
        if candidate and candidate not in models:
            models.append(candidate)

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
                        "Groq 429 on model %s (attempt %d/%d); retrying in %.2fs",
                        model,
                        attempt + 1,
                        _MAX_ATTEMPTS_PER_MODEL,
                        wait,
                    )
                    time.sleep(wait)
                else:
                    logger.warning(
                        "Groq 429 exhausted retries on model %s; failing over",
                        model,
                    )

    raise last_error
