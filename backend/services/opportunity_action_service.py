from agent.decision_engine import generate_action
from services.action_service import create_action
from services.connection_service import get_connection

from extensions import db
from models import (
    Action,
    Opportunity,
    action_to_dict,
    get_business_row,
    opportunity_to_dict,
)


def _github_repo_connected(business_id, owner_id):
    """Whether a GitHub repository is connected for this business — the hard
    fact the decision engine needs to decide if a code-level (github) action is
    even possible. A github action with no connected repo would dead-end at
    execution (``get_connection`` -> "GitHub connection not found"), so the
    engine must not propose one; this is the signal that gates it.

    A missing business/owner or any lookup error resolves to False — the safe
    default is "no automated code edits available".
    """
    try:
        connection = get_connection(
            business_id=business_id,
            user_id=owner_id,
            provider="github",
        )
    except (ValueError, PermissionError):
        return False
    return bool(connection and connection.get("repository"))


# generate_actions_for_opportunities skips an opportunity that already has an
# action in ANY of these states. This is deliberately BROADER than the 3 live
# states the DB UNIQUE enforces: `completed` is included so a finished action is
# never regenerated. That is a planner policy the constraint does not (and should
# not) enforce, so it stays here in app code.
_SKIP_REGENERATE_STATUSES = {
    "pending_approval",
    "approved",
    "running",
    "completed",
}


def create_action_from_opportunity(
    business_id,
    opportunity_id,
    owner_id,
    business_analysis,
):
    if not business_id:
        raise ValueError("business_id is required")

    if not opportunity_id:
        raise ValueError("opportunity_id is required")

    if not owner_id:
        raise ValueError("owner_id is required")

    if not isinstance(business_analysis, dict):
        raise ValueError("business_analysis must be a dictionary")

    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != owner_id:
        raise ValueError(
            "Owner does not have access to this business"
        )

    opportunity_row = db.session.get(Opportunity, opportunity_id)

    if opportunity_row is None:
        raise ValueError("Opportunity not found")

    if str(opportunity_row.owner_id) != owner_id:
        raise ValueError(
            "You do not have permission to use this opportunity"
        )

    opportunity = opportunity_to_dict(opportunity_row)

    github_connected = _github_repo_connected(business_id, owner_id)

    decision = generate_action(
        opportunity=opportunity,
        business_analysis=business_analysis,
        business_id=business_id,
        github_connected=github_connected,
    )

    action = create_action(
        business_id=business_id,
        opportunity_id=opportunity_id,
        action=decision,
        owner_id=owner_id,
    )

    return {
        "success": True,
        "opportunity_id": opportunity_id,
        "action": action,
    }

def generate_actions_for_opportunities(
    business_id,
    owner_id,
    business_analysis,
    opportunity_ids=None,
):
    if not business_id:
        raise ValueError("business_id is required")

    if not owner_id:
        raise ValueError("owner_id is required")

    if not isinstance(business_analysis, dict):
        raise ValueError("business_analysis must be a dictionary")

    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != owner_id:
        raise ValueError(
            "Owner does not have access to this business"
        )

    if opportunity_ids is None:
        opportunity_rows = (
            db.session.query(Opportunity)
            .filter_by(
                business_id=business_id,
                status="identified",
            )
            .all()
        )
    else:
        opportunity_rows = []

        for opportunity_id in opportunity_ids:
            opportunity_row = db.session.get(Opportunity, opportunity_id)

            if opportunity_row is not None:
                opportunity_rows.append(opportunity_row)

    github_connected = _github_repo_connected(business_id, owner_id)

    # Action types that should have been "github" when a repo is connected.
    _MISROUTED_TYPES = {"website", "seo", "content"}

    created_actions = []
    existing_actions = []

    for opportunity_row in opportunity_rows:
        opportunity_id = str(opportunity_row.id)

        existing_action = None

        for action_row in (
            db.session.query(Action)
            .filter_by(opportunity_id=opportunity_id)
            .all()
        ):
            if action_row.status in _SKIP_REGENERATE_STATUSES:
                # Allow regeneration of completed actions that were
                # misrouted (tagged website/seo/content when a GitHub
                # repo is now connected).  Mark the old one superseded
                # so a fresh "github" action can be created.
                if (
                    github_connected
                    and action_row.status == "completed"
                    and action_row.action_type in _MISROUTED_TYPES
                ):
                    action_row.status = "superseded"
                    db.session.add(action_row)
                    db.session.flush()
                    # fall through to create a new action
                else:
                    existing_action = action_to_dict(action_row)
                    break

        if existing_action:
            existing_actions.append(existing_action)
            continue

        result = create_action_from_opportunity(
            business_id=business_id,
            opportunity_id=opportunity_id,
            owner_id=owner_id,
            business_analysis=business_analysis,
        )

        created_actions.append(result["action"])

    return {
        "success": True,
        "business_id": business_id,
        "actions_created": len(created_actions),
        "actions_existing": len(existing_actions),
        "actions": created_actions,
        "existing_actions": existing_actions,
    }
