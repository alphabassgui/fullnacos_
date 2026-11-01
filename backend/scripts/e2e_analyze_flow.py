import os
import secrets
import sys
import time

import requests
from flask.sessions import SecureCookieSessionInterface

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:5000")


def _csrf(session_cookie):
    from app import app as flask_app
    serializer = SecureCookieSessionInterface().get_signing_serializer(flask_app)
    data = serializer.loads(session_cookie)
    return data.get("_login_csrf")


def register_and_login(rand):
    s = requests.Session()
    email = f"e2e-{rand}@blom.test"
    pw = secrets.token_urlsafe(12)
    # Random per-phase source IP keeps repeated E2E runs clear of the
    # per-IP registration/login rate limits.
    fake_ip = f"198.51.100.{int(rand, 16) % 240 + 1}"
    headers = {"X-Forwarded-For": fake_ip}

    r = s.get(f"{BASE}/login")
    assert r.status_code == 200, r.text
    csrf = _csrf(s.cookies.get("session"))

    r = s.post(
        f"{BASE}/register",
        data={"username": f"e2euser-{rand}", "email": email, "password": pw, "confirm_password": pw},
        headers=headers,
        allow_redirects=False,
    )
    assert r.status_code == 302, r.text

    r = s.post(
        f"{BASE}/login",
        data={"email": email, "password": pw, "device_id": "e2e-device", "login_token": csrf},
        headers=headers,
        allow_redirects=False,
    )
    assert r.status_code == 302, r.text
    return s, email, pw


def create_business(s, name, url):
    r = s.post(f"{BASE}/api/business", json={"name": name, "website_url": url})
    assert r.status_code == 201, r.text
    return r.json()["business"]["id"]


def trigger_analyze(s, biz_id):
    r = s.post(f"{BASE}/api/business/{biz_id}/analyze", json={})
    assert r.status_code == 202, r.text
    return r.json()["run_id"], r.json()["task_id"]


def poll_run(s, biz_id, run_id, timeout=120):
    """Poll the runs/latest API endpoint until the run completes or times out."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = s.get(f"{BASE}/api/business/{biz_id}/runs/latest")
        if r.status_code != 200:
            time.sleep(1)
            continue
        run = r.json().get("run") or {}
        if run.get("run_id") != run_id:
            time.sleep(1)
            continue
        if run.get("status") in ("completed", "failed"):
            return run
        time.sleep(1)
    return {}


def run_happy(rand):
    s, email, pw = register_and_login(rand)
    biz_id = create_business(s, "E2E Happy Business", "https://example.com")
    run_id, task_id = trigger_analyze(s, biz_id)
    print(f"[happy] biz={biz_id} run={run_id} task={task_id}")
    data = poll_run(s, biz_id, run_id)
    assert data.get("status") == "completed", f"expected completed, got {data}"
    obs_id = data.get("observation_id")
    assert obs_id, "run missing observation_id"
    print(f"[happy] PASS observation={obs_id} status=completed")
    return email, pw, [biz_id]


def run_failure(rand):
    s, email, pw = register_and_login(rand)
    biz_id = create_business(s, "E2E Failure Business", f"https://does-not-exist-{rand}.invalid")
    run_id, task_id = trigger_analyze(s, biz_id)
    print(f"[fail] biz={biz_id} run={run_id} task={task_id}")
    data = poll_run(s, biz_id, run_id)
    assert data.get("status") == "failed", f"expected failed, got {data}"
    assert data.get("error"), "failed run missing error field"
    print(f"[fail] PASS run failed with error={data['error']!r}")
    return email, pw, [biz_id]


def cleanup(accounts):
    """Delete each test account via the DELETE /api/auth/account API.

    ``accounts`` is a list of (email, password) tuples. A fresh session is
    created per account so cleanup is independent of the test session state."""
    for email, pw in accounts:
        try:
            s = requests.Session()
            # Get a CSRF token via a fresh login page load, then log in.
            r = s.get(f"{BASE}/login")
            csrf = _csrf(s.cookies.get("session"))
            s.post(
                f"{BASE}/login",
                data={"email": email, "password": pw, "device_id": "cleanup", "login_token": csrf},
                allow_redirects=False,
            )
            r = s.delete(f"{BASE}/api/auth/account", json={"confirm_email": email})
            if r.status_code == 200:
                print(f"[cleanup] deleted account {email}")
            else:
                print(f"[cleanup] account delete failed for {email}: {r.status_code} {r.text}")
        except Exception as exc:
            print(f"[cleanup] error deleting {email}: {exc}")


def main():
    accounts = []
    for fn in ("run_happy", "run_failure"):
        try:
            email, pw, _ = getattr(sys.modules[__name__], fn)(secrets.token_hex(4))
            accounts.append((email, pw))
        except AssertionError as exc:
            print(f"[FAIL] {fn}: {exc}")
            cleanup(accounts)
            sys.exit(1)
    cleanup(accounts)
    print("E2E PASS")


if __name__ == "__main__":
    main()
