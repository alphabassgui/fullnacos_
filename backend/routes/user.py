from flask import Blueprint, render_template, request, redirect, url_for, flash, session, current_app, jsonify
from firebase_admin import auth as admin_auth
from google.cloud.firestore_v1.base_query import FieldFilter
from sqlalchemy.exc import IntegrityError
from task import analyze_business_website
from datetime import datetime
import uuid
from firebase_admin import firestore
from datetime import datetime
from task import execute_approved_action
from google.cloud import firestore
from task import execute_approved_action
from validations import validate_website_url
from extensions import db as orm_db
from models import (
    Action,
    AgentRun,
    Business,
    Execution,
    Learning,
    Measurement,
    Opportunity,
    _iso,
    action_to_dict,
    business_to_dict,
    execution_to_dict,
    get_business_row,
    learning_to_dict,
    measurement_to_dict,
    opportunity_to_dict,
)

user_bp = Blueprint("user", __name__, template_folder="../templates")


def _get_child(model, row_id, business_id):
    """Fetch a pipeline child row by id, scoped to its business. A malformed
    (non-UUID) id or a row under a different business returns None, preserving
    the 404 the Firestore business/<id>/<collection>/<row_id> path produced."""
    try:
        uuid.UUID(str(row_id))
    except (ValueError, TypeError, AttributeError):
        return None
    row = orm_db.session.get(model, row_id)
    if row is None or str(row.business_id) != str(business_id):
        return None
    return row

# ─────────────────────────────────────────────────────────────
# Business page
# ─────────────────────────────────────────────────────────────

@user_bp.route("/", methods=["GET"])
def business():
    user_id = session.get("user_id")

    if not user_id:
        return redirect(url_for("auth.login"))

    businesses = (
        Business.query
        .filter_by(owner_id=user_id)
        .order_by(Business.created_at)
        .all()
    )

    business_list = [business_to_dict(business) for business in businesses]

    return render_template(
        "business.html",
        businesses=business_list
    )


# ─────────────────────────────────────────────────────────────
# Create business API
# ─────────────────────────────────────────────────────────────

@user_bp.route("/api/business", methods=["POST"])
def create_business():

    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    data = request.get_json(silent=True)

    if not data:
        return jsonify({
            "success": False,
            "error": "Request body is required"
        }), 400

    name = data.get("name", "").strip()
    raw_website_url = data.get("website_url", "").strip()
    industry = data.get("industry", "").strip()
    description = data.get("description", "").strip()


    website_url = validate_website_url(raw_website_url)

    if raw_website_url and not website_url:
        return jsonify({
            "success": False,
            "error": "Invalid website URL"
        }), 400
    if not name:
        return jsonify({
            "success": False,
            "error": "Business name is required"
        }), 400

    now = datetime.utcnow()

    # ─────────────────────────────────────────────────────────
    # Duplicate-business guard
    #
    # Only dedupe when a website_url is present. website_url is the
    # NORMALIZED value from validate_website_url above (never the raw
    # input). A name-only business (blank website_url) can be created
    # legitimately during onboarding, so it is never blocked, and we
    # never dedupe on name. A pre-insert SELECT returns the identical 409;
    # the partial UNIQUE (owner_id, website_url) is the race backstop.
    # ─────────────────────────────────────────────────────────

    def _duplicate_response():
        existing = (
            Business.query
            .filter_by(owner_id=user_id, website_url=website_url)
            .first()
        )
        if existing is None:
            return None
        return jsonify({
            "success": False,
            "error": "You already have a business with this website.",
            "existing_business": {
                "id": str(existing.id),
                "name": existing.name,
                "website_url": existing.website_url,
            },
        }), 409

    if website_url:
        duplicate = _duplicate_response()
        if duplicate is not None:
            return duplicate

    business = Business(
        owner_id=user_id,
        name=name,
        website_url=website_url,
        industry=industry,
        description=description,
        created_at=now,
        updated_at=now,
    )
    orm_db.session.add(business)

    try:
        orm_db.session.commit()
    except IntegrityError:
        # Concurrent insert won the partial UNIQUE race — return the same 409.
        orm_db.session.rollback()
        duplicate = _duplicate_response()
        if duplicate is not None:
            return duplicate
        raise

    return jsonify({
        "success": True,
        "message": "Business created successfully",
        "business": business_to_dict(business),
    }), 201


