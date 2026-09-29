/**
 * The execution id for an approved action, cached in localStorage keyed by
 * action id.
 *
 * Approving an action queues a Celery execution and returns its id; the
 * campaign-draft screen polls that execution until it finishes. Persisting the
 * id lets a refresh (or a return to the screen) mid-run resume polling instead
 * of losing track of the live execution.
 *
 * Every access is guarded (no window on the server, private mode / disabled
 * storage can throw) and never throws — callers get null on any failure. Mirrors
 * lib/current-business.ts.
 */

const PREFIX = "groville:execution-id:";

/** The remembered execution id for an action, or null when unset / unavailable. */
export function getExecutionId(actionId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(PREFIX + actionId);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/** Remember the execution id for an action. Best-effort — a storage failure is swallowed. */
export function setExecutionId(actionId: string, executionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + actionId, executionId);
  } catch {
    // Storage unavailable (private mode, quota, blocked) — polling still works this session.
  }
}
