/**
 * The current business id, cached in localStorage.
 *
 * The plain useBusiness() hook (like useUser) has no shared in-memory store, so
 * this cache is what carries the selection across the /onboarding → /analysing →
 * /opportunities route change and across a refresh. The Flask business list is the
 * source of truth on load; this only remembers WHICH business is current when the
 * owner has more than one.
 *
 * Every access is guarded (no window on the server, private mode / disabled storage
 * can throw) and never throws — callers get null on any failure.
 */

const KEY = "groville:current-business-id";

/** The remembered current business id, or null when unset / unavailable. */
export function getCurrentBusinessId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/** Remember the current business id. Best-effort — a storage failure is swallowed. */
export function setCurrentBusinessId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Storage unavailable (private mode, quota, blocked) — the list-on-load still resolves current.
  }
}
