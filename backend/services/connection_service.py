import logging
import os
import uuid as _uuid
from datetime import datetime

import requests

from extensions import db as orm_db
from models import Connection, connection_to_dict, get_business_row
from services.token_encryption import encrypt_token, decrypt_token

logger = logging.getLogger(__name__)

# Short timeout so a slow/unreachable provider never stalls account deletion.
_REVOKE_TIMEOUT_SECONDS = 10


def create_connection(
    business_id,
    user_id,
    provider,
    connection_data,
):
    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != user_id:
        raise PermissionError(
            "You do not have permission to modify this business"
        )

    for token_field in ("access_token", "refresh_token"):
        if connection_data.get(token_field):
            connection_data = {
                **connection_data,
                token_field: encrypt_token(
                    connection_data[token_field]
                ),
            }

    row = Connection(
        business_id=_uuid.UUID(str(business_id)),
        provider=provider,
        status="connected",
        access_token=connection_data.get("access_token"),
        refresh_token=connection_data.get("refresh_token"),
        account_id=connection_data.get("account_id"),
        repository=connection_data.get("repository"),
        default_branch=connection_data.get("default_branch"),
        token_uri=connection_data.get("token_uri"),
        token_expires_at=connection_data.get("token_expires_at"),
        granted_scopes=connection_data.get("granted_scopes"),
        properties_count=connection_data.get("properties_count"),
        site_id=connection_data.get("site_id"),
        username=connection_data.get("username"),
        expires_in=connection_data.get("expires_in"),
    )
    orm_db.session.add(row)
    orm_db.session.flush()
    orm_db.session.commit()

    # Return shape matches the Firestore-era dict (id + provider + status +
    # timestamps + connection_data with encrypted tokens).
    created_at = row.created_at
    updated_at = row.updated_at
    if created_at is not None and getattr(created_at, "tzinfo", None) is not None:
        created_at = created_at.replace(tzinfo=None)
    if updated_at is not None and getattr(updated_at, "tzinfo", None) is not None:
        updated_at = updated_at.replace(tzinfo=None)

    return {
        "id": str(row.id),
        "provider": provider,
        "status": "connected",
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        **connection_data,
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
    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != user_id:
        raise PermissionError(
            "You do not have permission to access this business"
        )

    row = (
        orm_db.session.query(Connection)
        .filter_by(
            business_id=_uuid.UUID(str(business_id)),
            provider=provider,
            status="connected",
        )
        .order_by(Connection.updated_at.desc())
        .limit(1)
        .first()
    )

    if row is None:
        return None

    if not row.access_token:
        raise ValueError(
            "Connection does not contain an access token"
        )

    return connection_to_dict(
        row,
        access_token=decrypt_token(row.access_token),
        refresh_token=(
            decrypt_token(row.refresh_token)
            if row.refresh_token
            else None
        ),
    )


def delete_connection(
    business_id,
    user_id,
    provider,
):
    """
    Hard-delete all stored 'connected' connections for a provider on a business.

    Returns the number of rows deleted (an int); 0 means nothing was connected.
    """
    business = get_business_row(business_id)

    if business is None:
        raise ValueError("Business not found")

    if str(business.owner_id) != user_id:
        raise PermissionError(
            "You do not have permission to modify this business"
        )

    deleted = (
        orm_db.session.query(Connection)
        .filter_by(
            business_id=_uuid.UUID(str(business_id)),
            provider=provider,
            status="connected",
        )
        .delete(synchronize_session=False)
    )
    orm_db.session.commit()
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
    remove the stored connection data even when the provider call fails.

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