# ─────────────────────────────────────────────────────────────
# Update business API
# ─────────────────────────────────────────────────────────────

@user_bp.route("/api/business/<business_id>", methods=["PATCH"])
def update_business(business_id):

    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    # ─────────────────────────────────────────────────────────
    # Ownership check
    # ─────────────────────────────────────────────────────────

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this business"
        }), 403

    # ─────────────────────────────────────────────────────────
    # Request body
    # ─────────────────────────────────────────────────────────

    data = request.get_json(silent=True)

    if not data:
        return jsonify({
            "success": False,
            "error": "Request body is required"
        }), 400

    allowed_fields = {
        "name",
        "website_url",
        "industry",
        "description"
    }

    updates = {
        key: value.strip() if isinstance(value, str) else value
        for key, value in data.items()
        if key in allowed_fields
    }

    if not updates:
        return jsonify({
            "success": False,
            "error": "No valid fields to update"
        }), 400

    # ─────────────────────────────────────────────────────────
    # Business name validation
    # ─────────────────────────────────────────────────────────

    if "name" in updates and not updates["name"]:
        return jsonify({
            "success": False,
            "error": "Business name cannot be empty"
        }), 400

    # ─────────────────────────────────────────────────────────
    # Website URL validation
    # ─────────────────────────────────────────────────────────

    if "website_url" in updates:

        raw_website_url = updates["website_url"]

        # Allow user to clear the website URL
        if raw_website_url == "":
            updates["website_url"] = None

        else:
            validated_url = validate_website_url(
                raw_website_url
            )

            if not validated_url:
                return jsonify({
                    "success": False,
                    "error": "Invalid or unsafe website URL"
                }), 400

            updates["website_url"] = validated_url

    # ─────────────────────────────────────────────────────────
    # Update timestamp
    # ─────────────────────────────────────────────────────────

    now = datetime.utcnow()
    updates["updated_at"] = now.isoformat()

    for key, value in updates.items():
        if key == "updated_at":
            business.updated_at = now
        else:
            setattr(business, key, value)

    orm_db.session.commit()

    return jsonify({
        "success": True,
        "message": "Business updated successfully",
        "business_id": business_id,
        "updates": updates
    }), 200

# ─────────────────────────────────────────────────────────────
# Delete business API
# ─────────────────────────────────────────────────────────────

@user_bp.route("/api/business/<business_id>", methods=["DELETE"])
def delete_business(business_id):

    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    # ─────────────────────────────────────────────────────────
    # Get business
    # ─────────────────────────────────────────────────────────

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    # ─────────────────────────────────────────────────────────
    # Ownership check
    # ─────────────────────────────────────────────────────────

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to delete this business"
        }), 403

    # FK ON DELETE CASCADE removes all pipeline children (agent_runs,
    # observations, opportunities, actions, executions, measurements, learnings,
    # gtm_runs, connections) when the business row is deleted.
    orm_db.session.delete(business)
    orm_db.session.commit()

    # TODO: Supabase tile blobs for this business are stored outside Postgres
    # and are NOT removed by FK cascade — that belongs to the account-deletion path.

    return jsonify({
        "success": True,
        "message": "Business deleted successfully",
        "business_id": business_id
    }), 200
    
# ─────────────────────────────────────────────────────────────
# Analyze website
# ─────────────────────────────────────────────────────────────

@user_bp.route(
    "/api/business/<business_id>/analyze",
    methods=["POST"]
)
def analyze_business(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to analyze this business"
        }), 403

    if not business.website_url:
        return jsonify({
            "success": False,
            "error": "This business does not have a website URL"
        }), 400

    # Create a run record. Pre-created here (before dispatch) so the task's
    # observation upsert (observations.run_id FK -> agent_runs.id) resolves.
    run = AgentRun(
        business_id=business_id,
        owner_id=user_id,
        type="website_analysis",
        status="queued",
        created_at=datetime.utcnow(),
    )
    orm_db.session.add(run)
    orm_db.session.commit()

    run_id = str(run.id)

    # Send background job to Celery
    try:
        task = analyze_business_website.delay(
            business_id,
            user_id,
            run_id,
        )
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)
        run.failed_at = datetime.utcnow()
        orm_db.session.commit()
        return jsonify({
            "success": False,
            "error": "Analysis job could not be queued",
            "detail": str(exc),
        }), 503

    # Store Celery task ID
    run.task_id = task.id
    orm_db.session.commit()

    return jsonify({
        "success": True,
        "message": "Website analysis started",
        "run_id": run_id,
        "task_id": task.id,
        "status": "queued",
    }), 202
    
