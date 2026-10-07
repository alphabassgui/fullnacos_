/**
 * The authenticated areas of the app used by the server-side Supabase gate
 * (lib/supabase/middleware.ts). The client-side Flask path gates via the
 * RequireAuth route guards (components/app/guards.tsx), wired per segment layout.
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
