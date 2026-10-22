"""Durable tile persistence via Supabase Storage.

PixelRAG writes each screenshot tile to the local filesystem (see
``pixelrag_service.render_and_tile_page``), but that disk is ephemeral on the
deploy target (Render): it is wiped on every redeploy/restart and when a free
instance spins down after idle, so a run's tiles 404 intermittently once any of
that happens. This module uploads each tile to Supabase Storage at capture time
and returns its durable PUBLIC URL, which the manifest records so the frontend
can prefer it over the ephemeral local path.

It uses the Supabase Storage REST API directly via ``requests`` (already a
dependency) rather than the heavy supabase-py SDK. The feature is entirely
optional: when the Supabase env vars are unset the upload is a no-op that
returns ``None`` and tiling falls back to the local path, exactly as before.
"""

import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# Short timeout so a slow/unreachable Supabase never stalls a GTM run's tiling.
_UPLOAD_TIMEOUT_SECONDS = 15


def upload_tile_bytes(
    data: bytes,
    object_key: str,
    content_type: str = "image/webp",
) -> Optional[str]:
    """Upload one tile to Supabase Storage and return its public URL.

    Args:
        data: Raw tile bytes (a WebP screenshot).
        object_key: Storage path within the bucket, e.g.
            ``tiles/<biz>/<run>/user_site/tile_0001_hero.webp`` (forward slashes).
        content_type: MIME type of the upload (default ``image/webp``).

    Returns:
        The public URL string on success, or ``None`` when storage is not
        configured or the upload fails for any reason. This function NEVER
        raises — a storage hiccup must not interrupt tiling.
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY")
    bucket = os.environ.get("SUPABASE_TILES_BUCKET")

    # Feature simply off when any piece of config is missing/empty. No error.
    if not supabase_url or not service_key or not bucket:
        return None

    base = supabase_url.rstrip("/")
    key = object_key.lstrip("/")
    upload_url = f"{base}/storage/v1/object/{bucket}/{key}"

    try:
        # PUT with x-upsert so a re-run of the same (biz, run) overwrites cleanly
        # rather than 409-ing on an existing object.
        resp = requests.put(
            upload_url,
            data=data,
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            timeout=_UPLOAD_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        # Timeout, DNS, connection reset, etc. Log WITHOUT the key or headers.
        logger.warning("Supabase tile upload failed for %s: %s", object_key, exc)
        return None

    if 200 <= resp.status_code < 300:
        return f"{base}/storage/v1/object/public/{bucket}/{key}"

    # Non-2xx: log the status (never the key/headers) and fall back to local.
    logger.warning(
        "Supabase tile upload for %s returned HTTP %s", object_key, resp.status_code
    )
    return None
