from connectors.dry_run import DryRunConnector
from connectors.instagram import InstagramConnector
from connectors.github import GitHubConnector
from connectors.draft_only import DraftOnlyConnector


def get_connector(action):
    """Pick the connector for an action's type.

    Only a few types have a real, safe write path: ``github`` opens a pull
    request, ``social`` posts via Instagram, and ``dry_run`` is the dev/test
    simulator. Every other type the planner can emit (``website``, ``content``,
    ``seo``, ``email``, ``research``, ``other``) has no channel yet, so it routes
    to the honest draft-only fallback instead of raising — approving it returns
    the draft with a clear "not auto-applied" note rather than crashing or faking
    a result.

    A missing or blank ``action_type`` is a malformed action, not a draft, so it
    still raises.
    """
    action_type = action.get("action_type")

    if not action_type:
        raise ValueError(
            f"No connector available for action type: {action_type}"
        )

    if action_type == "dry_run":
        return DryRunConnector()

    if action_type == "github":
        return GitHubConnector()

    if action_type == "social":
        return InstagramConnector()

    return DraftOnlyConnector()
