/**
 * Flask API client — the ONE seam for talking to the real Groville backend
 * (Felix's Flask app, see AGENTS.md "Backend integration").
 *
 * Auth is a session COOKIE (HttpOnly, set by Flask on login), so every call
 * MUST send `credentials: 'include'`; this module is the single place that
 * guarantees it. The base URL comes from NEXT_PUBLIC_API_BASE and is never
 * hardcoded.
 *
 * BUILD/DEMO SAFETY: when NEXT_PUBLIC_API_BASE is absent (e.g. the cloud CI,
 * which has no env, or a local mock demo run) isFlaskConfigured() returns false
 * and callers fall back to the existing Supabase/demo behavior. Nothing here
 * runs at import time, so a build with no env never crashes.
 *
 * Supabase tokens are NEVER sent here — Flask has its own email/password auth.
 */

/** The Flask base URL, or null when not configured (demo mode). Trailing slash stripped. */
export function getApiBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

/** True only when a Flask base URL is configured. Real auth is enabled iff this is true. */
export function isFlaskConfigured(): boolean {
  return getApiBase() !== null;
}

/** The parsed `{success, error, ...}` envelope Flask returns, plus any extra fields. */
type ApiData = { success?: boolean; error?: string; [key: string]: unknown } | null;

/** A uniform result: transport-level ok/status plus the parsed JSON body (or null). */
export type ApiResult = { ok: boolean; status: number; data: ApiData };

/** The signed-in user shape from GET /api/auth/me. */
export type FlaskUser = {
  id: string;
  username: string;
  email: string;
  role?: string;
  status?: string;
  /** Source of truth for the one-time product tour (set by POST /api/auth/tour/complete). */
  has_completed_tour?: boolean;
  /** Source of truth for onboarding completion (set by POST /api/auth/onboarding/complete,
   *  or derived server-side from a business with a completed analysis run). Drives
   *  post-payment routing so an existing user is never re-sent through the funnel. */
  has_completed_onboarding?: boolean;
};

/**
 * Low-level fetch: prefixes the base URL, always sends the session cookie, and
 * parses the JSON body defensively. Throws only when no base is configured —
 * callers gate on isFlaskConfigured() first, so that never happens in practice.
 *
 * A timeout (default 60s, generous enough for a Render free-tier cold start)
 * bounds the request via AbortController so a hung backend can never stall a
 * caller forever; on abort it throws a timeout error, which fetchMe()'s catch
 * turns into { state: "unknown" }. Callers may override timeoutMs.
 */
async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 60000): Promise<ApiResult> {
  if (!getApiBase()) throw new Error("NEXT_PUBLIC_API_BASE is not configured");

  const hasBody = init.body != null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    // Route through the Next.js rewrite proxy so the session cookie is
    // first-party (same origin) and never blocked by Safari ITP / Firefox ETP.
    // The rewrite in next.config.ts forwards /api/backend/* → NEXT_PUBLIC_API_BASE/*.
    res = await fetch("/api/backend" + path, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error("Request timed out after " + timeoutMs + "ms");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let data: ApiData = null;
  try {
    data = (await res.json()) as ApiData;
  } catch {
    // Some responses (or network hiccups) may have no JSON body; leave data null.
  }

  return { ok: res.ok, status: res.status, data };
}

/** POST /api/auth/register → 201 {success, user_id}. Register does NOT log in. */
export function register(body: { username: string; email: string; password: string }): Promise<ApiResult> {
  return apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
}

/** POST /api/auth/login → 200 {success, user_id, email, role} and sets the session cookie. */
export function login(body: { email: string; password: string }): Promise<ApiResult> {
  return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
}

/** POST /api/auth/logout. Best-effort: swallow transport errors so logout always proceeds. */
export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Network error — the caller still routes to /login regardless.
  }
}

/**
 * The three distinguishable outcomes of a session check:
 *  - authenticated:   a real user came back.
 *  - unauthenticated: the server answered "no session" (401/403) — safe to redirect.
 *  - unknown:         network/CORS error or an unexpected shape — do NOT bounce the
 *                     user on this, or a transient hiccup logs them out.
 */
