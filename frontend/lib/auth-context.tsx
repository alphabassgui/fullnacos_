"use client";

/**
 * AuthProvider — the single source of client-side auth state for the real (Flask)
 * auth path. The Flask session cookie is HttpOnly and set on the backend's own
 * origin (SameSite=None), so the Next.js server never sees it and JS on the Vercel
 * origin cannot read it. We therefore resolve auth on the client by asking
 * GET /api/auth/me once (via the existing apiFetch, which keeps credentials:'include'
 * and its 60s AbortController timeout) and sharing the result through context.
 *
 * The result is cached for the lifetime of the provider, so client-side navigation
 * between guarded routes never re-fetches or re-flashes the loader — only a hard
 * refresh / direct address-bar hit pays the cost. `refresh()` re-validates on
 * demand (after login, sign-up, or logout) so the guards never act on stale state.
 *
 * DEMO SAFETY: when NEXT_PUBLIC_API_BASE is absent (isFlaskConfigured() === false)
 * the provider does not fetch — status is "disabled" and loading is false — so the
 * route guards no-op and the mock demo loop is never blocked. The gate is on the
 * API base, never NODE_ENV.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe, isFlaskConfigured, type FlaskUser } from "./api";

export type AuthStatus = "authenticated" | "unauthenticated" | "unknown" | "disabled";

export type AuthContextValue = {
  /** The signed-in user, or null when not authenticated / not yet resolved. */
  user: FlaskUser | null;
  /** True until the first /api/auth/me check resolves. Guards must gate on this. */
  loading: boolean;
  /** The resolved session state. "unknown" = backend unreachable (do NOT bounce). */
  status: AuthStatus;
  /** Re-run the session check and update state. Awaitable. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Deterministic from a build-time-inlined env var, so it is identical on the
  // server and the client — no hydration mismatch from the initial state.
  const configured = isFlaskConfigured();

  const [user, setUser] = useState<FlaskUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(configured ? "unknown" : "disabled");
  const [loading, setLoading] = useState<boolean>(configured);

  const refresh = useCallback(async () => {
    if (!isFlaskConfigured()) {
      setUser(null);
      setStatus("disabled");
      setLoading(false);
      return;
    }
    const result = await fetchMe();
    if (result.state === "authenticated") {
      setUser(result.user);
      setStatus("authenticated");
    } else if (result.state === "unauthenticated") {
      setUser(null);
      setStatus("unauthenticated");
    } else {
      // Backend unreachable / CORS / unexpected shape: leave no user, but mark
      // "unknown" so guards render children instead of bouncing a real user out
      // on a transient error (e.g. a Render cold start that timed out).
      setUser(null);
      setStatus("unknown");
    }
    setLoading(false);
  }, []);

  // Resolve the session once on mount (configured mode only). The provider lives
  // at the root and effectively never unmounts; the active flag guards the edge.
  const ranRef = useRef(false);
  useEffect(() => {
    // Demo mode: initial state is already { loading: false, status: "disabled" },
    // so there is nothing to resolve.
    if (!configured) return;
    if (ranRef.current) return;
    ranRef.current = true;
    void refresh();
  }, [configured, refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, status, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Read the shared auth state. Must be called inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
