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
                                /        |          \
                        Firestore     Redis+Celery    Groq LLM
                        (database)   (async jobs:    (writes the
                                      analyze/execute)  drafts)
```

---

## 3. Tech stack

**Frontend** — Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Framer Motion
**Backend** — Flask · Firebase / Firestore (database) · Redis + Celery (background jobs) · Groq (LLM)
**Auth** — Flask session **cookie** (the frontend calls the API with `credentials: 'include'`)

---

## 4. The MVP — what works today

The **full demo loop runs end to end on real data**:

- ✅ Email/password **sign up + login** (Flask session cookie)
- ✅ **Onboarding** → create a business from a website
- ✅ **Analyze** the website (async, via Celery + Groq)
- ✅ **Opportunities** — real, ranked customer/search gaps
- ✅ **Campaign draft** → **approve** → **execute** → **measure**
- ✅ **Results** — real measurements + learnings
- ✅ **Connections** — Website (read), Google Search Console (read), **GitHub** (OAuth)
- ✅ **Payments** — BMONI **sandbox** (simulate payment completes the demo)
- ✅ **Product tour** for first-time users on the Opportunities page

**What is _simulated_ (by design, and it's honest about it):**
Most action executions run in **dry-run mode** — they do **not** make a real external change. A completed execution writes one honest signal (`execution_success`) that shows up on Results. Groville deliberately **does not fabricate** rich metrics (rankings, clicks, etc.) it can't truly measure — that's the honesty boundary in action.

**Not in the MVP (future work):**
- Instagram **publishing** (needs Meta app review — not possible in the hackathon window)
- Real per-channel measurement (beyond the dry-run success signal)

---

## 5. Prerequisites (install these once)

- **Node.js 20+** and **npm**
- **Python 3.11+** and **pip**
- **Redis** running locally on `localhost:6379`
  - On **Windows**, use **Memurai** (a Redis-compatible service)
- A **Firebase project + service account JSON** (the database is Firestore) — get the JSON file from **Felix**
- A **Groq API key**
- A **GitHub OAuth app** (only needed for the GitHub connection)
- A **BMONI sandbox key** (only needed for payments) — ask **William**

---

## 6. Environment variables — READ THIS CAREFULLY

**Secrets are NOT in this repo** (they're gitignored). Every teammate creates their own. There are **two** env files, one per app.

> ### 🔑 The golden rule: use `localhost` EVERYWHERE, not `127.0.0.1`
> The login uses a session cookie. If the frontend talks to `127.0.0.1:5000` but you open the app at `localhost:3000` (or vice-versa), the browser treats them as different sites and **drops the cookie → you get logged out / 401 right after login.** Keep it `localhost` on both sides, and in the GitHub callback URL too.

### 6a. Backend — create `backend/.env`

There is **no example file** for the backend, so create `backend/.env` yourself with these keys:

| Variable | What it is |
|---|---|
| `SECRET_KEY` | Signs the Flask session cookie. Any long random string. |
| `FIREBASE_CREDENTIALS` | **Absolute path** to your Firebase service account JSON file (get it from Felix). |
| `GROQ_API_KEY` | Your Groq LLM API key. |
| `GROQ_MODEL` | The model id, e.g. `openai/gpt-oss-20b`. |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored OAuth tokens (a Fernet key). |
| `GITHUB_CLIENT_ID` | From your GitHub **OAuth App**. |
| `GITHUB_CLIENT_SECRET` | From your GitHub **OAuth App**. |
| `GITHUB_REDIRECT_URI` | `http://localhost:5000/api/connections/github/callback` — must **exactly** match the callback URL set on your OAuth app. |
| `FRONTEND_URL` | `http://localhost:3000` — where the GitHub callback sends the user back to. |
| `DEBUG` | `True` locally (keeps the cookie non-Secure so it works over plain http). |
| `INSTAGRAM_*` | Optional — only for the Instagram connection; not needed for the core demo. |

> **GitHub tip:** use an **OAuth App** (not a GitHub App). OAuth App tokens don't expire and match the code's `scope=repo` flow. A GitHub App's user tokens expire after 8 hours and cause a "Try again" / 401 on the Connections screen.

### 6b. Frontend — create `frontend/.env`

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

## 7. Running it locally

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
Then create `backend/.env` (section 6a) and make sure `FIREBASE_CREDENTIALS` points at your real service account JSON.

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

## 8. Backend API — quick reference

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
| Connections | GitHub: `/api/connections/github/connect · callback · repositories`; Instagram: `/api/connections/instagram/*` |

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| **Logged out / 401 right after login** | You're mixing `localhost` and `127.0.0.1`. Use `localhost` everywhere (API base, browser URL, GitHub callback). |
| **Celery: `WinError 5`** | Start the worker with `--pool=solo`. |
| **GitHub connection shows "Try again" / 401** | The OAuth token expired or the callback URL doesn't match. Use an **OAuth App**, set both the app's callback and `GITHUB_REDIRECT_URI` to `http://localhost:5000/api/connections/github/callback`, restart Flask, and reconnect. |
| **"No connector available for action type: X"** | Make sure the backend is on the latest `main` (the connector fallback is merged). |
| **Analyze crashes: "Opportunity response must be a JSON object"** | The small LLM occasionally returns malformed JSON. Just **re-run analyze**. |
| **Instagram won't publish** | Expected — publishing needs Meta app review; not in the MVP. |

---

## 10. Contributing

- Branch off the latest `main` → open a PR → squash-merge → delete the branch.
- **Never commit** `.env`, `.env.local`, or the Firebase service account JSON.
- Run `npm run lint` and `npm run build` (frontend) before opening a PR.

---

*The ALPHAs · NACOS National BuildX*