export type MeResult =
  | { state: "authenticated"; user: FlaskUser }
  | { state: "unauthenticated" }
  | { state: "unknown" };

/** GET /api/auth/me, keeping "not logged in" distinct from "couldn't reach the backend". */
export async function fetchMe(): Promise<MeResult> {
  try {
    const { ok, status, data } = await apiFetch("/api/auth/me");
    if (ok) {
      const user = data && typeof data === "object" ? (data as { user?: FlaskUser }).user : null;
      return user ? { state: "authenticated", user } : { state: "unknown" };
    }
    if (status === 401 || status === 403) return { state: "unauthenticated" };
    return { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

/** GET /api/auth/me → the signed-in user, or null when not authenticated / unreachable. */
export async function getMe(): Promise<FlaskUser | null> {
  const result = await fetchMe();
  return result.state === "authenticated" ? result.user : null;
}

/**
 * POST /api/auth/tour/complete → 200 {success}. Marks the one-time product tour
 * finished for the signed-in user (completed OR skipped). Idempotent. Returns the
 * raw ApiResult so the caller can tell a real 200 from a 401/transport failure and
 * decide whether to queue a retry.
 */
export function completeTour(): Promise<ApiResult> {
  return apiFetch("/api/auth/tour/complete", { method: "POST" });
}

/**
 * POST /api/auth/onboarding/complete → 200 {success}. Marks onboarding finished
 * for the signed-in user. Idempotent. Returns the raw ApiResult so the caller can
 * tell a real 200 from a 401/transport failure and decide whether to queue a retry.
 */
export function completeOnboarding(): Promise<ApiResult> {
  return apiFetch("/api/auth/onboarding/complete", { method: "POST" });
}

/**
 * A business record as Flask returns it. Optional/nullable fields mirror the
 * contract: only `name` is guaranteed; the rest may be null when the owner
 * omitted them.
 */
export type FlaskBusiness = {
  id: string;
  owner_id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * POST /api/business → 201 {success, business:{...}}. Only `name` is required;
 * send `website_url` only when it is a valid URL (Flask validates it server-side)
 * and omit any other empty field. Returns the raw ApiResult so callers can surface
 * a 400 (missing name / invalid URL) or 401 inline.
 */
export function createBusiness(body: {
  name: string;
  website_url?: string;
  industry?: string;
  description?: string;
}): Promise<ApiResult> {
  return apiFetch("/api/business", { method: "POST", body: JSON.stringify(body) });
}

/** GET /api/business → 200 {success, businesses:[...]} — the logged-in user's businesses. */
export function listBusinesses(): Promise<ApiResult> {
  return apiFetch("/api/business");
}

/**
 * PATCH /api/business/<id> → 200 {success, business:{...}}. Partial update; send only
 * the fields to change. Used by the Opportunities recovery flow to attach a `website_url`
 * to an existing business (one created during onboarding but never given a site), so the
 * analyze run can be triggered. Flask validates `website_url` server-side and 400s an
 * invalid URL; the raw ApiResult is returned so the caller can surface that inline.
 */
export function updateBusiness(
  id: string,
  body: { website_url?: string; name?: string; industry?: string; description?: string },
): Promise<ApiResult> {
  return apiFetch(`/api/business/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

/* ── Analyze pipeline ─────────────────────────────────────────────────────
 * The pipeline is ASYNC (Celery): trigger → poll. `analyzeBusiness` kicks off a
 * run; `getLatestRun` is polled until the run finishes; `getOpportunities`
 * reads the qualitative findings. All go through apiFetch, so the session
 * cookie is always sent. These are the only new endpoints for this slice.
 * ------------------------------------------------------------------------- */

/**
 * A single opportunity as Flask returns it — purely QUALITATIVE. There is no
 * keyword / search-volume / rank / clicks data in this shape; the UI renders
 * only these fields.
 *   - problem_key: a machine category (e.g. "social_proof") the UI humanizes.
 *   - potential_impact: "high" | "medium" | "low" (used to rank + badge).
 */
export type FlaskOpportunity = {
  id: string;
  title: string;
  description: string;
  problem: string;
  problem_key: string;
  potential_impact: string;
  evidence: string[];
};

/**
 * An analyze run as GET /runs/latest returns it (under `{run}`). Only `run_id`
 * and `status` are dependable; the rest arrive as the run progresses:
 *   - opportunity_ids populates when findings are ready.
 *   - completed_at is set once the run finishes (success path).
 *   - error carries a failure message.
 */
export type FlaskRun = {
  run_id: string;
  status: string;
  opportunity_ids?: string[] | null;
  error?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

/** The three terminal readings of a run — see runOutcome(). */
export type RunOutcome = "complete" | "failed" | "pending";

/**
 * Classify a run (or a missing run) into complete / failed / pending.
 *
 * COMPLETE when the run has a completion timestamp, OR it has produced
 * opportunity_ids, OR its status reads as finished. FAILURE when status is
 * "failed" or an error message is present. Otherwise keep polling.
 *
 * NOTE: the exact terminal status string ("done" vs "completed" vs "succeeded")
 * should be confirmed against a real run; we accept all three, and also treat a
 * populated opportunity_ids / completed_at as complete, so a rename on the
 * backend does not strand the poller.
 */
export function runOutcome(run: FlaskRun | null): RunOutcome {
  if (!run) return "pending";

  const status = typeof run.status === "string" ? run.status.trim().toLowerCase() : "";
  if (status === "failed" || (typeof run.error === "string" && run.error.trim() !== "")) {
    return "failed";
  }

  const hasOpportunities = Array.isArray(run.opportunity_ids) && run.opportunity_ids.length > 0;
  const finishedStatus = status === "done" || status === "completed" || status === "succeeded";
  if (run.completed_at != null || hasOpportunities || finishedStatus) {
    return "complete";
  }

  return "pending";
}

/**
 * POST /api/business/<id>/analyze → 202 {run_id, task_id, status:"queued"}.
 * 400 when the business has no website_url; 403/404/503 otherwise. Returns the
 * raw ApiResult so the caller can branch on status (e.g. 400 → onboarding CTA).
 */
export function analyzeBusiness(id: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${id}/analyze`, { method: "POST" });
}

/** GET /api/business/<id>/runs/latest → {run: {...} | null}. Polled until terminal. */
export function getLatestRun(id: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${id}/runs/latest`);
}

/** GET /api/business/<id>/opportunities → {opportunities: [...]}. */
export function getOpportunities(id: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${id}/opportunities`);
}

/* ── Actions & execution ───────────────────────────────────────────────────
 * During the analyze run the backend auto-generates one drafted ACTION per
 * opportunity (status "pending_approval"). The campaign-draft screen shows that
 * action and enforces the honesty boundary: nothing runs until the owner calls
 * approve, which queues an async (Celery) execution the UI then polls. All go
 * through apiFetch, so the session cookie is always sent.
 * ------------------------------------------------------------------------- */

/**
 * A drafted action as Flask returns it — from the decision engine. It links to
 * its parent opportunity via `opportunity_id`, and `status` moves through the
 * lifecycle pending_approval → approved → running → completed | failed | rejected.
 *   - action_type: website | github | content | seo | social | email | research | other.
 *   - expected_outcome: signals to MONITOR, never a promised result.
 *   - required_inputs: things needed before it can run (may be empty).
 *   - confidence: 0.0–1.0 (how sure this is the right move).
 * Extra fields are tolerated so a backend addition never strands the parser.
 */
export type FlaskAction = {
  id: string;
  action_title: string;
  action_type: string;
  reasoning: string;
  expected_outcome: string;
  required_inputs: string[];
  confidence: number;
  opportunity_id: string;
  status: string;
  [key: string]: unknown;
};

/**
 * An execution as GET /executions/<id> returns it (under `{execution}`). Only
 * `id` and `status` are dependable; `status` advances queued → running →
 * completed | failed, and `error` carries a failure message when it fails.
 */
export type FlaskExecution = {
  id: string;
  status: string;
  error?: string | null;
  [key: string]: unknown;
};

/** The three terminal readings of an execution — see executionOutcome(). */
export type ExecutionOutcome = "completed" | "failed" | "pending";

/**
 * Classify an execution (or a missing one) into completed / failed / pending.
 * "completed" is success, "failed" is failure; anything else keeps polling.
 */
export function executionOutcome(exec: FlaskExecution | null): ExecutionOutcome {
  if (!exec) return "pending";
  const status = typeof exec.status === "string" ? exec.status.trim().toLowerCase() : "";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

/**
 * GET /api/business/<id>/actions (optional ?status=) → {actions:[...]}.
 * The campaign-draft screen fetches BROADLY (no status filter) then branches on
 * the selected action's own status, because after approval the status changes.
 */
export function listActions(businessId: string, status?: string): Promise<ApiResult> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/api/business/${businessId}/actions${query}`);
}

/** GET /api/business/<id>/actions/<actionId> → {action:{...}}. */
export function getAction(businessId: string, actionId: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${businessId}/actions/${actionId}`);
}

/**
 * POST /api/business/<id>/actions/<actionId>/approve → 202
 * {action_id, execution_id, task_id, status:"approved", next_phase:"execution",
 * already_approved}. Queues the Celery execution. `already_approved:true` still
 * returns the existing execution_id. A 500 (approved but couldn't queue) still
 * includes action_id + execution_id. Returns the raw ApiResult so the caller can
 * branch on status and read execution_id off either path.
 */
export function approveAction(businessId: string, actionId: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${businessId}/actions/${actionId}/approve`, { method: "POST" });
}

/** POST /api/business/<id>/actions/<actionId>/reject → sets the action rejected. */
export function rejectAction(businessId: string, actionId: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${businessId}/actions/${actionId}/reject`, { method: "POST" });
}

/** GET /api/business/<id>/executions/<executionId> → {execution:{...}}. Polled until terminal. */
export function getExecution(businessId: string, executionId: string): Promise<ApiResult> {
  return apiFetch(`/api/business/${businessId}/executions/${executionId}`);
}

/* ── Measurements & learnings ───────────────────────────────────────────────
 * After an approved action's execution completes, the backend MEASURES what it
 * earned (real signals from the connected sources) and derives LEARNINGS from
 * those measurements. The Results screen reads both to close the loop. All go
 * through apiFetch, so the session cookie is always sent.
 *
 * Honesty boundary: these are measured signals only — never a promised result.
 * The UI reports exactly what came back and shows a graceful empty state when a
 * dry-run / website execution produced nothing to measure yet.
 * ------------------------------------------------------------------------- */

/**
 * A single measurement as GET /measurements returns it. Every figure the Results
 * screen shows comes from these fields — nothing is derived or invented:
 *   - metric: the human-readable name of what was measured.
 *   - value: the current reading.
 *   - previous_value: the prior reading, or null on the first measurement.
 *   - source: where the number came from (e.g. "Google Analytics").
 * Extra fields are tolerated so a backend addition never strands the parser.
 */
export type FlaskMeasurement = {
  id: string;
  execution_id: string;
  action_id: string;
  metric: string;
  value: number;
  previous_value: number | null;
  source: string;
  measured_at: string;
  [key: string]: unknown;
};

/**
 * A single learning as GET /learnings returns it — the agent's read of what a
 * measurement means. `measurement_id` links it back to the measurement it came
 * from (the Results screen joins on this, falling back to `metric`):
 *   - direction: increase | decrease | unchanged.
 *   - outcome: positive | negative | neutral (the backend may also send
 *     success | failure | measured; the UI maps those onto the same three).
 *   - confidence: 0.0–1.0 (rendered as a High / Medium / Low label).
 *   - learning / observation: the insight and the evidence behind it.
 * Extra fields are tolerated so a backend addition never strands the parser.
 */
export type FlaskLearning = {
  id: string;
  execution_id: string;
  action_id: string;
  action_type: string;
  measurement_id: string;
  learning_type: string;
  metric: string;
  previous_value: number | null;
  value: number;
  direction: string;
  observation: string;
  outcome: string;
  learning: string;
  confidence: number;
  created_at: string;
  [key: string]: unknown;
};

/**
 * GET /api/business/<id>/measurements (optional ?execution_id= / ?metric=) →
 * {measurements:[...]}. Filters are appended as an encoded query string.
 */
export function getMeasurements(
  businessId: string,
  opts?: { executionId?: string; metric?: string },
): Promise<ApiResult> {
  const params = new URLSearchParams();
  if (opts?.executionId) params.set("execution_id", opts.executionId);
  if (opts?.metric) params.set("metric", opts.metric);
  const query = params.toString();
  return apiFetch(`/api/business/${businessId}/measurements${query ? `?${query}` : ""}`);
}

/**
 * GET /api/business/<id>/learnings (optional ?execution_id= / ?outcome=) →
 * {learnings:[...]}. Filters are appended as an encoded query string.
 */
export function getLearnings(
  businessId: string,
  opts?: { executionId?: string; outcome?: string },
): Promise<ApiResult> {
  const params = new URLSearchParams();
  if (opts?.executionId) params.set("execution_id", opts.executionId);
  if (opts?.outcome) params.set("outcome", opts.outcome);
  const query = params.toString();
  return apiFetch(`/api/business/${businessId}/learnings${query ? `?${query}` : ""}`);
}

/* ── GitHub connection ─────────────────────────────────────────────────────
 * Linking a business to a GitHub account, and picking which repository Groville
 * may read. All cookie-auth, so they go through apiFetch (credentials:'include').
 * There is NO /status route: the caller derives connected-ness from
 * githubRepositories() — 200 means connected, a 404 "GitHub connection not
 * found" means not connected. There IS a disconnect endpoint
 * (DELETE /connection, see githubDisconnect), which the UI exposes behind a
 * confirm step; a 404 there means the connection was already gone. Honesty
 * boundary: connecting only LINKS the account; nothing is published or run
 * without an explicit approve elsewhere in the app.
 * ------------------------------------------------------------------------- */

/**
 * A GitHub repository as GET /repositories returns it (inside `repositories`).
 * `full_name` ("owner/repo") is what PATCH /repository expects; `name` is the
 * short label shown to the owner; `private` drives the lock badge.
 */
export type FlaskGithubRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
};

