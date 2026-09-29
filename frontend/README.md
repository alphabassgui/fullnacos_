# Groville

**Groville is an AI growth agent for Nigerian SMEs.** It reads a business's website and
Google Search Console, names the single biggest customer/search gap, drafts a campaign
(an SEO article + social posts), routes it per channel, then measures and learns — and
**the owner approves everything.**

> **Honesty boundary (never broken):** the MVP **drafts only**. It never auto-sends or
> auto-publishes, and it never charges a card automatically. Everywhere in the product the
> promise is: **"Groville drafts, you approve."**

This repository is the **Next.js frontend**, and it also contains the **BMONI payment
backend** (Next.js API routes) that powers the checkout. The AI marketing backend is a
separate Flask app.

> **Naming:** some backend material is branded **"Blom"**; the product/frontend is
> **"Groville"**. Same app — use *Groville* in all UI.

---

## What's on `main`

`main` is the demo-ready app. It contains:

- **Marketing landing page** (dark + warm-light themes).
- **Dashboard screens:** Opportunities, Campaigns, Results, Connections, plus the demo
  loop screens (Onboarding, Welcome, Analysing, Campaign draft, Sign up / Log in, Tour).
- **Bank-transfer payment flow at `/pay`** — a 3-state checkout (details → transfer →
  confirming → verified, plus an expired state) for the Growth plan, wired to the BMONI
  sandbox.
- **BMONI payment backend** — Next.js API routes under `app/api/*` with the billing and
  BMONI client logic in `lib/billing/*` and `lib/bmoni/*`.

The demo loop: **scan → sign up → welcome → onboarding → analysing → opportunities →
draft → approve → results**, with **`/pay`** as the checkout for the Growth plan.

---

## Tech stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind** + **shadcn/ui** + **Framer Motion**
- Package manager: **npm**
- Payment rail: **BMONI Embedded API** (sandbox only)

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |

---

## Run it locally

### 1. Prerequisites
- **Node.js 20+** (`node -v`)
- **Git**

### 2. Get the code
```bash
git clone https://github.com/alphabassgui/nacos-hackathon.git
cd nacos-hackathon
npm install
```

### 3. Create `.env.local`
Create a file named **`.env.local`** in the **repo root** (next to `package.json`). It is
gitignored — never commit it. See [`env.example`](./env.example) for the full list.

**Option A — quick demo, no BMONI setup** (runs the whole flow on a clearly-labelled
placeholder account, no external calls):
```
DEMO_FALLBACK_ACCOUNT=true
ALLOW_SIMULATE_PAYMENT=true
```

**Option B — real BMONI sandbox account** (shows a genuine PROVIDUS virtual account):
```
BMONI_API_KEY=<your BMONI sandbox key>
BMONI_BASE_URL=https://embedded-dev.bmoni.com
BMONI_MERCHANT_PHONE=+2348000012345
DEMO_FALLBACK_ACCOUNT=true
ALLOW_SIMULATE_PAYMENT=true
CRON_SECRET=dev-cron-secret-change-me
```

### 4. Start
```bash
npm run dev
```
Open **http://localhost:3000** (landing) or **http://localhost:3000/pay** (checkout).
Add `?theme=light` or `?theme=dark` to any URL to force a theme.

Without any auth env set (below), the app runs in **demo mode**: the mock "Ada"
user, no login required, no route gating — the whole demo loop just works.

---

## Auth — run against the Flask backend

Real email/password auth is served by the separate **Flask** app (register/login/logout
over an HttpOnly session cookie). Wire the frontend to it with **one** variable in
`.env.local`:

```
NEXT_PUBLIC_API_BASE=http://127.0.0.1:5000
```

Point it at wherever your Flask app serves (`5000` is its default). Then start Flask
(with Celery + Redis) and, in a second terminal, `npm run dev`.

With this set, the mock demo is off: sign up calls Flask `register` then `login`, log in
calls `login`, logout calls `logout`, the sidebar shows your real username/email, and the
protected routes (`/opportunities`, `/campaigns`, `/results`, `/connections`,
`/campaign-draft`, `/pay`) redirect to `/login` until you're authenticated. Leave
`NEXT_PUBLIC_API_BASE` blank to go back to the demo.

> `NEXT_PUBLIC_*` vars are read when the dev server **starts** — after editing `.env.local`,
> stop the server (`Ctrl+C`) and `npm run dev` again.

### The one gotcha: use the same hostname on both sides

The Flask session cookie is `SameSite=Lax`. Ports don't matter for cookies, but **hostnames
do** — the browser treats `localhost` and `127.0.0.1` as *different* hosts (cross-site), and
a `SameSite=Lax` cookie is **not** sent on a cross-site `fetch` like `GET /api/auth/me`. So
if the app is on one host and the API on the other, login appears to succeed and then you
look logged out.

