import json
import os
import re
import time

from groq import Groq

from agent.groq_client import create_chat_completion
from agent.prompts import (
    OBSERVATION_ANALYSIS_SYSTEM_PROMPT,
    OBSERVATION_ANALYSIS_USER_PROMPT,
)


client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)


# Free-tier Groq occasionally returns malformed/truncated output, so the
# analysis call is retried a few times with a short backoff before giving up.
_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (1, 2)


def _salvage_json(text):
    """
    Best-effort recovery of a JSON object from messy LLM text.

    Handles ```json ... ``` / ``` ... ``` code fences and surrounding
    prose. Raises ValueError if nothing parseable can be recovered.
    """

    cleaned = text.strip()

    # Strip a surrounding ```json ... ``` or ``` ... ``` fence.
    fence = re.match(
        r"^```(?:json)?\s*(.*?)\s*```$",
        cleaned,
        re.DOTALL,
    )
    if fence:
        cleaned = fence.group(1).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Extract the substring from the first "{" to the last "}".
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError("Groq returned invalid JSON")


def analyze_observation(observation):
    """
    Analyze a website observation using Groq.

    Returns a structured dictionary containing the AI's
    understanding of the business.
    """

    analysis = observation.get("analysis", {})

    prompt = OBSERVATION_ANALYSIS_USER_PROMPT.format(
        source_url=observation.get("source_url", ""),
        final_url=observation.get("final_url", ""),
        title=analysis.get("title", ""),
        meta_description=analysis.get("meta_description", ""),
        headings=json.dumps(
            analysis.get("headings", []),
            ensure_ascii=False,
        ),
        links=json.dumps(
            analysis.get("links", []),
            ensure_ascii=False,
        ),
    )

    last_error = None

    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = create_chat_completion(
                client,
                model_kind="text",
                messages=[
                    {
                        "role": "system",
                        "content": OBSERVATION_ANALYSIS_SYSTEM_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
                temperature=0.2,
                response_format={"type": "json_object"},
            )

            result = response.choices[0].message.content

            if not result:
                raise ValueError("Groq returned an empty response")

            try:
                return json.loads(result)
            except json.JSONDecodeError:
                return _salvage_json(result)
        except Exception as exc:  # noqa: BLE001 - retry any transient failure
            last_error = exc
            if attempt < _MAX_ATTEMPTS - 1:
                time.sleep(_BACKOFF_SECONDS[attempt])

    raise ValueError(
        f"Groq returned invalid JSON after {_MAX_ATTEMPTS} attempts"
    ) from last_error