@user_bp.route("/api/business/<business_id>/opportunities",methods=["GET"])
def get_business_opportunities(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business"
        }), 403

    rows = (
        orm_db.session.query(Opportunity)
        .filter_by(business_id=business_id, owner_id=user_id)
        .all()
    )

    opportunities = [opportunity_to_dict(row) for row in rows]

    return jsonify({
        "success": True,
        "business_id": business_id,
        "opportunities": opportunities,
    }), 200
    
@user_bp.route("/api/business/<business_id>/opportunities/<opportunity_id>", methods=["GET"])
def get_opportunity(business_id, opportunity_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business"
        }), 403

    opportunity_row = _get_child(Opportunity, opportunity_id, business_id)

    if opportunity_row is None:
        return jsonify({
            "success": False,
            "error": "Opportunity not found"
        }), 404

    if str(opportunity_row.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this opportunity"
        }), 403

    return jsonify({
        "success": True,
        "opportunity": opportunity_to_dict(opportunity_row),
    }), 200
    
@user_bp.route("/api/business/<business_id>/runs/latest", methods=["GET"])
def get_latest_run(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business"
        }), 403

    latest = (
        orm_db.session.query(AgentRun)
        .filter_by(business_id=business_id)
        .order_by(AgentRun.created_at.desc())
        .first()
    )

    if latest is None:
        return jsonify({
            "success": True,
            "business_id": business_id,
            "run": None,
        }), 200

    return jsonify({
        "success": True,
        "business_id": business_id,
        "run": {
            "run_id": str(latest.id),
            "status": latest.status,
            "observation_id": (
                None if latest.observation_id is None
                else str(latest.observation_id)
            ),
            "opportunity_ids": latest.opportunity_ids,
            "error": latest.error,
            "created_at": _iso(latest.created_at),
            "completed_at": _iso(latest.completed_at),
        },
    }), 200

@user_bp.route( "/api/business/<business_id>/actions/<action_id>/approve", methods=["POST"],)
def approve_action(business_id, action_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this business",
        }), 403

    action_row = _get_child(Action, action_id, business_id)

    if action_row is None:
        return jsonify({
            "success": False,
            "error": "Action not found",
        }), 404

    if str(action_row.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this action",
        }), 403

    # ---------------------------------------------------------
    # Atomic approval. SELECT ... FOR UPDATE locks the action row for the
    # duration of the transaction, replacing the @firestore.transactional
    # retry loop. Re-approve is idempotent: an already-approved action returns
    # its existing execution_id WITHOUT inserting a second execution.
    # ---------------------------------------------------------

    try:
        locked = (
            orm_db.session.query(Action)
            .filter_by(id=action_id)
            .with_for_update()
            .one_or_none()
        )

        if locked is None or str(locked.business_id) != str(business_id):
            raise ValueError("Action not found")

        if str(locked.owner_id) != user_id:
            raise PermissionError(
                "You do not have permission to modify this action"
            )

        current_status = locked.status

        if current_status == "approved":
            result = {
                "already_approved": True,
                "execution_id": (
                    None if locked.execution_id is None
                    else str(locked.execution_id)
                ),
            }
        elif current_status != "pending_approval":
            raise ValueError("Only pending actions can be approved")
        else:
            now = datetime.utcnow()

            execution = Execution(
                business_id=business_id,
                owner_id=user_id,
                action_id=action_id,
                status="queued",
                created_at=now,
                updated_at=now,
            )
            orm_db.session.add(execution)
            orm_db.session.flush()

            locked.status = "approved"
            locked.approved_at = now
            locked.approved_by = user_id
            locked.execution_id = execution.id
            locked.updated_at = now

            result = {
                "already_approved": False,
                "execution_id": str(execution.id),
            }

        orm_db.session.commit()

    except PermissionError as exc:
        orm_db.session.rollback()
        return jsonify({
            "success": False,
            "error": str(exc),
        }), 403

    except ValueError as exc:
        orm_db.session.rollback()
        return jsonify({
            "success": False,
            "error": str(exc),
        }), 400

    # ---------------------------------------------------------
    # Already approved = do NOT create another execution
    # ---------------------------------------------------------

    if result["already_approved"]:
        execution_id = result.get("execution_id")

        return jsonify({
            "success": True,
            "message": "Action has already been approved",
            "action_id": action_id,
            "execution_id": execution_id,
            "status": "approved",
            "already_approved": True,
        }), 200

    # ---------------------------------------------------------
    # Queue exactly one newly-created execution
    # ---------------------------------------------------------

    execution_id = result["execution_id"]

    try:
        task = execute_approved_action.delay(
            business_id,
            execution_id,
        )

        execution = orm_db.session.get(Execution, execution_id)
        execution.task_id = task.id
        execution.updated_at = datetime.utcnow()
        orm_db.session.commit()

    except Exception as exc:
        orm_db.session.rollback()
        execution = orm_db.session.get(Execution, execution_id)
        execution.status = "failed"
        execution.error = f"Failed to queue execution: {str(exc)}"
        execution.updated_at = datetime.utcnow()
        orm_db.session.commit()

        return jsonify({
            "success": False,
            "error": "Action was approved, but execution could not be queued",
            "action_id": action_id,
            "execution_id": execution_id,
        }), 500

    return jsonify({
        "success": True,
        "message": "Action approved and execution queued",
        "action_id": action_id,
        "execution_id": execution_id,
        "task_id": task.id,
        "status": "approved",
        "next_phase": "execution",
        "already_approved": False,
    }), 202
    
