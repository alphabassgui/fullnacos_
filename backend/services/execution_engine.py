import uuid as _uuid
from datetime import datetime

from connectors import get_connector
from services.measurement_service import record_measurement
from services.learning_service import create_learning_from_measurement

from extensions import db
from models import Action, Execution, action_to_dict


def _get_execution(execution_id):
    try:
        _uuid.UUID(str(execution_id))
    except (ValueError, TypeError, AttributeError):
        return None
    return db.session.get(Execution, execution_id)


def execute_action(business_id, execution_id):

    execution = _get_execution(execution_id)

    if execution is None:
        raise ValueError("Execution not found")

    if execution.status == "completed":
        return execution.result

    action_id = execution.action_id

    if not action_id:
        raise ValueError("Execution has no action_id")

    action = db.session.get(Action, action_id)

    if action is None:
        raise ValueError("Action not found")

    # Critical safety check. Accept "approved" OR "running": once the action
    # lifecycle is mirrored below, a retry of the same execution re-enters with
    # the action already at "running", and must not raise. Anything terminal
    # (completed/failed/rejected) or still pending is never re-executed here.
    if action.status not in {"approved", "running"}:
        raise ValueError(
            "Action must be approved before execution"
        )

    now = datetime.utcnow()

    if execution.status not in {"queued", "running"}:
        raise ValueError(
            f"Execution cannot start from status: {execution.status}"
        )

    execution.status = "running"
    execution.started_at = now
    execution.updated_at = now
    # Mirror the lifecycle onto the action row, which the Campaigns list reads.
    action.status = "running"
    action.updated_at = now
    db.session.commit()

    try:
        # The connector reads the same dict shape the Firestore doc.to_dict()
        # produced, which action_to_dict reproduces byte-for-byte.
        action_payload = action_to_dict(action)
        connector = get_connector(action_payload)

        result = connector.execute(
            action_payload,
            business_id,
            str(execution.owner_id) if execution.owner_id is not None else None,
            execution_id=execution_id,
        )

        completed_now = datetime.utcnow()
        execution.status = "completed"
        execution.result = result
        execution.completed_at = completed_now
        execution.updated_at = completed_now
        action.status = "completed"
        action.completed_at = completed_now
        action.updated_at = completed_now
        db.session.commit()

        measurement = record_measurement(
            business_id=business_id,
            execution_id=execution_id,
            metric="execution_success",
            value=1,
            source="execution_engine",
        )

        create_learning_from_measurement(
            business_id=business_id,
            measurement_id=measurement["id"],
        )

        return result

    except Exception as exc:
        db.session.rollback()
        failed_now = datetime.utcnow()
        execution.status = "failed"
        execution.error = str(exc)
        execution.completed_at = failed_now
        execution.updated_at = failed_now
        action.status = "failed"
        action.error = str(exc)
        action.updated_at = failed_now
        db.session.commit()

        raise
