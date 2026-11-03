from connectors.base import BaseConnector


class DraftOnlyConnector(BaseConnector):
    """Honest fallback for actions with no automated write path.

    Only a few action types have a channel Groville can safely act through:
    ``github`` (open a pull request) and ``social`` (Instagram). Everything else
    — the planner's ``content`` / ``seo`` / ``email`` / ``research`` / ``other``
    types, and ``website`` copy/metadata changes when no GitHub repo is connected
    — has no channel yet.

    Approving one of those must NOT crash, and must NOT pretend something was
    published (the old website connector returned "validated successfully", which
    read like success while doing nothing). Instead this returns the draft with a
    clear note that there is no automated channel and what connecting one would
    unlock. That keeps the honesty boundary intact: Groville drafts; it never
    silently claims work it cannot do.
    """

    def execute(self, action, business_id, user_id, execution_id=None):
        action_type = action.get("action_type")
        return {
            "success": True,
            "status": "drafted_pending_manual",
            "message": (
                "I've drafted this, but there's no automated channel to apply it "
                "yet, so nothing was published. For website copy or metadata, "
                "connect a GitHub repository and I can open the change as a pull "
                "request for you to review and merge. Otherwise it stays a draft "
                "for you to apply yourself."
            ),
            "business_id": business_id,
            "user_id": user_id,
            "action_type": action_type,
            "action_title": action.get("action_title") or action.get("title"),
            "objective": action.get("objective"),
            "description": action.get("description"),
            "required_inputs": action.get("required_inputs", []),
        }
