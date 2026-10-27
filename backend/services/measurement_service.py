import uuid as _uuid
from datetime import datetime

from agent.learning_generator import generate_learning_from_measurement
from services.learning_service import create_learning

from extensions import db
from models import Execution, Measurement, get_business_row, measurement_to_dict


def _get_execution(execution_id):
    try:
        _uuid.UUID(str(execution_id))
    except (ValueError, TypeError, AttributeError):
        return None
    return db.session.get(Execution, execution_id)


def record_measurement(
    business_id,
    execution_id,
    metric,
    value,
    source,
    previous_value=None,
):
    """
    Record a measurement for an execution.

    Args:
        business_id: The business the execution belongs to.
        execution_id: The execution being measured.
        metric: Name of the metric being recorded.
        value: Numeric or boolean metric value.
        source: Where the measurement came from.

    Returns:
        Dictionary containing the created measurement.
    """

    if not business_id:
        raise ValueError("business_id is required")

    if not execution_id:
        raise ValueError("execution_id is required")

    if not metric:
        raise ValueError("metric is required")

    if value is None:
        raise ValueError("value is required")

    if not source:
        raise ValueError("source is required")

    if get_business_row(business_id) is None:
        raise ValueError("Business not found")

    execution = _get_execution(execution_id)

    if execution is None:
        raise ValueError("Execution not found")

    now = datetime.utcnow()

    row = Measurement(
        business_id=business_id,
        execution_id=execution_id,
        action_id=execution.action_id,
        metric=metric,
        value=value,
        source=source,
        previous_value=previous_value,
        measured_at=now,
        created_at=now,
    )

    db.session.add(row)
    db.session.commit()

    measurement = measurement_to_dict(row)

    learning = generate_learning_from_measurement(measurement)

    learning_record = create_learning(
        business_id=business_id,
        execution_id=execution_id,
        learning_type=learning["learning_type"],
        observation=learning["observation"],
        outcome=learning["outcome"],
        learning=learning["learning"],
        confidence=learning["confidence"],
        metric=learning.get("metric"),
        previous_value=learning.get("previous_value"),
        value=learning.get("value"),
        direction=learning.get("direction"),
    )

    return {
        **measurement,
        "learning": learning_record,
    }
