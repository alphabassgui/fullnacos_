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
};

/**
 * Low-level fetch: prefixes the base URL, always sends the session cookie, and
 * parses the JSON body defensively. Throws only when no base is configured —
 * callers gate on isFlaskConfigured() first, so that never happens in practice.
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const base = getApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_API_BASE is not configured");

  const hasBody = init.body != null;
  const res = await fetch(base + path, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

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
 * found" means not connected. There is also no disconnect endpoint, so the UI
 * offers none. Honesty boundary: connecting only LINKS the account; nothing is
 * published or run without an explicit approve elsewhere in the app.
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
