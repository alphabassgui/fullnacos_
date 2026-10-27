from datetime import datetime
import re

from sqlalchemy.exc import IntegrityError

from extensions import db
from models import Opportunity, get_business_row, opportunity_to_dict


def _normalize_text(value):
    if not value:
        return ""

    value = value.lower().strip()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[^\w\s]", "", value)

    return value

def create_opportunity(
    business_id,
    opportunity,
    owner_id,
):
    if not business_id:
        raise ValueError("business_id is required")

    if not owner_id:
        raise ValueError("owner_id is required")

    if not isinstance(opportunity, dict):
        raise ValueError("opportunity must be a dictionary")

    required_fields = {
        "title",
        "description",
        "problem",
        "evidence",
        "potential_impact",
        "confidence",
        "type",
    }

    missing_fields = required_fields - opportunity.keys()

    if missing_fields:
        raise ValueError(
            f"Opportunity is missing required fields: "
            f"{sorted(missing_fields)}"
        )

    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != owner_id:
        raise ValueError(
            "Owner does not have access to this business"
        )

    existing_opportunity = find_existing_opportunity(
        business_id=business_id,
        opportunity=opportunity,
    )

    if existing_opportunity:
        return {
            **existing_opportunity,
            "already_exists": True,
        }

    now = datetime.utcnow()

    row = Opportunity(
        business_id=business_id,
        owner_id=owner_id,
        title=opportunity["title"],
        description=opportunity["description"],
        problem_key=opportunity.get("problem_key"),
        problem=opportunity["problem"],
        evidence=opportunity["evidence"],
        potential_impact=opportunity["potential_impact"],
        confidence=opportunity["confidence"],
        type=opportunity["type"],
        status="identified",
        created_at=now,
        updated_at=now,
    )

    db.session.add(row)

    try:
        db.session.commit()
    except IntegrityError:
        # A concurrent insert won the partial UNIQUE
        # (business_id, type, problem_key) race. Return the existing row with the
        # same already_exists contract rather than surfacing the DB error.
        db.session.rollback()
        existing_opportunity = find_existing_opportunity(
            business_id=business_id,
            opportunity=opportunity,
        )
        if existing_opportunity:
            return {
                **existing_opportunity,
                "already_exists": True,
            }
        raise

    return {
        **opportunity_to_dict(row),
        "already_exists": False,
    }

def find_existing_opportunity(
    business_id,
    opportunity,
):
    if not business_id:
        raise ValueError("business_id is required")

    if not isinstance(opportunity, dict):
        raise ValueError("opportunity must be a dictionary")

    opportunity_type = opportunity.get("type")
    problem_key = opportunity.get("problem_key")
    problem = opportunity.get("problem")

    if not opportunity_type:
        return None

    existing_rows = (
        db.session.query(Opportunity)
        .filter_by(
            business_id=business_id,
            type=opportunity_type,
        )
        .all()
    )

    normalized_problem = _normalize_text(problem)

    for existing in existing_rows:
        existing_problem_key = existing.problem_key

        # New opportunities: use the stable problem key.
        if problem_key and existing_problem_key:
            if existing_problem_key == problem_key:
                return opportunity_to_dict(existing)

        # Backward compatibility for old opportunities.
        existing_problem = _normalize_text(existing.problem)

        if (
            not problem_key
            and normalized_problem
            and existing_problem == normalized_problem
        ):
            return opportunity_to_dict(existing)

    return None