@user_bp.route( "/api/business/<business_id>/actions/<action_id>/reject",methods=["POST"] )
def reject_action(business_id, action_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this business"
        }), 403

    action_row = _get_child(Action, action_id, business_id)

    if action_row is None:
        return jsonify({
            "success": False,
            "error": "Action not found"
        }), 404

    if str(action_row.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this action"
        }), 403

    if action_row.status != "pending_approval":
        return jsonify({
            "success": False,
            "error": "Only pending actions can be rejected"
        }), 400

    now = datetime.utcnow()

    action_row.status = "rejected"
    action_row.rejected_at = now
    action_row.rejected_by = user_id
    action_row.updated_at = now
    orm_db.session.commit()

    return jsonify({
        "success": True,
        "message": "Action rejected",
        "action_id": action_id,
        "status": "rejected",
    }), 200

@user_bp.route( "/api/business/<business_id>/actions/<action_id>", methods=["GET"])
def get_action(business_id, action_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business"
        }), 403

    action_row = _get_child(Action, action_id, business_id)

    if action_row is None:
        return jsonify({
            "success": False,
            "error": "Action not found"
        }), 404

    if str(action_row.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this action"
        }), 403

    return jsonify({
        "success": True,
        "action": action_to_dict(action_row),
    }), 200

@user_bp.route( "/api/business/<business_id>/actions", methods=["GET"] )
def get_business_actions(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required"
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found"
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business"
        }), 403

    actions_query = (
        orm_db.session.query(Action)
        .filter_by(business_id=business_id, owner_id=user_id)
    )

    status = request.args.get("status")

    if status:
        actions_query = actions_query.filter_by(status=status)

    actions = [action_to_dict(row) for row in actions_query.all()]

    return jsonify({
        "success": True,
        "business_id": business_id,
        "actions": actions,
    }), 200
    
@user_bp.route(
    "/api/business/<business_id>/executions/test",
    methods=["POST"],
)
def test_action_execution(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to execute actions for this business",
        }), 403

    data = request.get_json(silent=True) or {}
    action_id = data.get("action_id", "").strip()

    if not action_id:
        return jsonify({
            "success": False,
            "error": "action_id is required",
        }), 400

    action_row = _get_child(Action, action_id, business_id)

    if action_row is None:
        return jsonify({
            "success": False,
            "error": "Action not found",
        }), 404

    if str(action_row.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to execute this action",
        }), 403

    if action_row.status != "approved":
        return jsonify({
            "success": False,
            "error": "Only approved actions can be executed",
        }), 400

    now = datetime.utcnow()

    execution = Execution(
        business_id=business_id,
        owner_id=user_id,
        action_id=action_id,
        status="queued",
        created_at=now,
        updated_at=now,
    )
    orm_db.session.add(execution)
    orm_db.session.flush()

    execution_id = str(execution.id)

    task = execute_approved_action.delay(
        business_id,
        execution_id,
    )

    execution.task_id = task.id
    orm_db.session.commit()

    return jsonify({
        "success": True,
        "message": "Action execution queued",
        "execution_id": execution_id,
        "task_id": task.id,
        "status": "queued",
    }), 202
    
