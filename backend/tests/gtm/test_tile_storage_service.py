from unittest.mock import MagicMock, patch

from services.tile_storage_service import upload_tile_bytes

# A full, valid Supabase config the "feature on" tests patch into the env. The
# bucket name is deliberately distinct from the object key's leading "tiles/"
# segment so the two read apart in the asserted URLs (bucket and key are
# independent — the key carries its own "tiles/" from the on-disk layout).
_ENV = {
    "SUPABASE_URL": "https://proj.supabase.co",
    "SUPABASE_SERVICE_KEY": "service-role-secret",
    "SUPABASE_TILES_BUCKET": "site-tiles",
}

_OBJECT_KEY = "tiles/biz-1/run-1/user_site/tile_0001_hero.webp"


def test_upload_tile_bytes_returns_public_url_on_2xx():
    with patch.dict("os.environ", _ENV, clear=False), \
            patch("services.tile_storage_service.requests") as mock_requests:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_requests.put.return_value = mock_resp

        result = upload_tile_bytes(b"fake-webp-bytes", _OBJECT_KEY)

        assert result == (
            "https://proj.supabase.co/storage/v1/object/public/site-tiles/"
            "tiles/biz-1/run-1/user_site/tile_0001_hero.webp"
        )
        # Uploaded to the object endpoint with upsert; never the public endpoint.
        args, kwargs = mock_requests.put.call_args
        assert args[0] == (
            "https://proj.supabase.co/storage/v1/object/site-tiles/"
            "tiles/biz-1/run-1/user_site/tile_0001_hero.webp"
        )
        assert kwargs["data"] == b"fake-webp-bytes"
        assert kwargs["headers"]["x-upsert"] == "true"
        assert kwargs["headers"]["Authorization"] == "Bearer service-role-secret"


def test_upload_tile_bytes_returns_none_when_env_missing():
    # Clear the Supabase env entirely — feature off, must not touch requests.
    missing_env = {k: "" for k in _ENV}
    with patch.dict("os.environ", missing_env, clear=False), \
            patch("services.tile_storage_service.requests") as mock_requests:
        result = upload_tile_bytes(b"fake-webp-bytes", _OBJECT_KEY)

        assert result is None
        mock_requests.put.assert_not_called()


def test_upload_tile_bytes_returns_none_on_non_2xx():
    with patch.dict("os.environ", _ENV, clear=False), \
            patch("services.tile_storage_service.requests") as mock_requests:
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_requests.put.return_value = mock_resp

        result = upload_tile_bytes(b"fake-webp-bytes", _OBJECT_KEY)

        assert result is None


def test_upload_tile_bytes_returns_none_and_never_raises_on_exception():
    with patch.dict("os.environ", _ENV, clear=False), \
            patch("services.tile_storage_service.requests") as mock_requests:
        mock_requests.put.side_effect = Exception("connection reset")

        # Must swallow the exception and return None rather than propagating.
        result = upload_tile_bytes(b"fake-webp-bytes", _OBJECT_KEY)

        assert result is None


def test_upload_tile_bytes_never_logs_service_key(caplog):
    import logging

    with patch.dict("os.environ", _ENV, clear=False), \
            patch("services.tile_storage_service.requests") as mock_requests:
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_requests.put.return_value = mock_resp

        with caplog.at_level(logging.WARNING):
            upload_tile_bytes(b"fake-webp-bytes", _OBJECT_KEY)

        assert "service-role-secret" not in caplog.text
