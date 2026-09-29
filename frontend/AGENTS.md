<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Groville frontend — project rules

## Project
Groville is an AI growth agent for Nigerian SMEs. It reads a business's website + Google Search
Console, names the single biggest customer/search gap, drafts a campaign (SEO article + social
posts), routes per channel, measures and learns. The owner approves everything.
HONESTY BOUNDARY (never break): the MVP DRAFTS only. Never say/build "auto-send" or
"auto-publish". Always "Groville drafts, you approve".
NAMING: the backend/README is branded "Blom"; the product/frontend is "Groville". Same app, the
API works the same. Use Groville in all UI. (Confirm final brand with the owner.)
This repo = the Next.js FRONTEND. Backend is a separate Flask app (see Backend integration).

## Stack & commands
- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Framer Motion. npm.
- Dev: `npm run dev` (localhost:3000). Build: `npm run build`. Lint: `npm run lint`.
- Frontend env in `.env.local` (gitignored). e.g. NEXT_PUBLIC_API_BASE=http://127.0.0.1:5000

## Design tokens (single source of truth — do NOT invent colors)
DARK (primary/home, "Signal Blue"): canvas #04060F (landing)/#031130 (dashboards) · text #F3F7FE
· secondary #AEBBD4 · muted #7C8BA8 · surface #0A1A3A/#0F2145 · border #1B2C50 · primary #185DF1
(off-white labels) · small blue text #5B8CF0 · success #2FBF71 · error #E5484D.
LIGHT (WARM cream, never cool/stark white): base #F6F1E8 · bands #FFFFFF/#F0E9DC · card #FFFFFF
· border #D8CFBD (visible)/strong #C7BCA5 · text #1B1A17 · secondary #64748B · muted #948E83
· accent #185DF1 (blue lives in CONTENT, not background) · small blue text #1747C7 · success
#17935A · warm shadows rgba(60,48,30,…) · NO blue blooms in light.
Type: Space Grotesk (display + ALL numbers), General Sans (body), Instrument Serif italic for
exactly ONE accent word per heading. Sentence case. No em dashes in UI copy. 8px grid.

## Conventions (non-negotiable)
- Buttons: mobile = full pill (999px); desktop = rounded rectangle (~10px).
- GLASS (backdrop-blur) = marketing/landing ONLY, NEVER on dashboards (flat solid surfaces).
- First-person agent voice ("I found 3 gaps"), opportunity-first. Keep honesty boundary.
- Both themes first-class, dark default. Respect prefers-reduced-motion. Small scoped tasks only.

## Backend integration (from Felix's README — this is the API contract)
- Backend = Flask, repo github.com/Genruyosai-Yamamoto/ai-marketing, runs at http://127.0.0.1:5000.
- AUTH = session COOKIE (HttpOnly, SameSite=Lax). Every fetch to the API must send
  `credentials: 'include'`. CORS is configured on the backend.
- The analyze pipeline is ASYNC (Celery). Pattern: trigger → poll.
- Key endpoints:
  Auth:    POST /api/auth/register · POST /api/auth/login · POST /api/auth/logout · GET /api/auth/me
  Business:POST /api/business · PATCH /api/business/<id> · DELETE /api/business/<id>
  Analyze: POST /api/business/<id>/analyze  → 202 {run_id, task_id}; then poll
           GET /api/business/<id>/runs/latest  (status: analysis running → done)
  Opps:    GET /api/business/<id>/opportunities · GET /.../opportunities/<opp_id>
  Actions: GET /api/business/<id>/actions?status= · GET /.../actions/<id>
           POST /.../actions/<id>/approve  → queues execution · POST /.../actions/<id>/reject
  Exec:    GET /api/business/<id>/executions/<exec_id>  (poll: queued → running → completed|failed)
  Metrics: GET /api/business/<id>/measurements · GET /api/business/<id>/learnings
  GitHub:  GET /api/connections/github/connect · /callback · /repositories · PATCH /repository
  IG:      GET /api/connections/instagram · /callback · /status
- Action lifecycle to reflect in UI: pending_approval → approved → running → completed|failed.
  Nothing executes without an explicit approve call (this is the honesty boundary in the data).
- Do NOT reimplement backend logic in the frontend; only call these endpoints.

## Current phase
Landing built (dark + warm light). NOW = DASHBOARDS pass, code-first, using installed skills
(impeccable-design-taste, emil-kowalski-motion, brand-guidelines-auditor, frontend-design-testing)
+ OpenDesign live preview. Screens: Opportunities (anchor), Campaign draft, Analysing, Results,
Campaigns, Connections, Onboarding (6 steps), Welcome, Sign up / Log in, Product tour.
Demo loop: scan → sign up → welcome → onboarding → analysing → opportunities → draft → approve →
results. Dashboards use DARK dashboard tokens + flat surfaces (no glass).

## Locked demo numbers (identical everywhere)
Demo business: Ada's Bakery, Yaba, Lagos. bakery near me 880/mo rank 34th (+265) · cake delivery
lagos 320/mo rank 18th · wedding cake tasting 140/mo unranked · shipped +410 clicks rank 18→9 ·
Yaba +182 · search clicks 1,284 (+12%) · clicks lost 412 (−38%) · This week: gaps 3, drafts 7,
reply rate 18.4% · Pricing: Scan ₦0/$0, Growth ₦30,000/$59, Studio ₦90,000/$149 (annual −20%).

## Working rules for the agent
- One component/screen per task. After changes: `npm run lint` and `npm run build`.
- Keep components in components/, routes in app/. Don't edit generated files.
- Match tokens above; if a value isn't defined, ask rather than invent.S
