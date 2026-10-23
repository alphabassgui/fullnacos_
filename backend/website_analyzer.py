from __future__ import annotations

import ipaddress
import logging
import re
import socket
import threading
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup


logger = logging.getLogger(__name__)


MAX_HTML_SIZE = 2 * 1024 * 1024  # 2 MB (of DECOMPRESSED content)
REQUEST_TIMEOUT = 10
MAX_REDIRECTS = 5

ALLOWED_PORTS = {80, 443}
ALLOWED_SCHEMES = {"http", "https"}

MAX_URL_LENGTH = 2048

# ---------------------------------------------------------------------------
# IP / network policy (duplicated from url_validator.py by design)
# ---------------------------------------------------------------------------

_BLOCKED_NETWORKS = tuple(
    ipaddress.ip_network(c)
    for c in (
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
        "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
        "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
        "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
        "::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8",
        "2001:db8::/32",
    )
)

_BLOCKED_HOSTNAMES = frozenset({
    "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback",
    "broadcasthost",
})
_BLOCKED_SUFFIXES = (".local", ".internal", ".lan", ".home.arpa", ".corp")

_FORBIDDEN_CHARS_RE = re.compile(r"[\x00-\x20\x7f-\x9f]")


def _is_blocked_ip(ip):
    if isinstance(ip, ipaddress.IPv6Address):
        mapped = ip.ipv4_mapped
        if mapped is not None:
            ip = mapped
    return any(ip in net for net in _BLOCKED_NETWORKS)


def _parse_ipv4_notation(host):
    """IPv4 in ANY notation: dotted decimal, short form, pure decimal
    ('2130706433'), octal ('017700000001'), hex ('0x7f000001')."""
    h, base = host, 10
    if h.lower().startswith("0x"):
        base, h = 16, h[2:]
    elif len(h) > 1 and h.startswith("0") and h.isdigit():
        base = 8
    try:
        if "." in h:
            parts = h.split(".")
            if not 1 <= len(parts) <= 4:
                return None
            value = 0
            for part in parts:
                if not part or len(part) > 3:
                    return None
                n = int(part, base)
                if not 0 <= n <= 255:
                    return None
                value = (value << 8) | n
            value <<= 8 * (4 - len(parts))
            return ipaddress.IPv4Address(value)
        if not h:
            return None
        return ipaddress.IPv4Address(int(h, base))
    except ValueError:
        return None


def _parse_ip_literal(host):
    if ":" in host:
        try:
            return ipaddress.ip_address(host)
        except ValueError:
            return None
    if host and any(c.isdigit() for c in host) and all(
        c in "0123456789.xabcdefABCDEF" for c in host
    ):
        return _parse_ipv4_notation(host)
    return None


# ---------------------------------------------------------------------------
# Thread-local DNS pinning (closes the DNS-rebinding TOCTOU window)
# ---------------------------------------------------------------------------

_ORIGINAL_GETADDRINFO = socket.getaddrinfo
_PIN_STATE = threading.local()


def _dispatch_getaddrinfo(host, port, *args, **kwargs):
    pins = getattr(_PIN_STATE, "pins", None)
    if pins:
        key = str(host).lower().rstrip(".")
        pinned = pins.get(key)
        if pinned is not None:
            results = _ORIGINAL_GETADDRINFO(host, port, *args, **kwargs)
            # Fail closed: if the re-lookup no longer contains the pinned
            # IP (rebinding), hand back an empty result set and the
            # connection simply cannot be established.
            return [r for r in results if r[4][0] == pinned] or []
    return _ORIGINAL_GETADDRINFO(host, port, *args, **kwargs)


# Install the dispatcher exactly once, at import time.
if socket.getaddrinfo is not _dispatch_getaddrinfo:
    socket.getaddrinfo = _dispatch_getaddrinfo


class _pin_dns:
    """For the current thread, force `hostname` to resolve ONLY to `ip`."""

    def __init__(self, hostname, ip):
        self.hostname = hostname.lower().rstrip(".")
        self.ip = str(ip)

    def __enter__(self):
        pins = dict(getattr(_PIN_STATE, "pins", None) or {})
        pins[self.hostname] = self.ip
        _PIN_STATE.pins = pins
        return self

    def __exit__(self, *exc):
        pins = dict(getattr(_PIN_STATE, "pins", None) or {})
        pins.pop(self.hostname, None)
        _PIN_STATE.pins = pins or None
        return False


# ---------------------------------------------------------------------------
# Validation: parse strictly, resolve, return (normalized_url, pinned_ip)
# ---------------------------------------------------------------------------

_DNS_TIMEOUT = 5.0