**Match the hostname, differ only by port:**

| App opened at | Set `NEXT_PUBLIC_API_BASE` to |
|---|---|
| `http://localhost:3000` | `http://localhost:5000` |
| `http://127.0.0.1:3000` | `http://127.0.0.1:5000` |

Quick check in DevTools → Network: after login you should see `Set-Cookie` on the `login`
response **and** that cookie riding along on the following `/api/auth/me` request. If it's on
`login` but missing from `/api/auth/me`, it's this host mismatch.

### Backend side (Flask, not this repo)

If the browser console shows a **CORS** error on `/api/auth/*`, the Flask app must allow your
exact frontend origin *with credentials* (e.g. `CORS(app, supports_credentials=True,
origins=["http://localhost:3000"])`). The origin there must match the host you open the app
at (again, `localhost` vs `127.0.0.1`).

---

## Seeing real Opportunities (the analyze pipeline)

With `NEXT_PUBLIC_API_BASE` set (see [Auth](#auth--run-against-the-flask-backend)) and a
current business, the dashboard runs the **real** analyze pipeline instead of the mock
"Ada" data — no extra flags. The whole chain is already wired: onboarding creates the
business, `/analysing` triggers the scan and polls for it, and `/opportunities` renders
whatever the backend found. Leave `NEXT_PUBLIC_API_BASE` blank to go back to the demo
sample cards.

The pipeline is **async (Celery)**: trigger → poll. So besides Flask you need **Redis and
a Celery worker running** — without a worker, `/analyze` returns `202` but the run never
finishes and `/analysing` spins forever.

### Walk the flow

1. Start Flask + Redis + the Celery worker, then (in this repo) `npm run dev` and open the
   same host you pointed `NEXT_PUBLIC_API_BASE` at.
2. Sign up or log in (real Flask auth; protected routes gate to `/login`).
3. In **onboarding**, enter a business name **and a real website URL**, then submit — this
   calls `POST /api/business` and routes to `/analysing`.
4. **`/analysing`** posts `POST /api/business/<id>/analyze` (→ `202 {run_id,…}`) and polls
   `GET /api/business/<id>/runs/latest` every ~3.5s, showing the scan progress. It does not
   start a second run if one is already in progress. On completion it routes to
   `/opportunities`; on failure it shows the run's error with a **Try again**; if the
   business has no website (`analyze` → `400`) it shows a CTA back to onboarding.
5. **`/opportunities`** fetches `GET /api/business/<id>/opportunities` and renders the real
   findings, highest `potential_impact` first (title, description, problem, humanized
   category, impact badge, evidence), with loading + error states. Nothing goes live until
   you approve it.

All backend calls go through `lib/api.ts` (`analyzeBusiness`, `getLatestRun`,
`getOpportunities`), which always sends the session cookie (`credentials: 'include'`).

### Verify / troubleshoot (DevTools → Network)

| Symptom | Likely cause |
|---|---|
| `/analysing` spins forever | No Celery worker / Redis consuming the queue |
| Auth looks fine then reads logged out | `localhost` vs `127.0.0.1` host mismatch (see the Auth gotcha) |
| `analyze` returns `400` | Business has no `website_url` — redo onboarding with a URL |
| `analyze`/`me` returns `401` | Session cookie not riding the request (host mismatch or CORS without credentials) |
| CORS error in console | Flask must allow your exact origin *with credentials* |

> The poller treats a run as complete when `completed_at` is set, or `opportunity_ids` is
> populated, or its status is `done`/`completed`/`succeeded`. If your backend uses a
> different terminal status string and sets none of those, confirm the real string against
> a finished run and widen `runOutcome()` in `lib/api.ts`.

---

## The payment flow (`/pay`)

`/pay` is the Growth-plan checkout. It **only** calls this app's own API routes — it never
calls BMONI directly and never sends a price (the server prices the plan).

1. **Details** — plan summary (Monthly/Annual · NGN/USD toggles) + a short form. "Continue
   to payment" calls `POST /api/subscribe`, which creates an invoice and returns the exact
   amount and the bank account to pay into.
2. **Transfer** — shows the **exact amount including kobo** (e.g. `₦30,000.01`), the account
   number, bank and account name, with copy buttons and a "waiting for payment" state. It
   polls `GET /api/invoices/{id}` every ~4s.
3. **Confirming → Verified** — once the invoice is paid, it confirms and shows a receipt.

**Simulate payment** (the labelled sandbox button) marks the invoice paid via
`POST /api/sandbox/simulate-payment` — the BMONI sandbox can't receive a real bank
transfer, so this is how the demo completes. It moves no money and is disabled in
production.

### Getting the *real* BMONI account to show (Option B)

The first time you click **Continue to payment**, the app provisions the one merchant BMONI
account (create user → KYC → wallet → Nigeria onboarding → virtual account). This can take
~10–60s and has two common gotchas:

- **`BMONI_MERCHANT_PHONE` must be a made-up phone number nobody has used yet on the shared
  sandbox key.** The key's two built-in test personas have phones already registered by
  other teams (BMONI returns 409), so provisioning needs a spare phone (KYC verifies the
  BVN + name, not the phone). If you see **"Both sandbox test personas are already in
  use"**, change the phone to a fresh random number (e.g. `+2348000073482`), stop the
  server (`Ctrl+C`) and `npm run dev` again.
- **"No virtual account has been issued yet. Try again shortly."** means every step
  succeeded and BMONI just hasn't finished issuing the account. Wait ~1 minute, restart the
  server (to clear a 2-minute back-off timer), and click Continue again — the real
  **PROVIDUS BANK** account then appears (no red banner). Don't delete `data/db.json` or
  change the phone at this point, or you'll start over.

If BMONI can't issue an account, the page shows a **clearly-labelled red placeholder**
("Demo account — not a real account, do not transfer real money"). That is expected and
honest — never present it as a real account.

Deeper BMONI notes, the API contract, and known limitations live in
[`docs/payments/README.md`](./docs/payments/README.md).

---

## Environment variables

All in `.env.local` (gitignored). Full list and comments in [`env.example`](./env.example).

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_API_BASE` | Flask auth/data backend base URL (e.g. `http://127.0.0.1:5000`). Set = real login; blank = mock demo. See [Auth](#auth--run-against-the-flask-backend). |
| `BMONI_API_KEY` | BMONI sandbox key. Backend only, never sent to the browser. |
| `BMONI_BASE_URL` | `https://embedded-dev.bmoni.com`. The client refuses any other host. |
| `BMONI_MERCHANT_PHONE` | Optional spare phone for merchant provisioning on the shared key (see above). Defaults to the persona phone. |
| `DEMO_FALLBACK_ACCOUNT` | `true` shows a labelled placeholder account if BMONI can't issue a real one (so the demo still runs). Ignored in production. |
| `ALLOW_SIMULATE_PAYMENT` | Enables the sandbox "Simulate payment" button. Off in production. |
| `CRON_SECRET` | Protects `POST /api/jobs/daily` (invoice expiry + reminders). |
| `BMONI_WEBHOOK_SECRET` / `APP_PUBLIC_URL` | Only needed for real BMONI webhooks (a public HTTPS URL). |

---

## Project structure

```
app/                     Next.js App Router
  page.tsx               Landing page
  pay/                   Bank-transfer checkout (/pay)
  opportunities/ campaigns/ results/ connections/
  onboarding/ welcome/ analysing/ campaign-draft/ signup/ login/
  api/                   Backend routes (subscribe, invoices, sandbox, plans, signup,
                         contact, webhooks/bmoni, jobs/daily)
components/
  ds/                    Design-system primitives (Button, Card, Icons, Wordmark, …)
  app/                   Dashboard screens (incl. Payment.tsx) + shell
  landing/               Landing sections
lib/
  billing/               Plans, pricing, invoices, merchant provisioning, reconcile, store
  bmoni/                 BMONI API client, wallet signing, webhook verification, personas
  demo-user.ts           Single source for the demo user (name/email/business); real auth
                         swaps in here later
docs/
  payments/README.md     BMONI integration deep-dive, API contract, limitations
  UI-SPEC.md, GROVILLE-DESIGN-SYSTEM-STATES.md, *-reference.html
data/db.json             Local JSON store (gitignored; created at runtime)
env.example              Environment variable reference
AGENTS.md                Project rules, design tokens, honesty boundary
```

---

## Notes

- **Sandbox only.** No real money and no real personal data. BMONI confirmed no production
  key is available during the hackathon.
- **Auth.** Real email/password auth runs against the Flask backend when
  `NEXT_PUBLIC_API_BASE` is set (see [Auth](#auth--run-against-the-flask-backend)); with it
  blank the app uses the mock demo user from `lib/demo-user.ts`. The current user is resolved
  in one place — `lib/use-user.ts` — which reads Flask `/api/auth/me`, falling back to
  Supabase (kept only as a demo fallback) and then the demo user.
- **Design rules, tokens, and the honesty boundary** are documented in
  [`AGENTS.md`](./AGENTS.md).
