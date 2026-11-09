import json
import os

from agent.groq_client import build_client, create_chat_completion
from agent.prompts import DECISION_ENGINE_SYSTEM_PROMPT
from services.learning_service import get_business_learnings


client = build_client()

def validate_action(action):
    if not isinstance(action, dict):
        raise ValueError(
            "Action response must be a JSON object"
        )

    required_fields = {
        "action_title",
        "action_type",
        "objective",
        "description",
        "reasoning",
        "expected_outcome",
        "required_inputs",
        "requires_approval",
        "content_type",
        "page_url",
        "content",
        "target_path",
    }

    missing_fields = required_fields - action.keys()

    if missing_fields:
        raise ValueError(
            f"Decision Engine response is missing required fields: "
            f"{sorted(missing_fields)}"
        )

    for field in set(action.keys()) - required_fields:
        action.pop(field)

    for field in ("content_type", "page_url", "content"):
        if action[field] is not None and not isinstance(action[field], str):
            raise ValueError(
                f"{field} must be a string or None"
            )

    if not isinstance(action["action_title"], str):
        raise ValueError("action_title must be a string")


    if action["target_path"] is not None and not isinstance(
    action["target_path"], str
):
        raise ValueError(
            "target_path must be a string or None"
        )
    
    if action["action_type"] not in {
        "website",
        "github",
        "content",
        "seo",
        "social",
        "email",
        "research",
        "other",
    }:
        raise ValueError(
            f"Invalid action_type: {action['action_type']}"
        )

    if not isinstance(action["objective"], str):
        raise ValueError("objective must be a string")

    if not isinstance(action["description"], str):
        raise ValueError("description must be a string")

    if not isinstance(action["reasoning"], str):
        raise ValueError("reasoning must be a string")

    if not isinstance(action["expected_outcome"], str):
        raise ValueError("expected_outcome must be a string")

    if not isinstance(action["required_inputs"], list):
        raise ValueError("required_inputs must be a list")

    if not all(
        isinstance(item, str)
        for item in action["required_inputs"]
    ):
        raise ValueError(
            "Every required_inputs item must be a string"
        )

    if not isinstance(action["requires_approval"], bool):
        raise ValueError(
            "requires_approval must be a boolean"
        )

    if action["requires_approval"] is not True:
        raise ValueError(
            "requires_approval must be true"
        )

    return action

def generate_action(
    opportunity,
    business_analysis,
    business_id,
    github_connected=False,
):
    """
    Generate a proposed action for a growth opportunity.

    Historical learnings are provided to the model as additional
    context. This function does not execute anything.
    It only creates a proposed action for later approval.

    ``github_connected`` is a hard fact the model cannot see for itself:
    whether a GitHub repository is connected for this business. The prompt
    only lets the engine choose ``action_type="github"`` when it is true, so
    we never plan a code-level fix the picker/executor can't act on.
    """

    if not business_id:
        raise ValueError("business_id is required")

    learnings = get_business_learnings(
        business_id=business_id,
        limit=20,
        learning_type="marketing",
    )

    prompt = f"""
GitHub repository connected: {str(bool(github_connected)).lower()}

Business understanding:

{json.dumps(
    business_analysis,
    indent=2,
    ensure_ascii=False,
)}

Growth opportunity:

{json.dumps(
    opportunity,
    indent=2,
    ensure_ascii=False,
)}

Historical marketing learnings:

{json.dumps(
    learnings,
    indent=2,
    ensure_ascii=False,
)}

Use historical marketing learnings as supporting evidence
when determining the most appropriate action for this opportunity.

A learning represents an observed relationship between an action
and a measured outcome. It does not prove that the action caused
the outcome and does not guarantee the same result in the future.

Prefer relevant historical evidence when it applies to the
current opportunity, but still consider the current business
analysis and opportunity evidence.
"""

    messages = [
        {
            "role": "system",
            "content": DECISION_ENGINE_SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": prompt,
        },
    ]

    # Retry up to 2 extra times on empty / non-JSON responses.
    # Groq occasionally returns 200 OK with an empty body or a
    # reasoning-only response that contains no JSON.
    _MAX_PARSE_RETRIES = 3
    last_parse_error = None

    for _attempt in range(_MAX_PARSE_RETRIES):
        response = create_chat_completion(
            client,
            model_kind="text",
            messages=messages,
            temperature=0.2,
        )

        result = response.choices[0].message.content

        if not result or not result.strip():
            last_parse_error = ValueError(
                "Groq returned an empty response"
            )
            continue

        result = result.strip()

        if result.startswith("```"):
            lines = result.splitlines()

            if lines and lines[0].startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            result = "\n".join(lines).strip()

        try:
            action = json.loads(result)
            last_parse_error = None
            break
        except json.JSONDecodeError as exc:
            last_parse_error = ValueError(
                f"Groq returned invalid action JSON: {result[:200]}"
            )
            last_parse_error.__cause__ = exc
            continue

    if last_parse_error is not None:
        raise last_parse_error

    action = validate_action(action)

    # ── Deterministic override ──────────────────────────────────────
    # The LLM prompt says copy / metadata / SEO-text changes MUST be
    # "github" when a repo is connected, but models sometimes ignore
    # that.  Rather than rely solely on the prompt, enforce it here:
    # if the repo IS connected and the model chose one of the
    # non-write action types that cover the same surface area, flip
    # it to "github" so the connector pipeline can actually apply it.
    _GITHUB_ELIGIBLE_TYPES = {"website", "seo", "content"}
    if github_connected and action["action_type"] in _GITHUB_ELIGIBLE_TYPES:
        action["action_type"] = "github"

    return action