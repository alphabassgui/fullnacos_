import logging
import os
from datetime import datetime

import requests

from services.token_encryption import encrypt_token, decrypt_token
from firebase import db

logger = logging.getLogger(__name__)

# Short timeout so a slow/unreachable provider never stalls account deletion.
_REVOKE_TIMEOUT_SECONDS = 10


def create_connection(
    business_id,
    user_id,
    provider,
    connection_data,
):

    business_ref = (
        db.collection("businesses")
        .document(business_id)
    )

    business_doc = business_ref.get()

    if not business_doc.exists:
        raise ValueError("Business not found")

    business = business_doc.to_dict()

    if business.get("owner_id") != user_id:
        raise PermissionError(
            "You do not have permission to modify this business"
        )

    now = datetime.utcnow().isoformat()

    for token_field in ("access_token", "refresh_token"):
        if connection_data.get(token_field):
            connection_data = {
                **connection_data,
                token_field: encrypt_token(
                    connection_data[token_field]
                ),
            }

    connection = {
        "provider": provider,
        "status": "connected",
        "created_at": now,
        "updated_at": now,
        **connection_data,
    }

    connection_ref = (
        business_ref
        .collection("connections")
        .document()
    )

    connection_ref.set(connection)

    return {
        "id": connection_ref.id,
        **connection,
    }
    



def get_connection(
    business_id,
    user_id,
    provider,
):
    """
    Retrieve a connected external platform account.

    The access token is decrypted internally and returned
    only to backend code that explicitly needs it.
    """

    business_ref = (
        db.collection("businesses")
        .document(business_id)
    )

    business_doc = business_ref.get()

    if not business_doc.exists:
        raise ValueError("Business not found")

    business = business_doc.to_dict()

    if business.get("owner_id") != user_id:
        raise PermissionError(
            "You do not have permission to access this business"
        )

    connections = (
        business_ref
        .collection("connections")
        .where(
            "provider",
            "==",
            provider,
        )
        .where(
            "status",
            "==",
            "connected",
        )
        .order_by(
            "updated_at",
            direction="DESCENDING",
        )
        .limit(1)
        .stream()
    )

    connection_doc = next(
        connections,
        None,
    )

    if not connection_doc:
        return None
            
        

    connection = connection_doc.to_dict()

    encrypted_token = connection.get(
        "access_token"
    )

    if not encrypted_token:
        raise ValueError(
            "Connection does not contain an access token"
        )

    access_token = decrypt_token(
        encrypted_token
    )

    return {
        "id": connection_doc.id,
        "provider": connection.get(
            "provider"
        ),
        "account_id": connection.get(
            "account_id"
        ),
        "username": connection.get(
            "username"
        ),
        "site_id": connection.get(
            "site_id"
        ),
        "token_expires_at": connection.get(
            "token_expires_at"
        ),
        "repository": connection.get(
            "repository"
        ),
        "default_branch": connection.get(
            "default_branch"
        ),
        "access_token": access_token,
        "refresh_token": (
            decrypt_token(connection["refresh_token"])
            if connection.get("refresh_token")
            else None
        ),
    }
    
def delete_connection(
    business_id,
    user_id,
    provider,
):
    """
    Hard-delete the stored connection(s) for a provider on a business.

    Removes every matching "connected" connection doc from Firestore so no
    stale connection survives. Returns the number of docs deleted (an int);
    0 means nothing was connected.
    """

    business_ref = (
        db.collection("businesses")
        .document(business_id)
    )

    business_doc = business_ref.get()

    if not business_doc.exists:
        raise ValueError("Business not found")

    business = business_doc.to_dict()

    if business.get("owner_id") != user_id:
        raise PermissionError(
            "You do not have permission to modify this business"
        )

    connections = (
        business_ref
        .collection("connections")
        .where(
            "provider",
            "==",
            provider,
        )
        .where(
            "status",
            "==",
            "connected",
        )
        .stream()
    )

    deleted = 0

    for connection_doc in connections:
        # Provider-side OAuth token revocation is handled separately by the
        # best-effort revoke_github_token / revoke_google_token helpers below
        # (called from the account-deletion flow). Here we only remove the
        # stored Firestore connection doc.
        connection_doc.reference.delete()
        deleted += 1

    return deleted


def create_github_connection(
    business_id,
    user_id,
    access_token,
    owner,
    repo,
    default_branch=None,
):
    connection_data = {
        "account_id": owner,
        "repository": repo,
    }

    if default_branch:
        connection_data["default_branch"] = default_branch

    return create_connection(
        business_id=business_id,
        user_id=user_id,
        provider="github",
        connection_data={
            "access_token": access_token,
            **connection_data,
        },
    )


def revoke_github_token(access_token):
    """Best-effort revocation of a GitHub OAuth access token, provider-side.

    Calls GitHub's "Delete an app token" endpoint
    (DELETE /applications/<client_id>/token) with HTTP Basic auth using the
    OAuth app's client id and secret, and the token to revoke in the JSON body.
    See https://docs.github.com/rest/apps/oauth-applications (returns 204 on
    success).

    This is strictly best-effort: a missing env var or token, or any failure,
    returns False and is logged. It NEVER raises — account deletion must still
    remove the stored Firestore data even when the provider call fails.

    Returns True only when the provider confirmed revocation (2xx).
    """
    if not access_token:
        return False

    client_id = os.environ.get("GITHUB_CLIENT_ID")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET")
    if not client_id or not client_secret:
        # OAuth app not configured in this environment → nothing we can revoke.
        return False

    try:
        resp = requests.delete(
            f"https://api.github.com/applications/{client_id}/token",
            auth=(client_id, client_secret),
            json={"access_token": access_token},
            headers={"Accept": "application/vnd.github+json"},
            timeout=_REVOKE_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        # Timeout, DNS, connection reset, etc. Log WITHOUT the token.
        logger.warning("GitHub token revocation request failed: %s", exc)
        return False

    if 200 <= resp.status_code < 300:
        return True

    logger.warning(
        "GitHub token revocation returned HTTP %s", resp.status_code
    )
    return False


def revoke_google_token(token):
    """Best-effort revocation of a Google OAuth token, provider-side.

    Calls Google's revocation endpoint (POST https://oauth2.googleapis.com/revoke)
    with the token as a form-urlencoded ``token`` parameter. See
    https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke.
    Callers should pass the refresh_token when present (revoking it also revokes
    derived access tokens), otherwise the access_token.

    This is strictly best-effort: a missing token or any failure returns False
    and is logged. It NEVER raises.

    Returns True only when the provider confirmed revocation (2xx).
    """
    if not token:
        return False

    try:
        resp = requests.post(
            "https://oauth2.googleapis.com/revoke",
            data={"token": token},
            timeout=_REVOKE_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        # Timeout, DNS, connection reset, etc. Log WITHOUT the token.
        logger.warning("Google token revocation request failed: %s", exc)
        return False

    if 200 <= resp.status_code < 300:
        return True

    logger.warning(
        "Google token revocation returned HTTP %s", resp.status_code
    )
    return False