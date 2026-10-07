"use client";

/**
 * RequireAuth / RequireGuest — bidirectional client-side route guards.
 *
 * Both read the single shared { user, loading, status } from AuthProvider, so they
 * never fetch themselves and client navigation between guarded routes doesn't
 * re-flash the loader. While the session is resolving they render <AppLoader/> —
 * never the guarded UI — so there is no flash of unauthenticated content and no
 * hydration mismatch (the loading state is identical on server and client).
 *
 * DEMO SAFETY: when Flask is not configured (isFlaskConfigured() === false) both
 * guards no-op and render children, preserving the mock demo loop. Gate is on the
 * API base, never NODE_ENV.
 *
 * Redirects always use router.replace (never push) so guards don't pollute history.
 * The intended path is read from window.location at redirect time (matching the
 * repo's existing login/signup pages, which deliberately avoid useSearchParams to
 * stay out of a Suspense CSR-bailout at build time).
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { isFlaskConfigured } from "@/lib/api";
import { safeInternalPath } from "@/lib/redirect";
import { AppLoader } from "./AppLoader";

/**
 * Gate a PROTECTED route. Guests (a definite 401/403) are sent to
 * /login?callbackUrl=<current path+query>. On an "unknown" result (backend
 * unreachable) we render children rather than eject a possibly-real user.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const configured = isFlaskConfigured();

  const redirect = configured && !loading && status === "unauthenticated";

  useEffect(() => {
    if (!redirect) return;
    const intended = window.location.pathname + window.location.search;
    router.replace(`/login?callbackUrl=${encodeURIComponent(intended)}`);
    // pathname is a dependency so a client navigation into another protected
    // route re-evaluates the intended target.
  }, [redirect, pathname, router]);

  // Demo mode: nothing to gate.
  if (!configured) return <>{children}</>;
  // Verifying, or a guest we're about to bounce: never flash the protected UI.
  if (loading || status === "unauthenticated") return <AppLoader />;
  // Authenticated, or "unknown" (don't bounce on a transient backend error).
  return <>{children}</>;
}

/**
 * Gate a GUEST-ONLY route (/login, /signup). An already-authenticated visitor is
 * sent to the sanitized ?callbackUrl or /opportunities. The redirect fires only on
 * the FIRST resolution of the session check, so a user who logs in while on the
 * page is navigated by the auth screen itself (to /welcome, /pay, …) without this
 * guard racing it to /opportunities.
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { loading, status, user } = useAuth();
  const router = useRouter();
  const configured = isFlaskConfigured();
  const decidedRef = useRef(false);

  const authed = status === "authenticated" && !!user;

  useEffect(() => {
    if (!configured || loading) return;
    if (decidedRef.current) return;
    decidedRef.current = true;
    if (!authed) return;
    let dest = "/opportunities";
    try {
      const raw = new URLSearchParams(window.location.search).get("callbackUrl");
      dest = safeInternalPath(raw, "/opportunities");
    } catch {
      // window unavailable / malformed query: keep the default.
    }
    router.replace(dest);
  }, [configured, loading, authed, router]);

  // Demo mode: nothing to gate.
  if (!configured) return <>{children}</>;
  // Verifying, or an authed visitor we're redirecting away: don't flash the form.
  if (loading || authed) return <AppLoader />;
  // Unauthenticated or "unknown": show the auth screen.
  return <>{children}</>;
}