/**
 * GET /api/connections/github/connect?business_id=<id> → 200
 * {success, authorization_url}. The caller reads authorization_url and does a
 * full-page redirect (window.location.href) to start the OAuth flow. 401 auth;
 * 400 when business_id is missing. Returns the raw ApiResult so the caller can
 * branch on status.
 */
export function githubConnect(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/github/connect?business_id=${encodeURIComponent(businessId)}`);
}

/**
 * GET /api/connections/github/repositories?business_id=<id> → 200
 * {success, repositories:[...]}. Doubles as the STATUS check: 404
 * {error:"GitHub connection not found"} means NOT connected, 401 means not
 * authenticated. Returns the raw ApiResult so the caller can tell 404 (not
 * connected) apart from 401 (login) and other errors.
 */
export function githubRepositories(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/github/repositories?business_id=${encodeURIComponent(businessId)}`);
}

/**
 * PATCH /api/connections/github/repository?business_id=<id> with
 * {repository:"<full_name>"} → 200 {success, repository, default_branch}. Sets
 * which repo Groville reads. 400/403/404/500 on error. Returns the raw
 * ApiResult so the caller can surface a failure inline.
 */
export function githubSetRepository(businessId: string, fullName: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/github/repository?business_id=${encodeURIComponent(businessId)}`, {
    method: "PATCH",
    body: JSON.stringify({ repository: fullName }),
  });
}

/**
 * DELETE /api/connections/github/connection?business_id=<id> → 200
 * {success:true} on removal; 404 {success:false, error:"GitHub connection not
 * found"} when nothing was connected; 401 when not authenticated; 400/403/500
 * otherwise. Returns the raw ApiResult so the caller can treat 200 and
 * 404-already-gone alike (both leave GitHub unlinked) and surface any other
 * status as a generic error.
 */
export function githubDisconnect(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/github/connection?business_id=${encodeURIComponent(businessId)}`, {
    method: "DELETE",
  });
}

