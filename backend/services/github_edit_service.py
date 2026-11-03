"""Grounded GitHub edit service.

The Decision Engine only *plans* a github action: it may name a ``target_path``
but it never sees the repo source, so it cannot (and must not) invent the file
contents. This service is the bridge that makes a github action executable
*correctly*:

* ``resolve_target_file`` — validate a planned path against the repository's
  real tree, or, when no valid path is evidenced, shortlist the files that
  plausibly hold page copy / metadata so the owner can confirm one. No path is
  ever acted on unless it is confirmed to exist in the tree.

* ``generate_grounded_edit`` — given the *real* current file content and the
  action's intent, produce the full new file with ONLY a safe copy/meta edit
  applied (title, meta description, OG tags, heading/CTA copy, alt text). The
  edit is generated from the true source, never from assumptions, and the
  connector's destructive-change guardrails backstop it.

This keeps the honesty boundary intact: Groville drafts, the owner reviews the
PR, merging is approval.
"""

import json
import logging
import os

from groq import Groq

from agent.groq_client import create_chat_completion

logger = logging.getLogger(__name__)


def _build_client():
    """Build the Groq client when a key is configured.

    Importing this module must never fail just because the key is absent (e.g.
    in tests, which mock ``create_chat_completion`` and never touch the client).
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None
    return Groq(api_key=api_key)


client = _build_client()


# File types that plausibly hold page markup, copy, or head metadata.
_EDITABLE_SUFFIXES = (
    ".html", ".htm", ".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte",
    ".astro", ".md", ".mdx", ".ejs", ".hbs", ".php", ".liquid",
)
# Path fragments that strongly suggest a page / head / metadata file.
_PRIORITY_HINTS = (
    "index.html", "layout", "head", "seo", "metadata", "_app", "_document",
    "app/page", "pages/index", "home", "hero", "landing",
)
# Build output, dependencies, and VCS internals are never edit targets.
_EXCLUDE_DIR_PARTS = frozenset({
    "node_modules", ".next", "dist", "build", "out", ".git", "vendor",
    "__pycache__", "coverage", ".cache", ".turbo", ".vercel",
})

MAX_CANDIDATES = 8


GROUNDED_EDIT_SYSTEM_PROMPT = """You edit a single source file for a small
business website. You are given the file's EXACT current contents and a
requested change. Apply ONLY that change and return the COMPLETE new file.

STRICT SCOPE — you may only edit copy and metadata:
- the <title> text
- the meta description
- Open Graph / Twitter card tags (og:title, og:description, etc.)
- visible heading or call-to-action copy
- image alt text

You must NOT:
- change code logic, imports, component structure, routing, scripts, or styles
- add, remove, or rename files, functions, components, or variables
- reformat, re-indent, or reorder anything you are not changing
- invent facts, prices, statistics, testimonials, claims, or contact details —
  if the change would need information not present in the file or the request,
  make no such claim
- touch anything outside the specific copy/metadata the request names

Preserve the rest of the file byte-for-byte: same indentation, same quoting,
same surrounding lines. The diff should be as small as possible.

Return a JSON object with exactly these keys:
- "changed": boolean — true only if you actually modified the file
- "summary": a one-sentence plain-text description of what you changed
- "content": the complete new file contents as a string

