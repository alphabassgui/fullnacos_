/**
 * Onboarding-completion flag.
 *
 * The backend contract (AGENTS.md "Backend integration") exposes no
 * onboarding-status field, so completion is tracked client-side in
 * localStorage, mirroring the tour-seen flag in lib/tour.ts. It drives
 * post-payment routing: a paid user who has not finished onboarding is sent
 * through welcome → onboarding → analysing, while one who has goes straight to
 * the dashboard. Every access is wrapped so a blocked or unavailable store
 * (private mode, SSR) never throws.
 */

export const ONBOARDED_KEY = "groville_onboarded";

/** True once onboarding has been completed (or skipped). Never throws. */
export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // Storage unavailable → treat as "not yet onboarded" (safe default: route
    // through the setup flow rather than skipping it).
    return false;
  }
}

/** Persist that onboarding is complete. Never throws. */
export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // no-op when storage is unavailable
  }
}