/* ── Google Search Console connection ───────────────────────────────────────
 * Linking a business to Google Search Console, picking which property Groville
 * may read, and reading back that property's recent search analytics. All
 * cookie-auth, so they go through apiFetch (credentials:'include'). Like GitHub
 * there is NO /status route: the caller derives connected-ness from
 * searchConsoleProperties() — 200 means connected, a 404 "Google Search Console
 * not connected" means not connected. Honesty boundary: connecting only lets me
 * READ Search Console data to display it; it does not make the audit smarter and
 * nothing is sent, published or run on its own.
 * ------------------------------------------------------------------------- */

/**
 * A Search Console property as GET /properties returns it (inside `properties`).
 * `site_url` is the property identifier POST /select-property expects;
 * `permission_level` (e.g. "siteOwner", "siteFullUser") is shown to the owner.
 */
export type FlaskSearchConsoleProperty = { site_url: string; permission_level: string };

/**
 * One analytics row as GET /analytics returns it (inside `top_queries` /
 * `top_pages`). `keys[0]` is the query or page; `ctr` is a 0–1 ratio and
 * `position` the average rank. Totals share the same numeric shape.
 */
export type FlaskSearchConsoleRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

/**
 * GET /api/connections/search-console/connect?business_id=<id> → 200
 * {success, authorization_url}. The caller reads authorization_url and does a
 * full-page redirect (window.location.href) to start the OAuth flow. 401 auth;
 * 400 when business_id is missing; 403 not owner; 404 business not found.
 * Returns the raw ApiResult so the caller can branch on status.
 */
