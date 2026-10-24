/**
 * Safe internal redirect targets.
 *
 * The pricing → auth → checkout funnel carries the intended destination as a
 * `callbackUrl` query param through /login and /signup. Only same-origin,
 * relative paths are ever honored: a value must start with a single "/" (not
 * "//" or "/\", which browsers treat as protocol-relative and resolve to
 * another origin). This keeps a crafted `?callbackUrl=https://evil.example`
 * from turning a login into an open redirect. Anything else falls back to the
 * caller's default.
 */

import type { FlaskUser } from "./api";
import { hasCompletedOnboarding } from "./onboarding";

/** True when `value` is a safe, same-origin, relative path (e.g. "/pay?tier=growth"). */
export function isInternalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

/** The value when it is a safe internal path, otherwise the fallback. */
export function safeInternalPath(value: unknown, fallback: string): string {
  return isInternalPath(value) ? value : fallback;
}

/**
 * Onboarding-aware destinations.
 *
 * A not-yet-onboarded authenticated user belongs in the welcome → onboarding →
 * analysing sequence; a finished user belongs on /opportunities.
 * `has_completed_onboarding` is the decider. The direction rule (`postAuthDest`)
 * is the SINGLE source both the login/guest redirects and the route gates route
 * through, so they can never disagree on where a given state should land.
 */

export const DEST_ONBOARDED = "/opportunities";
export const DEST_SEQUENCE = "/welcome";

/** Source of truth: the backend user field from GET /api/auth/me. */
export function serverOnboarded(user: FlaskUser | null | undefined): boolean {
  return !!user?.has_completed_onboarding;
}

/**
 * Optimistic in-session view: the server flag OR the local cache that
 * `markOnboarded()` sets synchronously (before the fire-and-forget backend write
 * and the next /api/auth/me land). Used only to decide whether someone may STAY
 * on /opportunities, so a user who just finished the form is not bounced back and
 * trapped before the server flag catches up.
 */
export function onboardedOptimistic(user: FlaskUser | null | undefined): boolean {
  return serverOnboarded(user) || hasCompletedOnboarding();
}

/** The one post-auth direction rule, shared by the login redirects and the gates. */
export function postAuthDest(onboarded: boolean): string {
  return onboarded ? DEST_ONBOARDED : DEST_SEQUENCE;
}
