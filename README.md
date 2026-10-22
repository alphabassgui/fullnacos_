# Groville

> **An AI growth agent for Nigerian SMEs.** Groville reads a business's website (and Google Search Console), finds the single biggest customer/search gap, drafts the campaign to fix it, and — once the owner approves — runs it and measures what it earned.

Built by **The ALPHAs** for the **NACOS National BuildX** hackathon.

> **The one rule that defines the product (the "honesty boundary"):**
> **Groville only ever _drafts_. The owner reviews and approves. Nothing is ever published or sent automatically**, and the Results screen only ever reports what was *actually measured* — never an invented number.

---

## 1. What is this repo?

This is the **combined (monorepo)** for the whole app — both halves live here:

```
fullnacos_/
├── frontend/   # The dashboard the business owner uses (Next.js)
└── backend/    # The "brain": API + background workers (Flask)
```

- **frontend/** — what the user sees and clicks. Next.js app.
- **backend/** — does the real work: stores data, calls the AI, analyses the website, runs approved actions, measures results.

> Note on naming: some backend files/README say **"Blom"** — that's an older name. The product is **Groville**. Same app.

---

## 2. How it works (the loop)

```
Sign up  →  Onboarding (add your website)  →  Groville ANALYSES the site
        →  OPPORTUNITIES (the biggest gaps, ranked)
        →  CAMPAIGN DRAFT (Groville writes the fix)
        →  You REVIEW & APPROVE
        →  Groville EXECUTES the approved action
        →  RESULTS (what it earned) + what it learned
```

Under the hood:

```
[ Browser ]  --cookie auth-->  [ Frontend: Next.js :3000 ]
                                      |  (fetch, credentials: 'include')
                                      v
                               [ Backend: Flask :5000 ]
                                /        |            \
                        Firestore   Redis + Celery     Groq LLM
                        (database)  (async jobs:       (text drafts +
                                     analyze /          vision scoring)
                                     execute /
                                     GTM run)
                                         |
                                   Playwright Chromium
                                   (PixelRAG: screenshots
                                    → WebP tiles for GTM)
```

Alongside the main loop, **GTM / PixelRAG** (section 5) runs as its own on-demand async job: it screenshots your site + competitors, scores your go-to-market, and drafts a recommendation — and the gaps it finds feed straight back into your Opportunities board.

---

## 3. Tech stack

**Frontend** — Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Framer Motion
**Backend** — Flask · Firebase / Firestore (database) · Redis + Celery (background jobs) · Groq (LLM)
**Visual GTM (PixelRAG)** — headless **Playwright Chromium** (full-page screenshots + vertical tiling → WebP) · **Groq Vision LLM** (multimodal scoring of your site vs competitors)
**Auth** — Flask session **cookie** (the frontend calls the API with `credentials: 'include'`)

---

## 4. The MVP — what works today

The **full demo loop runs end to end on real data**:

- ✅ Email/password **sign up + login** (Flask session cookie)
- ✅ **Onboarding** → create a business from a website
- ✅ **Analyze** the website (async, via Celery + Groq)
- ✅ **Opportunities** — real, ranked customer/search gaps
  - **Recovery + re-run:** if a user lands on the dashboard without an audit (e.g. they skipped onboarding), they can **add a website and run the audit right there** (a modal, no need to redo onboarding), or **re-run the audit any time** from the board. While a run works, the page shows a real in-dashboard **"Analysing → Reading your site"** state (not a generic loader), and a re-run keeps existing results on screen until the fresh ones arrive.
- ✅ **Campaign draft** → **approve** → **execute** → **measure**
- ✅ **Results** — real measurements + learnings
- ✅ **Connections** — Website (read), Google Search Console (read), **GitHub** (OAuth)
- ✅ **GTM / PixelRAG** _(newly added — see section 5)_ — a **visual** go-to-market audit: Groville screenshots your site and up to two competitors, scores your go-to-market across 4 pillars, names the blind spots, and **drafts a recommendation dossier you review**. The gaps it finds also flow into your normal Opportunities board.
- ✅ **Payments** — BMONI **sandbox** (simulate payment completes the demo)
- ✅ **Product tour** for first-time users on the Opportunities page

**What is _simulated_ (by design, and it's honest about it):**
Most action executions run in **dry-run mode** — they do **not** make a real external change. A completed execution writes one honest signal (`execution_success`) that shows up on Results. Groville deliberately **does not fabricate** rich metrics (rankings, clicks, etc.) it can't truly measure — that's the honesty boundary in action.

**Not in the MVP (future work):**
- Instagram **publishing** (needs Meta app review — not possible in the hackathon window)
- Real per-channel measurement (beyond the dry-run success signal)

---

## 5. GTM / PixelRAG — the visual go-to-market audit

This is the newest capability in the app. Everything below is **live and merged** (backend first, then the frontend surface in PR #20).

### What it is
A **vision-model** audit of your go-to-market surface. Instead of only reading your HTML, Groville *looks at* your site the way a visitor does — it takes real screenshots, compares them against competitors' screenshots, and scores how clearly you sell. **PixelRAG** is the screenshot-and-tile engine; the **GTM engine** is the vision analysis on top of it.

### Where to see it
A new **GTM** item in the dashboard sidebar (between Opportunities and Campaigns), route **`/gtm`**. Press **Run GTM analysis** (enabled once your business has a website), watch the ~90-second progress state, then read the result.

### How it works (the pipeline)
```
POST /api/gtm/run  (202 + run_id)                         [routes/gtm_routes.py]
        │  Celery task: run_gtm_analysis                  [task.py]
        ▼
1. PixelRAG renders + tiles YOUR site        render_and_tile_page  [services/pixelrag_service.py]
2. Discover up to 2 competitors (from GSC)   discover_competitors  [services/gtm_discovery_service.py]
3. PixelRAG renders + tiles each competitor
4. Vision LLM scores you vs them (4 pillars) analyze_gtm_tiles     [agent/gtm_engine.py]
5. The gaps it finds are written as normal OPPORTUNITIES  create_opportunity
6. An executive Markdown DOSSIER is drafted + saved       [services/gtm_dossier_service.py]
7. Run marked `completed`; frontend polls GET /api/gtm/runs/<id> every 15s until done
```

The **4 GTM pillars** (each scored 0–100, plus an overall): **above the fold**, **pricing clarity**, **social proof**, **CRO friction**.

### GTM / PixelRAG "sync" — how it ties into the rest of the app
The important integration point: **GTM is not a silo.** The opportunities the vision model finds are persisted through the *same* `create_opportunity` service the rest of the app uses, so **a GTM run also populates your normal Opportunities board** (the run records how many it created in `opportunities_created_count`). The screenshot **tiles** PixelRAG produces are written under `backend/static/tiles/<business_id>/<run_id>/…` and the frontend loads them through the existing **`/api/backend/*`** rewrite proxy (same first-party-cookie path every other API call uses) — no new auth surface. This alignment of the tile manifest shape, the opportunity store, and the dossier is what the recent *"gtm-pixelrag-sync"* work locked in.

### The data a run returns (what the UI renders)
`gtm_scores` (the 5 gauges) · `blind_spots[]` · `user_manifest.tiles[]` (your site capture) · `competitors_analyzed[]` (each with `domain`, `url`, and `manifest.tiles`) · `dossier_path` · `opportunities_created_count`.

> **Note:** the vision model *does* reason about competitor strengths/weaknesses internally, but those are **not persisted** on the run document in this phase — only `domain`, `url`, and tiles are. The frontend therefore does not render strength/weakness lists, and the dossier does not depend on them.

### Honesty boundary (unchanged, and it matters here)
The dossier is a **draft recommendation you read and act on**. The UI labels it *"Groville's draft recommendation — review before acting."* It is **never** presented as sent, published, or auto-executed. Groville drafts; you approve.

### ⏱️ Model & capture timeouts (and what "timeout of models" means here)
Two different kinds of timeout matter, plus one model-lifecycle risk:

| Where | Setting | Default |
|---|---|---|
| **PixelRAG** page navigation | `timeout_ms` (Playwright `goto`, falls back `networkidle` → `domcontentloaded`) | **15 s** |
| **PixelRAG** per-tile screenshot | `screenshot_timeout_ms` | **20 s** |
| **Frontend** per-request fetch (`apiFetch` + dossier fetch) | `AbortController` | **60 s** |
| **Frontend** poll cadence / ceiling | every **15 s**, up to **40 ticks** (~10 min) before giving up |
| **Vision LLM** request | Groq default request timeout (not overridden in code) | Groq default |

> **"Timeout of models" / model decommission risk:** the vision model id is **`GROQ_VISION_MODEL`** (default `qwen/qwen3.8-27b`). **Groq rotates and retires models** — the previous default (`llama-3.2-11b-vision-preview`) was **decommissioned**, which breaks a run with a model-not-found error until the env var is pointed at a current multimodal model. If GTM runs start failing at the vision step, **check this first**. (The text LLM used elsewhere is `GROQ_MODEL`.)

### ⚠️ Risks & known limitations (read before demoing GTM)
- **Tiles are transient.** They live on Render's **ephemeral disk**, which is wiped on every redeploy and is **not shared across instances**. An older run's screenshots can simply be gone. The UI treats this as best-effort: a broken image is hidden on error, and a run with no tiles shows **"Visual capture unavailable for this run"** instead of a broken layout. Treat tiles as best-effort, never as durable storage.
- **Soft-fail still reports `completed`.** If the browser OOMs, a screenshot times out, or the vision model hiccups, the pipeline keeps going and the run completes with **empty tiles and/or flat `50` scores** (the clamp default). This is intentional (a run shouldn't hard-crash the loop) — but it means a "completed" run can be visually empty. The UI degrades gracefully; just **re-run** for a clean capture.
- **Render free tier is memory-constrained.** Chromium launches with memory-safe flags (`--disable-dev-shm-usage` — the key OOM fix — plus `--no-sandbox`, `--disable-gpu`) and pages are closed/cleaned between captures. Heavy pages were the main source of screenshot timeouts; that's mitigated but not eliminated on the free tier.
- **Competitor discovery depends on GSC seed queries.** If Search Console isn't connected / has no queries, competitor discovery is weaker, so the comparison is less useful.
- **Vision scoring is probabilistic.** Scores and blind spots are a model's read of screenshots, not ground truth — present them as guidance, not fact.
- **The full completed result view was not exercised end-to-end against a live backend** during the frontend build (it was type-checked, linted, built, and verified for its non-ready/empty states). Eyeball a real completed run on a connected deploy before relying on it in a demo.

---

## 6. Prerequisites (install these once)

- **Node.js 20+** and **npm**
- **Python 3.11+** and **pip**
- **Redis** running locally on `localhost:6379`
  - On **Windows**, use **Memurai** (a Redis-compatible service)
- A **Firebase project + service account JSON** (the database is Firestore) — get the JSON file from **Felix**
- A **Groq API key**
- A **GitHub OAuth app** (only needed for the GitHub connection)
- A **BMONI sandbox key** (only needed for payments) — ask **William**

---

## 7. Environment variables — READ THIS CAREFULLY

**Secrets are NOT in this repo** (they're gitignored). Every teammate creates their own. There are **two** env files, one per app.

> ### 🔑 The golden rule: use `localhost` EVERYWHERE, not `127.0.0.1`
> The login uses a session cookie. If the frontend talks to `127.0.0.1:5000` but you open the app at `localhost:3000` (or vice-versa), the browser treats them as different sites and **drops the cookie → you get logged out / 401 right after login.** Keep it `localhost` on both sides, and in the GitHub callback URL too.

### 7a. Backend — create `backend/.env`

There is **no example file** for the backend, so create `backend/.env` yourself with these keys:

| Variable | What it is |
|---|---|
| `SECRET_KEY` | Signs the Flask session cookie. Any long random string. |
| `FIREBASE_CREDENTIALS` | **Absolute path** to your Firebase service account JSON file (get it from Felix). |
| `GROQ_API_KEY` | Your Groq LLM API key. |
| `GROQ_MODEL` | The **text** model id, e.g. `openai/gpt-oss-20b`. |
| `GROQ_VISION_MODEL` | The **vision** model id for GTM / PixelRAG (default `qwen/qwen3.8-27b`). **Point it at a current multimodal model** — Groq retires these (see section 5 "Model & capture timeouts"). |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored OAuth tokens (a Fernet key). |
| `GITHUB_CLIENT_ID` | From your GitHub **OAuth App**. |
| `GITHUB_CLIENT_SECRET` | From your GitHub **OAuth App**. |
| `GITHUB_REDIRECT_URI` | `http://localhost:5000/api/connections/github/callback` — must **exactly** match the callback URL set on your OAuth app. |
| `FRONTEND_URL` | `http://localhost:3000` — where the GitHub callback sends the user back to. |
| `DEBUG` | `True` locally (keeps the cookie non-Secure so it works over plain http). |
| `INSTAGRAM_*` | Optional — only for the Instagram connection; not needed for the core demo. |

> **GitHub tip:** use an **OAuth App** (not a GitHub App). OAuth App tokens don't expire and match the code's `scope=repo` flow. A GitHub App's user tokens expire after 8 hours and cause a "Try again" / 401 on the Connections screen.

### 7b. Frontend — create `frontend/.env`

**Copy `frontend/env.example` → `frontend/.env`** and fill it in. (Next.js also reads `.env.local` if you prefer that name — either works; it's gitignored the same way.) Key values:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:5000` — the Flask backend. **Use `localhost`** (see the golden rule). Leave **blank** to run the offline "Ada" demo with no real backend. |
| `BMONI_API_KEY` | BMONI **sandbox** payments key. **Ask William** — never commit it. |
| `BMONI_BASE_URL` | `https://embedded-dev.bmoni.com` (sandbox only). |
| `DEMO_FALLBACK_ACCOUNT` | `true` — shows a labelled placeholder account if BMONI can't issue a real one, so the demo still runs. |
| `CRON_SECRET`, `BMONI_MERCHANT_PHONE`, `APP_PUBLIC_URL`, `NEXT_PUBLIC_SUPABASE_*` | Optional — see the comments inside `env.example`. |

> ⚠️ **Never commit** `.env`, `.env.local`, or the Firebase service account JSON. If you ever paste a key into a chat or a public place, rotate it.

---

## 8. Running it locally

You'll use **up to 4 terminals**. Quick guide:
- **Just testing login/signup?** You only need **Flask + Frontend** (terminals 4 and 5).
- **Testing analyze / approve / execute / results?** You need **all four** (Redis, Celery, Flask, Frontend).

### Step 1 — Backend setup
```bash
cd backend
python -m venv venv

# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

pip install -r requirements.txt
```
Then create `backend/.env` (section 7a) and make sure `FIREBASE_CREDENTIALS` points at your real service account JSON.

### Step 2 — Redis (terminal 1)
Start Redis (Windows: start **Memurai**). It must be reachable at `localhost:6379`.

### Step 3 — Celery worker (terminal 2, venv active)
```bash
celery -A task worker --loglevel=info --pool=solo
```
> **`--pool=solo` is REQUIRED on Windows** — without it Celery crashes with `WinError 5`.

### Step 4 — Flask API (terminal 3, venv active)
```bash
python app.py
```
Runs on **http://localhost:5000**.

### Step 5 — Frontend (terminal 4)
```bash
cd frontend
npm install        # required after every pull (deps like framer-motion)
npm run dev
```
Open **http://localhost:3000**. 🎉

---

## 9. Backend API — quick reference

All under cookie auth (`credentials: 'include'`). Business routes are under `/api/business/<id>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` · `login` · `logout` · `GET /api/auth/me` |
| Business | `POST /api/business` · `PATCH/DELETE /api/business/<id>` |
| Analyze (async) | `POST .../analyze` → then poll `GET .../runs/latest` |
| Opportunities | `GET .../opportunities` |
| Actions | `GET .../actions` · `POST .../actions/<id>/approve` · `.../reject` |
| Execution | `GET .../executions/<id>` (poll: queued → running → completed/failed) |
| Results | `GET .../measurements` · `GET .../learnings` |
| Connections | GitHub: `/api/connections/github/connect · callback · repositories`; Search Console: `/api/connections/search-console/*`; Instagram: `/api/connections/instagram/*` |
| GTM / PixelRAG (async) | `POST /api/gtm/run` (→ `run_id`) · `GET /api/gtm/runs?business_id=` · `GET /api/gtm/runs/<id>?business_id=` (poll) · `GET /api/gtm/runs/<id>/dossier?business_id=` (**text/markdown**) |

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| **Logged out / 401 right after login** | You're mixing `localhost` and `127.0.0.1`. Use `localhost` everywhere (API base, browser URL, GitHub callback). |
| **Celery: `WinError 5`** | Start the worker with `--pool=solo`. |
| **GitHub connection shows "Try again" / 401** | The OAuth token expired or the callback URL doesn't match. Use an **OAuth App**, set both the app's callback and `GITHUB_REDIRECT_URI` to `http://localhost:5000/api/connections/github/callback`, restart Flask, and reconnect. |
| **"No connector available for action type: X"** | Make sure the backend is on the latest `main` (the connector fallback is merged). |
| **Analyze crashes: "Opportunity response must be a JSON object"** | The small LLM occasionally returns malformed JSON. Just **re-run analyze**. |
| **GTM run fails at the vision step (model-not-found)** | The vision model was retired by Groq. Set `GROQ_VISION_MODEL` to a current multimodal model and restart (see section 5). |
| **GTM run shows "Visual capture unavailable" / flat 50 scores** | A soft-fail (Chromium OOM, screenshot timeout, or vision hiccup) — the run still completes. **Re-run** for a clean capture. Old runs may also have lost their tiles on a Render redeploy (ephemeral disk). |
| **GTM screenshots keep timing out on big sites** | Heavy pages on Render's free tier. Mitigated by memory-safe Chromium flags + WebP tiling, but not eliminated; re-run, or try on a non-free instance. |
| **Instagram won't publish** | Expected — publishing needs Meta app review; not in the MVP. |

---

## 11. Contributing

- Branch off the latest `main` → open a PR → squash-merge → delete the branch.
- **Never commit** `.env`, `.env.local`, or the Firebase service account JSON.
- Run `npm run lint` and `npm run build` (frontend) before opening a PR.

---

*The ALPHAs · NACOS National BuildX*