export function searchConsoleConnect(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/search-console/connect?business_id=${encodeURIComponent(businessId)}`);
}

/**
 * GET /api/connections/search-console/properties?business_id=<id> → 200
 * {success, properties:[{site_url, permission_level}, ...]}. Doubles as the
 * STATUS check: 404 {error:"Google Search Console not connected"} means NOT
 * connected, 401 means not authenticated. Returns the raw ApiResult so the
 * caller can tell 404 (not connected) apart from 401 (login) and other errors.
 */
export function searchConsoleProperties(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/search-console/properties?business_id=${encodeURIComponent(businessId)}`);
}

/**
 * POST /api/connections/search-console/select-property with
 * {business_id, site_url} → 200 {success, message, site_url}. Sets which
 * property Groville reads. 400 missing field; 404 not connected; 403 property
 * not accessible. Returns the raw ApiResult so the caller can surface a failure
 * inline.
 */
export function searchConsoleSelectProperty(businessId: string, siteUrl: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/search-console/select-property`, {
    method: "POST",
    body: JSON.stringify({ business_id: businessId, site_url: siteUrl }),
  });
}

/**
 * GET /api/connections/search-console/analytics?business_id=<id> → 200
 * {success, site_url, start_date, end_date, top_queries:[row...],
 * top_pages:[row...], totals:{clicks,impressions,ctr,position}, rows_returned}.
 * The window is the last 28 complete days (ends today−3). 400 when no property
 * is selected yet; 404 not connected; 403; 500. Returns the raw ApiResult so
 * the caller can render read-only Search Console data and degrade gracefully.
 */
export function searchConsoleAnalytics(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/search-console/analytics?business_id=${encodeURIComponent(businessId)}`);
}

