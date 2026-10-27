from flask import Blueprint, jsonify, session

from models import Business, business_to_dict, get_business_row

business_api_bp = Blueprint("business_api", __name__)


@business_api_bp.route("/api/business", methods=["GET"])
def list_businesses():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "success": False,
            "error": "Authentication required",
        }), 401

    businesses = (
        Business.query
        .filter_by(owner_id=user_id)
        .order_by(Business.created_at)
        .all()
    )

    business_list = [business_to_dict(business) for business in businesses]

    return jsonify({
        "success": True,
        "businesses": business_list,
    }), 200


@business_api_bp.route("/api/business/<business_id>", methods=["GET"])
def get_business(business_id):
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

    return jsonify({
        "success": True,
        "business": business_to_dict(business),
    }), 200
