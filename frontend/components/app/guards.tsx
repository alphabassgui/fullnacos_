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
import {
  isInternalPath,
  onboardedOptimistic,
  postAuthDest,
  serverOnboarded,
} from "@/lib/redirect";
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
 * sent to an explicit, sanitized ?callbackUrl if present, otherwise to the
 * onboarding-aware default (postAuthDest): /opportunities when finished, /welcome
 * when still in setup. The redirect fires only on the FIRST resolution of the
 * session check, so a user who logs in while on the page is navigated by the auth
 * screen itself (to /welcome, /pay, …) without this guard racing it.
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
    let raw: string | null = null;
    try {
      raw = new URLSearchParams(window.location.search).get("callbackUrl");
    } catch {
      // window unavailable / malformed query: fall through to the default.
    }
    const dest = isInternalPath(raw) ? raw : postAuthDest(onboardedOptimistic(user));
    router.replace(dest);
  }, [configured, loading, authed, user, router]);

  // Demo mode: nothing to gate.
  if (!configured) return <>{children}</>;
  // Verifying, or an authed visitor we're redirecting away: don't flash the form.
  if (loading || authed) return <AppLoader />;
  // Unauthenticated or "unknown": show the auth screen.
  return <>{children}</>;
}

/**
 * Gate the onboarding sequence by onboarding status, keyed on the single invariant:
 * a not-yet-onboarded authed user belongs in welcome → onboarding → analysing; a
 * finished user belongs on /opportunities. Applied via the per-segment layouts,
 * nested inside RequireAuth, so it only runs once the session is resolved and
 * authenticated ("unknown"/"unauthenticated" are left to RequireAuth — never
 * bounce on a transient backend error).
 *
 * The destination gate (requirement="onboarded", on /opportunities) reads the
 * OPTIMISTIC view (server flag OR the local cache markOnboarded() sets at finish())
 * so a user who just completed setup is not bounced back before the server flag
 * catches up. The sequence gate (requirement="not-onboarded") reads the SERVER flag
 * only, because that cache is set mid-sequence (at finish(), before /analysing) and
 * must not eject a user who still needs to pass through the scan. Both route through
 * the same postAuthDest direction rule, so the layers cannot disagree — and because
 * each gate only ever says "stay" for the page the user is actually on, no pair of
 * gates can bounce a user back and forth (loop-free).
 *
 * DEMO SAFETY: when Flask is not configured both no-op and render children, exactly
 * like RequireAuth/RequireGuest.
 */
function OnboardingGate({
  children,
  requirement,
}: {
  children: ReactNode;
  requirement: "onboarded" | "not-onboarded";
}) {
  const { loading, status, user } = useAuth();
  const router = useRouter();
  const configured = isFlaskConfigured();
  const decidedRef = useRef(false);

  // Only decide on a RESOLVED, authenticated session.
  const resolved = configured && !loading && status === "authenticated" && !!user;
  const onboarded =
    requirement === "onboarded" ? onboardedOptimistic(user) : serverOnboarded(user);
  const belongs = requirement === "onboarded" ? onboarded : !onboarded;

  useEffect(() => {
    if (!resolved) return;
    if (decidedRef.current) return;
    decidedRef.current = true;
    if (belongs) return;
    router.replace(postAuthDest(onboarded));
  }, [resolved, belongs, onboarded, router]);

  // Demo mode: nothing to gate.
  if (!configured) return <>{children}</>;
  // Verifying, or a guest RequireAuth is about to bounce: never flash the gated UI.
  if (loading || status === "unauthenticated") return <AppLoader />;
  // Authenticated but on the wrong side of the gate: show the loader until we replace.
  if (resolved && !belongs) return <AppLoader />;
  // Belongs here, or "unknown" (don't bounce on a transient backend error).
  return <>{children}</>;
}

/** Protect a finished-user route (/opportunities): a not-yet-onboarded user is sent to /welcome. */
export function RequireOnboarded({ children }: { children: ReactNode }) {
  return <OnboardingGate requirement="onboarded">{children}</OnboardingGate>;
}

/** Protect a sequence route (welcome/onboarding/analysing): a finished user is sent to /opportunities. */
export function RequireNotOnboarded({ children }: { children: ReactNode }) {
  return <OnboardingGate requirement="not-onboarded">{children}</OnboardingGate>;
}