/**
 * DELETE /api/connections/search-console/connection?business_id=<id> → 200
 * {success:true} on removal; 404 {success:false, error:"Google Search Console not
 * connected"} when nothing was connected; 401 when not authenticated; 400/403/500
 * otherwise. Returns the raw ApiResult so the caller can treat 200 and 404
 * (already gone) alike (both leave GSC unlinked) and surface any other status as error.
 */
export function searchConsoleDisconnect(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/connections/search-console/connection?business_id=${encodeURIComponent(businessId)}`, {
    method: "DELETE",
  });
}

/* ── GTM / PixelRAG ──────────────────────────────────────────────────────────
 * The go-to-market audit (PixelRAG): the backend screenshots the business's site
 * and its competitors, scores the go-to-market surface, names the blind spots, and
 * drafts a GTM dossier. It is ASYNC (~90s): trigger → poll, like the analyze
 * pipeline. All JSON calls go through apiFetch (credentials:'include'); the dossier
 * is the one exception — it returns text/markdown, so it has its own small fetch.
 *
 * Honesty boundary: the dossier is a DRAFT recommendation the owner reads and acts
 * on. Nothing here is sent, published or executed on its own.
 * ------------------------------------------------------------------------- */

/**
 * One screenshot tile in a site's manifest.
 *  - `url`: the durable Supabase public URL for the tile, when storage is
 *    configured. Absent/null on older runs or when storage is off.
 *  - `path`: a RELATIVE string like
 *    "static/tiles/<biz>/<run>/user_site/tile_0001_hero.webp", served off the
 *    backend's ephemeral local disk.
 * The UI prefers `url` when present, else builds an image src from `path` as
 * `/api/backend/${path}` (the Next rewrite proxies it to the backend).
 */
export type GtmTile = {
  index: number;
  filename: string;
  path: string;
  url?: string;
  scroll_top: number;
  scroll_bottom: number;
  width: number;
  height: number;
};

/**
 * A GTM run as GET /runs/<id> returns it (under `{run}`). Only `id` and `status`
 * are dependable; the rest arrive as the run progresses. Verified against the
 * backend task.py: competitors_analyzed[] carries domain, url, manifest.tiles and
 * (for runs created after the competitor-insights deploy) strengths/weaknesses —
 * both default to [] and older runs omit them, so the UI treats them as optional.
 * A completed run can still come back with empty tiles / flat scores (a browser/OOM
 * or vision soft-fail), so the UI degrades gracefully rather than assuming these
 * fields are populated.
 */
export type FlaskGtmRun = {
  id: string;
  business_id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  completed_at?: string;
  website_url?: string | null;
  gtm_scores?: {
    overall: number;
    above_the_fold: number;
    pricing_clarity: number;
    social_proof: number;
    cro_friction: number;
  };
  blind_spots?: string[];
  competitors_analyzed?: Array<{
    domain: string;
    url: string;
    manifest?: { tiles?: GtmTile[] };
    strengths?: string[];
    weaknesses?: string[];
  }>;
  user_manifest?: { url?: string; page_height?: number; tiles?: GtmTile[] };
  opportunities_created_count?: number;
  dossier_path?: string;
  error?: string;
};

/**
 * POST /api/gtm/run with {business_id} → 202 {success, message, run_id}. 400 when
 * the business has no website; 401/403/404 otherwise. Returns the raw ApiResult so
 * the caller can read run_id off the 202 and branch on error status.
 */
export function gtmRun(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/gtm/run`, { method: "POST", body: JSON.stringify({ business_id: businessId }) });
}

