"""PixelRAG Page Rendering & Vertical Tiling Service.

Renders web pages using headless Playwright Chromium, normalizes viewport
dimensions, handles lazy scrolling and cookie dismissal, slices pages into
sequential vertical tiles (WebP), and produces a structured manifest.json.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

TILE_LABELS = [
    "hero",
    "value",
    "social",
    "pricing",
    "features",
    "details",
    "testimonials",
    "faq",
    "footer",
    "extra_1",
    "extra_2",
    "extra_3",
]

COOKIE_SELECTORS = [
    "#accept-cookie",
    "#accept-cookies",
    "#cookie-accept",
    "#onetrust-accept-btn-handler",
    "[aria-label*='cookie' i]",
    "[aria-label*='consent' i]",
    ".cookie-banner button",
    ".cookie-banner",
    "button[id*='cookie' i]",
    "button[class*='cookie' i]",
]

CHROMIUM_LAUNCH_ARGS = [
    "--disable-dev-shm-usage",   # use /tmp instead of tiny 64MB /dev/shm — the key OOM fix
    "--no-sandbox",              # required on Render's non-root container
    "--disable-gpu",             # no GPU on the server; saves memory
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-renderer-backgrounding",
    "--disable-features=TranslateUI",
    "--no-first-run",
]


class PixelRAGError(Exception):
    """Base exception for PixelRAG service errors."""
    pass


class PixelRAGNavigationError(PixelRAGError):
    """Raised when page navigation fails completely."""
    pass


def dismiss_cookie_banners(page) -> None:
    """Attempt to find and dismiss common cookie banners and modals."""
    for sel in COOKIE_SELECTORS:
        try:
            elem = page.query_selector(sel)
            if elem:
                elem.click(timeout=1000)
                break
        except Exception as e:
            logger.debug(f"Could not dismiss cookie banner with selector {sel}: {e}")
            continue


def get_tile_filename(index: int) -> str:
    """Generate sequential tile filename based on index (1-based)."""
    idx_0 = index - 1
    label = TILE_LABELS[idx_0] if 0 <= idx_0 < len(TILE_LABELS) else f"section_{index}"
    return f"tile_{index:04d}_{label}.webp"


def render_and_tile_page(
    url: str,
    output_dir: str,
    max_height: int = 8000,
    tile_height: int = 800,
    viewport_width: int = 1280,
    viewport_height: int = 800,
    device_scale_factor: float = 1.0,
    timeout_ms: int = 15000,
    screenshot_timeout_ms: int = 20000,
) -> Dict[str, Any]:
    """Render a web page using Playwright and slice into vertical tiles.

    Args:
        url: Webpage URL to render.
        output_dir: Local filesystem directory where tiles & manifest will be saved.
        max_height: Maximum pixel height to render and slice (default: 8000).
        tile_height: Height of each vertical tile slice in pixels (default: 800).
        viewport_width: Viewport width in pixels (default: 1280).
        viewport_height: Viewport height in pixels (default: 800).
        device_scale_factor: Device pixel ratio (default: 1.0). Kept at 1.0 to
            halve per-screenshot bitmap size, which keeps capture within memory
            and time budget on small headless containers (e.g. Render free tier).
        timeout_ms: Navigation timeout in milliseconds (default: 15000).
        screenshot_timeout_ms: Per-tile screenshot timeout in milliseconds
            (default: 20000).

    Returns:
        dict: Manifest containing URL, page dimensions, tile metadata, and file paths.
    """
    if not url or not url.strip():
        raise ValueError("URL must be a non-empty string")

    output_dir_str = str(output_dir)
    os.makedirs(output_dir_str, exist_ok=True)

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=CHROMIUM_LAUNCH_ARGS)
            try:
                page = browser.new_page(
                    viewport={"width": viewport_width, "height": viewport_height},
                    device_scale_factor=device_scale_factor,
                )

                # Navigation with domcontentloaded fallback
                try:
                    page.goto(url, timeout=timeout_ms, wait_until="networkidle")
                except Exception as e:
                    logger.warning(f"networkidle navigation failed for {url}, falling back to domcontentloaded: {e}")
                    try:
                        page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
                    except Exception as err:
                        raise PixelRAGNavigationError(f"Failed to navigate to {url}: {err}") from err

                # Auto-dismiss cookie banners
                dismiss_cookie_banners(page)

                # Measure document height
                raw_height = page.evaluate("() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)")
                try:
                    page_height = int(raw_height)
                except (TypeError, ValueError):
                    page_height = 0

                tiles: List[Dict[str, Any]] = []

                if page_height > 0:
                    clamped_height = min(page_height, max_height)
                    offset = 0
                    tile_idx = 1

                    while offset < clamped_height:
                        current_slice_height = min(tile_height, clamped_height - offset)
                        filename = get_tile_filename(tile_idx)
                        file_path = os.path.join(output_dir_str, filename)

                        # Capture the band currently in view. The clip is
                        # viewport-relative, so y=0 is the top of what is on screen
                        # right now (we scroll between tiles, below, rather than
                        # clipping at an absolute page offset — a clip past the
                        # viewport raises "Clipped area is outside the resulting
                        # image" and yields blank tiles).
                        # animations="disabled" freezes CSS animations/transitions
                        # (and cancels infinite ones to their first frame) so a
                        # heavily animated page yields a stable frame immediately
                        # instead of the capture stalling until the explicit
                        # timeout — the "Page.screenshot: Timeout exceeded" failure
                        # mode on memory-constrained containers.
                        screenshot_bytes = page.screenshot(
                            clip={
                                "x": 0,
                                "y": 0,
                                "width": viewport_width,
                                "height": current_slice_height,
                            },
                            animations="disabled",
                            timeout=screenshot_timeout_ms,
                        )

                        tile_url: Optional[str] = None
                        if isinstance(screenshot_bytes, bytes):
                            with open(file_path, "wb") as f:
                                f.write(screenshot_bytes)

                            # Also persist the tile to durable object storage so it
                            # survives the ephemeral local disk being wiped on
                            # redeploy/idle. The object key mirrors the on-disk
                            # layout minus a leading "static/" (forward slashes
                            # regardless of OS), e.g.
                            # "tiles/<biz>/<run>/user_site/tile_0001_hero.webp".
                            # Lazy-imported (mirrors task.py) to avoid import-time
                            # coupling. A None return or any hiccup is non-fatal:
                            # the tile just carries "url": None and the local path
                            # remains the same-instance fallback.
                            from services.tile_storage_service import upload_tile_bytes

                            object_key = file_path.replace(os.sep, "/").lstrip("/")
                            if object_key.startswith("static/"):
                                object_key = object_key[len("static/"):]
                            tile_url = upload_tile_bytes(screenshot_bytes, object_key)

                        tiles.append({
                            "index": tile_idx,
                            "filename": filename,
                            "path": file_path,
                            "url": tile_url,
                            "scroll_top": offset,
                            "scroll_bottom": offset + current_slice_height,
                            "width": viewport_width,
                            "height": current_slice_height,
                        })

                        # Scroll the next band into view and let it paint / lazy-load
                        # before the next iteration captures it.
                        try:
                            page.mouse.wheel(0, current_slice_height)
                        except Exception:
                            pass
                        page.wait_for_timeout(250)

                        offset += current_slice_height
                        tile_idx += 1

                manifest_path = os.path.join(output_dir_str, "manifest.json")
                manifest = {
                    "url": url,
                    "page_height": page_height,
                    "max_height": max_height,
                    "viewport_width": viewport_width,
                    "viewport_height": viewport_height,
                    "device_scale_factor": device_scale_factor,
                    "tiles": tiles,
                    "manifest_path": manifest_path,
                }

                with open(manifest_path, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, indent=2)

                return manifest

            finally:
                # Belt-and-suspenders cleanup: close the page before the browser
                # so it isn't held across the run. A close error here must never
                # mask the real result.
                try:
                    page.close()
                except Exception:
                    pass
                browser.close()

    except PixelRAGError:
        # Navigation / logic errors (e.g. PixelRAGNavigationError) keep their contract.
        raise
    except Exception as exc:
        # Soft-fail: the headless browser is unavailable (chromium not installed on
        # Render) or the launch/render crashed for an environment reason (e.g. the
        # browser was OOM-killed). Log and return a valid manifest with an empty tiles
        # list — same shape/keys as the success path — so a GTM run degrades gracefully
        # on text/metadata instead of crashing on a missing/over-memory browser.
        logger.warning(
            "PixelRAG browser unavailable for %s; returning empty-tiles manifest: %s",
            url,
            exc,
        )
        manifest_path = os.path.join(output_dir_str, "manifest.json")
        manifest = {
            "url": url,
            "page_height": 0,
            "max_height": max_height,
            "viewport_width": viewport_width,
            "viewport_height": viewport_height,
            "device_scale_factor": device_scale_factor,
            "tiles": [],
            "manifest_path": manifest_path,
        }
        try:
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)
        except Exception:
            pass
        return manifest
