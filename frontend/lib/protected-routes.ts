/**
 * The authenticated areas of the app, in one place so both the server-side
 * Supabase gate (lib/supabase/middleware.ts) and the client-side Flask gate
 * (lib/use-auth-gate.ts) agree on exactly which routes are protected.
 *
 * Server-safe: no client-only imports, so the Supabase proxy can use it too.
 */

/** Route prefixes that require a signed-in user. Unauthenticated hits go to /login. */
export const PROTECTED_PREFIXES = [
  "/pay",
  "/opportunities",
  "/campaigns",
  "/results",
  "/connections",
  "/campaign-draft",
] as const;

/** True when the pathname is (or is under) a protected prefix. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
