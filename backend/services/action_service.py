import uuid as _uuid
from datetime import datetime

from sqlalchemy.exc import IntegrityError

from extensions import db
from models import Action, Opportunity, action_to_dict, get_business_row


# The 3 "live" states: while an action is in one of these, the opportunity it
# belongs to must not get a second action. This is both the Python dedupe check
# below and the partial UNIQUE(opportunity_id) predicate backing it in the DB.
_LIVE_STATUSES = {"pending_approval", "approved", "running"}


def _get_opportunity(opportunity_id):
    """Fetch an opportunity by id, returning None for a malformed/non-UUID id so
    the caller raises the same "Opportunity not found" it did when the Firestore
    doc was absent."""
    try:
        _uuid.UUID(str(opportunity_id))
    except (ValueError, TypeError, AttributeError):
        return None
    return db.session.get(Opportunity, opportunity_id)


def _existing_live_action(opportunity_id):
    for existing in (
        db.session.query(Action)
        .filter_by(opportunity_id=opportunity_id)
        .all()
    ):
        if existing.status in _LIVE_STATUSES:
            return existing
    return None


def create_action(
    business_id,
    opportunity_id,
    action,
    owner_id,
):
    if not business_id:
        raise ValueError("business_id is required")

    if not owner_id:
        raise ValueError("owner_id is required")

    if not opportunity_id:
        raise ValueError("opportunity_id is required")

    if not isinstance(action, dict):
        raise ValueError("action must be a dictionary")

    required_fields = {
        "action_title",
        "action_type",
        "objective",
        "description",
        "reasoning",
        "expected_outcome",
        "required_inputs",
        "requires_approval",
    }

    missing_fields = required_fields - action.keys()

    if missing_fields:
        raise ValueError(
            f"Action is missing required fields: "
            f"{sorted(missing_fields)}"
        )

    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != owner_id:
        raise ValueError(
            "Owner does not have access to this business"
        )

    opportunity = _get_opportunity(opportunity_id)

    if opportunity is None:
        raise ValueError("Opportunity not found")

    if str(opportunity.owner_id) != owner_id:
        raise ValueError(
            "You do not have permission to use this opportunity"
        )

    existing_live = _existing_live_action(opportunity_id)

    if existing_live is not None:
        return {
            **action_to_dict(existing_live),
            "already_exists": True,
        }

    now = datetime.utcnow()

    row = Action(
        business_id=business_id,
        owner_id=owner_id,
        opportunity_id=opportunity_id,
        action_title=action["action_title"],
        action_type=action["action_type"],
        objective=action["objective"],
        description=action["description"],
        reasoning=action["reasoning"],
        expected_outcome=action["expected_outcome"],
        required_inputs=action["required_inputs"],
        requires_approval=action["requires_approval"],
        status="pending_approval",
        content_type=action["content_type"],
        page_url=action["page_url"],
        content=action["content"],
        target_path=action["target_path"],
        created_at=now,
        updated_at=now,
    )

    db.session.add(row)

    try:
        db.session.commit()
    except IntegrityError:
        # A concurrent insert won the partial UNIQUE(opportunity_id) WHERE-live
        # race. Return the existing live action with the same already_exists
        # contract rather than surfacing the DB error.
        db.session.rollback()
        existing_live = _existing_live_action(opportunity_id)
        if existing_live is not None:
            return {
                **action_to_dict(existing_live),
                "already_exists": True,
            }
        raise

    return {
        **action_to_dict(row),
        "already_exists": False,
    }
