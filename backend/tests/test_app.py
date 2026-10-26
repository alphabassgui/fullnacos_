import app as app_module


def test_cors_set_uses_exactly_those_origins():
    origins = app_module.resolve_cors_origins(
        " https://app.example.com , https://preview.example.com,, "
    )
    assert origins == ["https://app.example.com", "https://preview.example.com"]
    assert "http://localhost:3000" not in origins


def test_cors_unset_falls_back_to_localhost_only():
    for raw in (None, "", "   ", " , ,"):
        assert app_module.resolve_cors_origins(raw) == ["http://localhost:3000"]


def test_debug_unset_is_false():
    assert app_module.resolve_debug(None) is False
    assert app_module.resolve_debug("") is False


def test_debug_true_still_enables():
    assert app_module.resolve_debug("true") is True
    assert app_module.resolve_debug("True") is True
    assert app_module.resolve_debug("false") is False
