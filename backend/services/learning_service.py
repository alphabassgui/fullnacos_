import uuid as _uuid
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from agent.learning_generator import generate_learning_from_measurement

from extensions import db
from models import (
    Action,
    Execution,
    Learning,
    Measurement,
    get_business_row,
    learning_to_dict,
)


def _get_by_id(model, row_id):
    try:
        _uuid.UUID(str(row_id))
    except (ValueError, TypeError, AttributeError):
        return None
    return db.session.get(model, row_id)


def create_learning(
    business_id,
    execution_id,
    observation,
    outcome,
    learning,
    confidence,
    learning_type=None,
    metric=None,
    previous_value=None,
    value=None,
    direction=None,
    measurement_id=None,
):
    """
    Create a learning record from an execution outcome.

    If measurement_id is provided, the learning is tied to that
    measurement so duplicate learnings can be prevented.
    """

    if not business_id:
        raise ValueError("business_id is required")

    if not execution_id:
        raise ValueError("execution_id is required")

    if not observation:
        raise ValueError("observation is required")

    if not outcome:
        raise ValueError("outcome is required")

    if not learning:
        raise ValueError("learning is required")

    if confidence is None:
        raise ValueError("confidence is required")

    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        raise ValueError("confidence must be a number")

    if not learning_type:
        raise ValueError("learning_type is required")

    if confidence < 0 or confidence > 1:
        raise ValueError("confidence must be between 0 and 1")

    if get_business_row(business_id) is None:
        raise ValueError("Business not found")

    execution = _get_by_id(Execution, execution_id)

    if execution is None:
        raise ValueError("Execution not found")

    action_id = execution.action_id

    if not action_id:
        raise ValueError("Execution has no action_id")

    action = db.session.get(Action, action_id)

    if action is None:
        raise ValueError("Action not found")

    now = datetime.utcnow()

    values = {
        "business_id": business_id,
        "execution_id": execution_id,
        "action_id": action_id,
        "action_type": action.action_type,
        "measurement_id": measurement_id,
        "learning_type": learning_type,
        "metric": metric,
        "previous_value": previous_value,
        "value": value,
        "direction": direction,
        "observation": observation,
        "outcome": outcome,
        "learning": learning,
        "confidence": confidence,
        "created_at": now,
    }

    if measurement_id:
        # Idempotent create-if-absent (replaces the @firestore.transactional on
        # doc(measurement_id)). The partial UNIQUE(business_id, measurement_id)
        # WHERE measurement_id IS NOT NULL makes a redelivery a no-op; we then
        # read the existing row back and return it with already_exists=True, the
        # same contract measurement_service/execution_engine consume.
        stmt = (
            pg_insert(Learning)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=["business_id", "measurement_id"],
                index_where=text("measurement_id IS NOT NULL"),
            )
            .returning(Learning.id)
        )

        inserted_id = db.session.execute(stmt).scalar()
        db.session.commit()

        if inserted_id is None:
            existing = (
                db.session.query(Learning)
                .filter_by(
                    business_id=business_id,
                    measurement_id=measurement_id,
                )
                .first()
            )

            return {
                **learning_to_dict(existing),
                "already_exists": True,
            }

        row = db.session.get(Learning, inserted_id)

        return {
            **learning_to_dict(row),
            "already_exists": False,
        }

    row = Learning(**values)

    db.session.add(row)
    db.session.commit()

    return {
        **learning_to_dict(row),
        "already_exists": False,
    }

def create_learning_from_measurement(
    business_id,
    measurement_id,
):
    """
    Generate and persist a learning from an existing measurement.

    This operation is idempotent: calling it multiple times for the
    same measurement returns the existing learning instead of creating
    duplicates.
    """

    if not business_id:
        raise ValueError("business_id is required")

    if not measurement_id:
        raise ValueError("measurement_id is required")

    if get_business_row(business_id) is None:
        raise ValueError("Business not found")

    measurement = _get_by_id(Measurement, measurement_id)

    if measurement is None:
        raise ValueError("Measurement not found")

    execution_id = measurement.execution_id

    if not execution_id:
        raise ValueError(
            "Measurement has no execution_id"
        )

    from models import measurement_to_dict

    generated_learning = generate_learning_from_measurement(
        measurement_to_dict(measurement)
    )

    return create_learning(
        business_id=business_id,
        execution_id=str(execution_id),
        observation=generated_learning["observation"],
        outcome=generated_learning["outcome"],
        learning=generated_learning["learning"],
        confidence=generated_learning["confidence"],
        learning_type=generated_learning["learning_type"],
        metric=generated_learning.get("metric"),
        previous_value=generated_learning.get("previous_value"),
        value=generated_learning.get("value"),
        direction=generated_learning.get("direction"),
        measurement_id=measurement_id,
    )

def get_business_learnings(
    business_id,
    limit=20,
    action_type=None,
    learning_type=None,
):
    """
    Retrieve recent learnings for a business.
    """

    if not business_id:
        raise ValueError("business_id is required")

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        raise ValueError("limit must be a number")

    if limit <= 0:
        raise ValueError("limit must be greater than 0")

    if get_business_row(business_id) is None:
        raise ValueError("Business not found")

    rows = (
        db.session.query(Learning)
        .filter_by(business_id=business_id)
        .order_by(Learning.created_at.desc())
        .limit(limit)
        .all()
    )

    learnings = [learning_to_dict(row) for row in rows]

    if action_type:
        learnings = [
            learning
            for learning in learnings
            if learning.get("action_type") == action_type
        ]

    if learning_type:
        learnings = [
            learning
            for learning in learnings
            if learning.get("learning_type") == learning_type
        ]

    return learnings