If the requested change is out of scope, unsafe, or would require inventing
information, set "changed" to false, explain why in "summary", and return the
original file unchanged in "content"."""


def _is_excluded(path):
    return any(part in _EXCLUDE_DIR_PARTS for part in path.split("/"))


def _tree_blob_paths(github_api, owner, repo, sha):
    """Every real file (git blob) path in the repo at ``sha``."""
    tree = github_api.get_repository_tree(owner=owner, repo=repo, sha=sha)
    return [
        item["path"]
        for item in tree.get("tree", [])
        if item.get("type") == "blob" and item.get("path")
    ]


def _score_candidate(path):
    """Higher is more likely to hold editable page copy / metadata."""
    lower = path.lower()
    score = 1.0
    for hint in _PRIORITY_HINTS:
        if hint in lower:
            score += 3.0
    # Favour shallower paths — top-level page files over deeply nested ones.
    depth = path.count("/")
    score -= 0.25 * depth
    # A bare root index.html is the canonical homepage.
    if lower in ("index.html", "index.htm", "public/index.html"):
        score += 4.0
    return score


def _normalize_path(path):
    return (path or "").strip().lstrip("./").lstrip("/")


def resolve_target_file(
    github_api, owner, repo, base_sha, evidenced_path=None,
    max_candidates=MAX_CANDIDATES,
):
    """Return a confirmed-existing target file, or a shortlist to confirm.

    Result shapes:
    - {"status": "confirmed", "path": <path>}               — use this file
    - {"status": "needs_confirmation", "candidates": [...]} — owner must pick
    - {"status": "no_candidates"}                           — nothing editable

    A path is ONLY ever "confirmed" when it exists in the repository tree, so a
    hallucinated or stale ``evidenced_path`` can never reach an edit.
    """
    paths = _tree_blob_paths(github_api, owner, repo, base_sha)
    path_set = set(paths)

    evidenced = _normalize_path(evidenced_path)
    if evidenced and evidenced in path_set:
        return {"status": "confirmed", "path": evidenced}

    ranked = sorted(
        (
            p for p in paths
            if not _is_excluded(p) and p.lower().endswith(_EDITABLE_SUFFIXES)
        ),
        key=_score_candidate,
        reverse=True,
    )

    candidates = ranked[:max_candidates]
    if not candidates:
        return {"status": "no_candidates"}

    return {"status": "needs_confirmation", "candidates": candidates}


def _change_intent(action):
    """Assemble a focused description of the change from the action fields."""
    parts = []
    for key in ("action_title", "objective", "description", "reasoning"):
        value = action.get(key)
        if value:
            parts.append(f"{key}: {value}")
    return "\n".join(parts)


def generate_grounded_edit(path, original_content, action):
    """Produce the full new file contents for ``path`` with the action's safe
    copy/meta change applied to the *real* current contents.

    Raises ValueError if the model declines the change or produces nothing
    usable — the caller turns that into a cleanly failed execution rather than
    opening an empty or invalid PR.
    """
    if client is None:
        raise ValueError("GROQ_API_KEY is not configured")

    intent = _change_intent(action)

    user_prompt = (
        f"File path: {path}\n\n"
        f"Requested change:\n{intent}\n\n"
        f"Current file contents:\n"
        f"-----8<----- BEGIN FILE -----8<-----\n"
        f"{original_content}\n"
        f"-----8<----- END FILE -----8<-----\n"
    )

    response = create_chat_completion(
        client,
        model_kind="text",
        messages=[
            {"role": "system", "content": GROUNDED_EDIT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "grounded_edit",
                "schema": {
                    "type": "object",
                    "properties": {
                        "changed": {"type": "boolean"},
                        "summary": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["changed", "summary", "content"],
                    "additionalProperties": False,
                },
            },
        },
    )

    raw = response.choices[0].message.content
    if not raw:
        raise ValueError("Grounded edit returned an empty response")

    stripped = raw.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        inner = lines[1:] if len(lines) > 1 else lines
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        stripped = "\n".join(inner).strip()

    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ValueError("Grounded edit returned invalid JSON") from exc

    if not isinstance(payload, dict):
        raise ValueError("Grounded edit response must be a JSON object")

    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Grounded edit response has no usable content")

    if payload.get("changed") is not True:
        raise ValueError(
            "Grounded edit produced no change: "
            + (payload.get("summary") or "the requested edit was out of scope")
        )

    if content == original_content:
        raise ValueError("Grounded edit left the file unchanged")

    return {
        "content": content,
        "summary": payload.get("summary", ""),
    }