@user_bp.route(
    "/api/business/<business_id>/actions/dry-run",
    methods=["POST"],
)
def create_dry_run_action(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this business",
        }), 403

    now = datetime.utcnow()

    action = Action(
        business_id=business_id,
        owner_id=user_id,
        action_type="dry_run",
        title="Execution pipeline test",
        description="Safe dry-run test of the action execution pipeline.",
        requires_approval=True,
        status="approved",
        created_at=now,
        updated_at=now,
    )
    orm_db.session.add(action)
    orm_db.session.commit()

    return jsonify({
        "success": True,
        "message": "Dry-run action created",
        "action": action_to_dict(action),
    }), 201
    
@user_bp.route(
    "/api/business/<business_id>/executions/<execution_id>",
    methods=["GET"],
)
def get_execution_status(business_id, execution_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business",
        }), 403

    execution_row = _get_child(Execution, execution_id, business_id)

    if execution_row is None:
        return jsonify({
            "success": False,
            "error": "Execution not found",
        }), 404

    if str(execution_row.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this execution",
        }), 403

    return jsonify({
        "success": True,
        "execution": execution_to_dict(execution_row),
    }), 200
    
@user_bp.route(
    "/api/business/<business_id>/actions/test-approval",
    methods=["POST"],
)
def create_test_approval_action(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to modify this business",
        }), 403

    now = datetime.utcnow()

    action = Action(
        business_id=business_id,
        owner_id=user_id,
        title="Test approval workflow",
        action_type="dry_run",
        objective="Verify the approval-to-execution workflow.",
        description="Safe development test of action approval and execution.",
        reasoning="Used to verify the production approval pipeline without external side effects.",
        expected_outcome="Dry-run execution completes successfully.",
        required_inputs=[],
        requires_approval=True,
        status="pending_approval",
        created_at=now,
        updated_at=now,
    )
    orm_db.session.add(action)
    orm_db.session.commit()

    return jsonify({
        "success": True,
        "message": "Test approval action created",
        "action": action_to_dict(action),
    }), 201
    
@user_bp.route(
    "/api/business/<business_id>/measurements",
    methods=["GET"],
)
def get_business_measurements(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business",
        }), 403

    measurements_query = (
        orm_db.session.query(Measurement)
        .filter_by(business_id=business_id)
    )

    execution_id = request.args.get("execution_id")

    if execution_id:
        measurements_query = measurements_query.filter_by(
            execution_id=execution_id,
        )

    metric = request.args.get("metric")

    if metric:
        measurements_query = measurements_query.filter_by(metric=metric)

    measurements = [
        measurement_to_dict(row) for row in measurements_query.all()
    ]

    return jsonify({
        "success": True,
        "business_id": business_id,
        "measurements": measurements,
    }), 200
    
@user_bp.route(
    "/api/business/<business_id>/learnings",
    methods=["GET"],
)
def get_business_learnings(business_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    business = get_business_row(business_id)

    if business is None:
        return jsonify({
            "success": False,
            "error": "Business not found",
        }), 404

    if str(business.owner_id) != user_id:
        return jsonify({
            "success": False,
            "error": "You do not have permission to view this business",
        }), 403

    learnings_query = (
        orm_db.session.query(Learning)
        .filter_by(business_id=business_id)
    )

    execution_id = request.args.get("execution_id")

    if execution_id:
        learnings_query = learnings_query.filter_by(
            execution_id=execution_id,
        )

    outcome = request.args.get("outcome")

    if outcome:
        learnings_query = learnings_query.filter_by(outcome=outcome)

    learnings = [learning_to_dict(row) for row in learnings_query.all()]

    return jsonify({
        "success": True,
        "business_id": business_id,
        "learnings": learnings,
    }), 200
    

# ─────────────────────────────────────────────────────────────
# Auth-redirect stubs (targets of auth.py:login redirects)
# ─────────────────────────────────────────────────────────────

@user_bp.route("/dashboard", methods=["GET"])
def dashboard():
    return jsonify({"success": True, "message": "Dashboard placeholder"}), 200


@user_bp.route("/create-profile", methods=["GET", "POST"])
def create_profile():
    return jsonify({"success": True, "message": "Profile placeholder"}), 200


@user_bp.route("/generate-logbook", methods=["GET"])
def generate_logbook():
    return jsonify({"success": True, "message": "Logbook placeholder"}), 200