/** GET /api/gtm/runs?business_id=<id> → 200 {success, runs:[...]} — the business's GTM runs. */
export function gtmListRuns(businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/gtm/runs?business_id=${encodeURIComponent(businessId)}`);
}

/**
 * GET /api/gtm/runs/<runId>?business_id=<id> → 200 {success, run:{...}}. Polled
 * until terminal. The business_id query param is REQUIRED — run_id alone 400s.
 */
export function gtmGetRun(runId: string, businessId: string): Promise<ApiResult> {
  return apiFetch(`/api/gtm/runs/${encodeURIComponent(runId)}?business_id=${encodeURIComponent(businessId)}`);
}

/** The result of the dossier fetch — a plain text/markdown body, never JSON. */
export type DossierResult = { ok: boolean; status: number; text: string };

/**
 * GET /api/gtm/runs/<runId>/dossier?business_id=<id> → 200 text/markdown (NOT JSON).
 * This intentionally bypasses apiFetch's JSON parse: it routes through the same
 * "/api/backend" rewrite proxy (so the session cookie stays first-party), sends
 * credentials, bounds the request with an AbortController, and reads the body as
 * text. Transport failures / timeouts resolve to { ok:false } so the caller can
 * degrade gracefully rather than throw.
 */
export async function gtmGetDossier(runId: string, businessId: string, timeoutMs = 60000): Promise<DossierResult> {
  if (!getApiBase()) throw new Error("NEXT_PUBLIC_API_BASE is not configured");

  const path = `/api/gtm/runs/${encodeURIComponent(runId)}/dossier?business_id=${encodeURIComponent(businessId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/backend" + path, { credentials: "include", signal: controller.signal });
    let text = "";
    try {
      text = await res.text();
    } catch {
      // Body read failed (network hiccup / abort mid-stream); leave text empty.
    }
    return { ok: res.ok, status: res.status, text };
  } catch {
    // Transport error or timeout — the caller surfaces a graceful empty state.
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}
