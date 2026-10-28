"""
GTM Routes (routes.gtm_routes).

API Blueprint for Visual GTM Operating System:
- POST /api/gtm/run: Dispatch a background GTM visual analysis run
- GET /api/gtm/runs: List historical GTM runs for a business
- GET /api/gtm/runs/<run_id>: Get full run telemetry and visual scores
- GET /api/gtm/runs/<run_id>/dossier: Download executive Markdown dossier
"""
from __future__ import annotations

import uuid as _uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, session, current_app, send_file

from extensions import db as orm_db
from models import GtmRun, get_business_row, gtm_run_to_dict

gtm_bp = Blueprint("gtm_bp", __name__)


def _verify_business_ownership(business_id: str, user_id: str):
    """Verify that business exists and belongs to the authenticated user.

    The parent business lives in Postgres; its GTM children also live in
    Postgres now (PR d-gtm). Returns (Business row, None) on success.
    """
    business = get_business_row(business_id)
    if business is None:
        return None, (jsonify({"success": False, "error": "Business not found"}), 404)

    if str(business.owner_id) != user_id:
        return None, (jsonify({"success": False, "error": "Unauthorized"}), 403)

    return business, None


@gtm_bp.route("/api/gtm/run", methods=["POST"])
def trigger_gtm_run():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    business_id = payload.get("business_id")
    if not business_id:
        return jsonify({"success": False, "error": "Missing business_id"}), 400

    business, error_resp = _verify_business_ownership(business_id, user_id)
    if error_resp:
        return error_resp

    run = GtmRun(
        business_id=business.id,
        owner_id=user_id,
        status="queued",
        website_url=business.website_url,
    )
    orm_db.session.add(run)
    orm_db.session.commit()
    run_id = str(run.id)

    try:
        from task import run_gtm_analysis
        task_res = run_gtm_analysis.delay(
            business_id=business_id,
            user_id=user_id,
            run_id=run_id,
        )
        run.celery_task_id = str(task_res.id)
        orm_db.session.commit()
    except Exception as exc:
        current_app.logger.warning("Could not dispatch Celery task immediately: %s", exc)

    return jsonify({
        "success": True,
        "message": "GTM analysis queued successfully",
        "run_id": run_id,
    }), 202


@gtm_bp.route("/api/gtm/runs", methods=["GET"])
def list_gtm_runs():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    business_id = request.args.get("business_id")
    if not business_id:
        return jsonify({"success": False, "error": "Missing business_id"}), 400

    _, error_resp = _verify_business_ownership(business_id, user_id)
    if error_resp:
        return error_resp

    try:
        biz_uuid = _uuid.UUID(business_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Business not found"}), 404

    runs = (
        orm_db.session.query(GtmRun)
        .filter_by(business_id=biz_uuid)
        .order_by(GtmRun.created_at.desc())
        .all()
    )

    return jsonify({
        "success": True,
        "runs": [gtm_run_to_dict(r) for r in runs],
    }), 200


@gtm_bp.route("/api/gtm/runs/<run_id>", methods=["GET"])
def get_gtm_run(run_id: str):
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    business_id = request.args.get("business_id")
    if not business_id:
        return jsonify({"success": False, "error": "Missing business_id"}), 400

    _, error_resp = _verify_business_ownership(business_id, user_id)
    if error_resp:
        return error_resp

    try:
        run_uuid = _uuid.UUID(run_id)
        biz_uuid = _uuid.UUID(business_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "GTM run not found"}), 404

    run = (
        orm_db.session.query(GtmRun)
        .filter_by(id=run_uuid, business_id=biz_uuid)
        .first()
    )
    if run is None:
        return jsonify({"success": False, "error": "GTM run not found"}), 404

    return jsonify({
        "success": True,
        "run": gtm_run_to_dict(run),
    }), 200


@gtm_bp.route("/api/gtm/runs/<run_id>/dossier", methods=["GET"])
def get_gtm_dossier(run_id: str):
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    business_id = request.args.get("business_id")
    if not business_id:
        return jsonify({"success": False, "error": "Missing business_id"}), 400

    _, error_resp = _verify_business_ownership(business_id, user_id)
    if error_resp:
        return error_resp

    try:
        run_uuid = _uuid.UUID(run_id)
        biz_uuid = _uuid.UUID(business_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "GTM run not found"}), 404

    run = (
        orm_db.session.query(GtmRun)
        .filter_by(id=run_uuid, business_id=biz_uuid)
        .first()
    )
    if run is None:
        return jsonify({"success": False, "error": "GTM run not found"}), 404

    dossier_path = run.dossier_path
    if not dossier_path or not Path(dossier_path).exists():
        from services.gtm_dossier_service import generate_gtm_dossier_markdown
        content = generate_gtm_dossier_markdown(gtm_run_to_dict(run))
        return content, 200, {"Content-Type": "text/markdown; charset=utf-8"}

    return send_file(dossier_path, mimetype="text/markdown", as_attachment=False)
