/**
 * Onboarding-completion status.
 *
 * The SOURCE OF TRUTH is the backend user field `has_completed_onboarding`
 * (read via GET /api/auth/me, written via POST /api/auth/onboarding/complete),
 * mirroring the product-tour pattern in lib/tour.ts. localStorage
 * ("groville_onboarded") is only a FAST HYDRATION CACHE + optimistic in-session
 * guard, NOT the source of truth: it lets the post-payment CTA render instantly
 * and keeps same-browser behavior unchanged, but an existing user on a new
 * device / cleared storage / incognito is recognised from the backend instead of
 * being wrongly re-sent through the funnel. In demo mode (no NEXT_PUBLIC_API_BASE)
 * there is no backend, so this cache is the whole story.
 *
 * Every access is wrapped so a blocked or unavailable store (private mode, SSR)
 * never throws.
 */

import { completeOnboarding, isFlaskConfigured } from "@/lib/api";

export const ONBOARDED_KEY = "groville_onboarded";

/** localStorage marker: a backend "onboarding complete" write failed and must be retried. */
export const ONBOARDING_SYNC_PENDING_KEY = "groville_onboarding_sync_pending";

/** True once onboarding has been completed (or skipped) — reads the local cache. Never throws. */
export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // Storage unavailable → treat as "not yet onboarded" (safe default: route
    // through the setup flow rather than skipping it).
    return false;
  }
}

function setSyncPending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(ONBOARDING_SYNC_PENDING_KEY, "1");
    else localStorage.removeItem(ONBOARDING_SYNC_PENDING_KEY);
  } catch {
    // no-op when storage is unavailable
  }
}

function isSyncPending(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SYNC_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Push "onboarding complete" to the backend (the source of truth) with a few
 * bounded retries. On success clears the pending marker; on exhaustion sets it so
 * `maybeSyncPendingOnboarding()` can finish the job on a later load. No-op in demo
 * mode (no backend configured). Gated on NEXT_PUBLIC_API_BASE presence, never
 * NODE_ENV, so local and Vercel behave identically.
 */
async function pushOnboardingComplete(attempt = 0): Promise<void> {
  if (!isFlaskConfigured()) return;
  try {
    const res = await completeOnboarding();
    if (res.ok) {
      setSyncPending(false);
      return;
    }
    // A 401 means no session to write against — nothing to retry here; leave the
    // optimistic local cache in place and let a future authenticated load sync.
    if (res.status === 401 || res.status === 403) {
      setSyncPending(true);
      return;
    }
  } catch {
    // transport error — fall through to retry
  }
  if (attempt < 2) {
    const delay = 500 * Math.pow(2, attempt); // 500ms, 1000ms
    setTimeout(() => void pushOnboardingComplete(attempt + 1), delay);
    return;
  }
  setSyncPending(true);
}

/**
 * Persist that onboarding is complete. Writes the local cache IMMEDIATELY
 * (optimistic — instant CTA render) AND persists to the backend so an existing
 * user is recognised on any device. Safe to call more than once; the backend
 * write is idempotent and no-ops in demo mode. Never throws.
 */
export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // no-op when storage is unavailable
  }
  void pushOnboardingComplete();
}

/**
 * Retry a previously-failed backend "onboarding complete" write. Call on an
 * authenticated load (e.g. the post-payment screen) in Flask mode so a dropped
 * write eventually reaches the DB. No-op when nothing is pending or there is no
 * backend.
 */
export function maybeSyncPendingOnboarding(): void {
  if (!isFlaskConfigured()) return;
  if (!isSyncPending()) return;
  void pushOnboardingComplete();
}
