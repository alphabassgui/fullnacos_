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


# Page size when listing objects, and a hard cap on how many list requests we
# will make, so a pathological bucket can never spin forever.
_LIST_PAGE_SIZE = 1000
_MAX_LIST_REQUESTS = 1000


def _list_all_keys(base, bucket, prefix, headers):
    """Recursively collect every object key under ``prefix`` in the bucket.

    Supabase's list endpoint treats ``/`` as a folder delimiter, so a single
    listing of ``tiles/<biz>/`` returns the ``<run>`` sub-folders rather than
    the nested tile files. We walk folders depth-first, paging each level, and
    accumulate full object keys. Returned entry ``name`` values are relative to
    the listed prefix; an entry with a null ``id`` is a folder, otherwise a file.
    """
    list_url = f"{base}/storage/v1/object/list/{bucket}"
    keys = []
    # Breadth-first over folders; bounded by _MAX_LIST_REQUESTS.
    pending_prefixes = [prefix]
    requests_made = 0

    while pending_prefixes:
        current = pending_prefixes.pop()
        offset = 0
        while True:
            if requests_made >= _MAX_LIST_REQUESTS:
                logger.warning(
                    "Supabase tile list hit request cap while cleaning up %s", prefix
                )
                return keys
            requests_made += 1
            resp = requests.post(
                list_url,
                json={
                    "prefix": current,
                    "limit": _LIST_PAGE_SIZE,
                    "offset": offset,
                },
                headers=headers,
                timeout=_UPLOAD_TIMEOUT_SECONDS,
            )
            if not (200 <= resp.status_code < 300):
                logger.warning(
                    "Supabase tile list for a prefix returned HTTP %s",
                    resp.status_code,
                )
                # Skip this prefix; keep whatever we have gathered so far.
                break

            entries = resp.json() or []
            for entry in entries:
                name = entry.get("name")
                if not name:
                    continue
                full = current + name
                # A folder has no id/metadata; recurse into it. A file has an id.
                if entry.get("id") is None:
                    pending_prefixes.append(full + "/")
                else:
                    keys.append(full)

            if len(entries) < _LIST_PAGE_SIZE:
                break
            offset += _LIST_PAGE_SIZE

    return keys


def delete_tiles_for_business(business_id):
    """Best-effort removal of every stored tile blob for a business.

    Deletes all objects under ``tiles/<business_id>/`` from Supabase Storage via
    the REST API (recursive list, then a bulk delete by exact keys). Mirrors
    ``upload_tile_bytes``: when the Supabase env vars are unset this is a no-op,
    and it NEVER raises — a storage hiccup must not interrupt account deletion.
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY")
    bucket = os.environ.get("SUPABASE_TILES_BUCKET")

    # Feature simply off when any piece of config is missing/empty. No error.
    if not supabase_url or not service_key or not bucket:
        return

    base = supabase_url.rstrip("/")
    prefix = f"tiles/{business_id}/"
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }

    try:
        keys = _list_all_keys(base, bucket, prefix, headers)
        if not keys:
            return

        delete_url = f"{base}/storage/v1/object/{bucket}"
        # Delete in batches so a very large run cannot build one giant request.
        for start in range(0, len(keys), _LIST_PAGE_SIZE):
            batch = keys[start:start + _LIST_PAGE_SIZE]
            resp = requests.delete(
                delete_url,
                json={"prefixes": batch},
                headers={**headers, "Content-Type": "application/json"},
                timeout=_UPLOAD_TIMEOUT_SECONDS,
            )
            if not (200 <= resp.status_code < 300):
                logger.warning(
                    "Supabase tile delete for business %s returned HTTP %s",
                    business_id,
                    resp.status_code,
                )
    except Exception as exc:
        # Timeout, DNS, connection reset, bad JSON, etc. Log WITHOUT headers.
        logger.warning(
            "Supabase tile cleanup failed for business %s: %s", business_id, exc
        )
