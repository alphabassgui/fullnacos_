"use client";

/**
 * useAuthGate — client-side route gating for the real (Flask) auth path.
 *
 * The Flask session cookie is HttpOnly and set on the backend's own origin, so
 * the Next.js server never sees it — server-side gating (lib/supabase/middleware.ts)
 * only works for Supabase. When Flask is configured we therefore gate on the
 * client: ask GET /api/auth/me and, if it comes back 401 (null user), send the
 * visitor to /login.
 *
 * DEMO SAFETY: when NEXT_PUBLIC_API_BASE is absent this is a no-op, so the mock
 * demo loop is never blocked. It also only acts on the shared PROTECTED_PREFIXES,
 * so public screens in the flow (e.g. /welcome, /onboarding, /analysing) are
 * left alone even if they render inside the dashboard shell.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchMe, isFlaskConfigured } from "./api";
import { isProtectedPath } from "./protected-routes";

export function useAuthGate(): void {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Demo mode, or a public route: nothing to gate.
    if (!isFlaskConfigured()) return;
    if (!pathname || !isProtectedPath(pathname)) return;

    let active = true;
    fetchMe().then((result) => {
      if (!active) return;
      // Only redirect on a definite "not logged in" (401/403). On an "unknown"
      // result (backend unreachable / CORS), stay put rather than bouncing the
      // user out on a transient error — a real 401 still gates.
      if (result.state === "unauthenticated") {
        // Preserve where the user was headed (e.g. /pay?tier=growth) so login
        // can send them back there instead of the default dashboard.
        const intended = window.location.pathname + window.location.search;
        router.replace(`/login?callbackUrl=${encodeURIComponent(intended)}`);
      } else if (result.state === "unknown") {
        console.warn("[auth] Could not verify session against the backend; staying on the page.");
      }
    });

    return () => {
      active = false;
    };
  }, [pathname, router]);
}