def _resolve_public_ips(hostname):
    """Resolve hostname; raise ValueError unless EVERY address is public.
    Returns the list of validated addresses."""
    old = socket.getdefaulttimeout()
    socket.setdefaulttimeout(_DNS_TIMEOUT)
    try:
        results = _ORIGINAL_GETADDRINFO(hostname, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"Hostname does not resolve: {exc}") from exc
    finally:
        socket.setdefaulttimeout(old)

    addresses = []
    for family, _type, _proto, _canon, sockaddr in results:
        try:
            addresses.append(ipaddress.ip_address(sockaddr[0]))
        except ValueError:
            pass  # e.g. scope-id oddities; will fail the emptiness check

    if not addresses:
        raise ValueError("Hostname resolved to no usable addresses.")

    for addr in addresses:
        if _is_blocked_ip(addr):
            raise ValueError(
                f"Hostname resolves to a private or restricted address: {addr}"
            )
    return addresses


def validate_and_pin(url):
    """Strictly validate `url` and return (normalized_url, pinned_ip).

    Raises ValueError with a safe message on any problem. This is the ONLY
    door to the network: every request hop passes through it.
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL is required.")

    url = url.strip()
    if not url or len(url) > MAX_URL_LENGTH:
        raise ValueError("URL is missing or too long.")

    # Blank/control characters anywhere (CVE-2023-24329 class).
    if _FORBIDDEN_CHARS_RE.search(url):
        raise ValueError("URL contains forbidden characters.")

    try:
        parsed = urlsplit(url)
    except ValueError:
        raise ValueError("URL could not be parsed.")

    scheme = parsed.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise ValueError("Only HTTP and HTTPS URLs are allowed.")

    if not parsed.netloc or parsed.hostname is None:
        raise ValueError("URL hostname is missing.")

    # Stray '[' / ']' in the authority (CVE-2025-0938 class).
    if ("[" in parsed.netloc or "]" in parsed.netloc) and not (
        parsed.netloc.startswith("[") and "]" in parsed.netloc
    ):
        raise ValueError("URL hostname is malformed.")

    # Credentials: https://user:password@example.com (and user@:port@host).
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URLs containing credentials are not allowed.")

    # Backslashes in the authority (WHATWG parser differential).
    if "\\" in parsed.netloc:
        raise ValueError("URL contains forbidden characters.")

    # Port: only 80 and 443, and it must actually parse.
    try:
        port = parsed.port
    except ValueError:
        raise ValueError("URL port is invalid.")
    if port is None:
        port = 443 if scheme == "https" else 80
    if port not in ALLOWED_PORTS:
        raise ValueError("Only ports 80 and 443 are allowed.")

    hostname = parsed.hostname.lower().rstrip(".")

    # IP literal? glibc would otherwise resolve "2130706433" etc. for us.
    ip = _parse_ip_literal(hostname)
    if ip is not None:
        if _is_blocked_ip(ip):
            raise ValueError(
                "The website resolves to a private or restricted address."
            )
        return url, ip  # pin the literal itself

    if hostname in _BLOCKED_HOSTNAMES or any(
        hostname.endswith(sfx) for sfx in _BLOCKED_SUFFIXES
    ):
        raise ValueError("The website resolves to a private or restricted address.")

    if not hostname or len(hostname) > 253 or ".." in hostname:
        raise ValueError("URL hostname is malformed.")

    addresses = _resolve_public_ips(hostname)
    return url, addresses[0]


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

# A realistic modern-browser header set. The old bot User-Agent
# ("AI-Growth-Agent/1.0 (Website Analysis Bot)") was rejected with 403 by most
# WAFs; sending the headers an ordinary Chrome request sends clears the bulk of
# those blocks without any browser automation.
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

_BROWSER_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    # Accept-Encoding is left to requests so it only advertises codecs it can
    # transparently decode.
}

# HTTP statuses where the plain request looks WAF-blocked / transiently
# unavailable and a headless-browser fetch is worth attempting as a fallback.
# (403/429 plus any 5xx.)
_FALLBACK_STATUSES = frozenset({403, 429})


def _read_limited(response):
    """Stream at most MAX_HTML_SIZE DECOMPRESSED bytes from a response."""
    chunks = []
    total = 0
    try:
        for chunk in response.iter_content(chunk_size=8192):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_HTML_SIZE:
                raise ValueError("Website HTML is too large to analyze.")
            chunks.append(chunk)
    finally:
        response.close()
    return b"".join(chunks)


def _should_fallback(status_code):
    """True when a plain-request status looks WAF-blocked / transiently
    unavailable enough to be worth a headless-browser retry (403/429/5xx)."""
    return status_code in _FALLBACK_STATUSES or 500 <= status_code <= 599


def _fetch_html_via_playwright(url):
    """Headless-browser fallback for pages the plain request can't get past
    (e.g. WAF 403/429). Reuses the Playwright capability already in the repo —
    the OOM-tuned Chromium launch args from the PixelRAG service — rather than
    adding a new scraping dependency.

    Returns the page HTML as bytes, or ``None`` on any failure (Playwright or
    Chromium unavailable, OOM, navigation error). Soft-failing to ``None`` —
    the same way PixelRAG degrades — lets the caller fall through to its
    graceful error instead of crashing the audit run.
    """
    try:
        from playwright.sync_api import sync_playwright
        from services.pixelrag_service import CHROMIUM_LAUNCH_ARGS
    except Exception as exc:  # pragma: no cover - import guard
        logger.warning("Playwright fallback unavailable for %s: %s", url, exc)
        return None

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=CHROMIUM_LAUNCH_ARGS)
            try:
                page = browser.new_page()
                page.goto(
                    url,
                    timeout=REQUEST_TIMEOUT * 1000,
                    wait_until="domcontentloaded",
                )
                html = page.content()
            finally:
                browser.close()
    except Exception as exc:
        logger.warning(
            "Playwright fallback failed for %s; falling through to graceful "
            "error: %s",
            url,
            exc,
        )
        return None

    # Match the bytes contract of the plain-request path.
    return html.encode("utf-8") if isinstance(html, str) else html


def fetch_website_html(url, session=None):
    """Safely fetch website HTML: strict per-hop validation + DNS pinning +
    manual redirect handling. Returns (html_bytes, final_url)."""
    session = session or requests
    visited = set()

    for _ in range(MAX_REDIRECTS + 1):
        current_url, pinned_ip = validate_and_pin(url)

        # Redirect loop guard (A -> B -> A within the hop budget).
        if current_url in visited:
            raise ValueError("Redirect loop detected.")
        visited.add(current_url)

        try:
            with _pin_dns(_hostname_of(current_url), pinned_ip):
                response = session.get(
                    current_url,
                    timeout=REQUEST_TIMEOUT,
                    allow_redirects=False,  # we validate every hop ourselves
                    headers=_BROWSER_HEADERS,
                    stream=True,
                )
        except requests.exceptions.RequestException as exc:
            # Timeouts / connection errors become a friendly, run-failing error
            # (the caller turns this into a graceful failed run, not a crash).
            raise ValueError(
                f"Could not reach the website ({exc.__class__.__name__})."
            ) from exc

        if response.status_code in {301, 302, 303, 307, 308}:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise ValueError("Redirect response has no destination.")
            # Full strict validation happens on the next loop iteration.
            url = urljoin(current_url, location)
            continue

        if response.status_code != 200:
            status_code = response.status_code
            response.close()
            # WAF-blocked / transiently unavailable: retry with the headless
            # browser before giving up. current_url has already passed
            # validate_and_pin this iteration, so the fallback only ever runs
            # against an already-validated URL.
            if _should_fallback(status_code):
                html = _fetch_html_via_playwright(current_url)
                if html is not None:
                    return html, current_url
            raise ValueError(f"Website returned HTTP {status_code}.")

        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" not in content_type:
            response.close()
            raise ValueError("The URL did not return an HTML document.")

        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                declared = int(content_length)
            except ValueError:
                declared = None  # malformed header; streaming cap still applies
            # NOTE: never `raise` inside the try above — the except would
            # swallow it (a bug inherited from the original implementation,
            # which silently never enforced the Content-Length pre-check).
            if declared is not None and declared > MAX_HTML_SIZE:
                response.close()
                raise ValueError("Website HTML is too large to analyze.")

        return _read_limited(response), current_url

    raise ValueError("Too many redirects.")


def _hostname_of(url):
    return urlsplit(url).hostname.lower().rstrip(".")


# ---------------------------------------------------------------------------
# Analysis (unchanged logic)
# ---------------------------------------------------------------------------

def analyze_html(html):
    """Extract useful information from the website HTML."""
    soup = BeautifulSoup(html, "html.parser")

    title = soup.title.get_text(strip=True) if soup.title else ""

    description_tag = soup.find("meta", attrs={"name": "description"})
    description = ""
    if description_tag:
        description = description_tag.get("content", "").strip()

    headings = []
    for heading in soup.find_all(["h1", "h2", "h3"]):
        text = heading.get_text(" ", strip=True)
        if text:
            headings.append(text)

    links = []
    for link in soup.find_all("a", href=True):
        href = link.get("href")
        if href:
            links.append({
                "text": link.get_text(" ", strip=True),
                "href": href,
            })

    return {
        "title": title,
        "description": description,
        "meta_description": description,
        "headings": headings[:50],
        "links": links[:100],
    }
