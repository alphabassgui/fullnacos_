"use client";

/**
 * useBusiness — the single central place for the current business, mirroring how
 * useUser (lib/use-user.ts) centralizes the signed-in user. Later phases read the
 * current business_id from here.
 *
 * Like useUser this is a plain hook (no provider): persistence is the Flask session
 * cookie + a refetch of GET /api/business on mount, with lib/current-business.ts
 * caching which business is current across route changes and refreshes.
 *
 * DEMO SAFETY: when NEXT_PUBLIC_API_BASE is absent this never fetches and reports
 * status "demo", so the mock demo loop (which uses hardcoded data) is untouched.
 *
 * Transient-error stance (same as useAuthGate): a non-ok / unreachable list keeps
 * status "loading" — it never flips to "none", so a hiccup never bounces a real user
 * to onboarding.
 */

import { useEffect, useState } from "react";
import { isFlaskConfigured, listBusinesses, type FlaskBusiness } from "./api";
import { getCurrentBusinessId, setCurrentBusinessId } from "./current-business";

export type BusinessStatus = "loading" | "demo" | "none" | "ready";

export type BusinessState = {
  /** loading = resolving; demo = no backend; none = logged in, no business; ready = have one. */
  status: BusinessStatus;
  business: FlaskBusiness | null;
  businessId: string | null;
};

const DEMO_STATE: BusinessState = { status: "demo", business: null, businessId: null };
const LOADING_STATE: BusinessState = { status: "loading", business: null, businessId: null };

export function useBusiness(): BusinessState {
  // No-flash init: demo mode resolves synchronously; Flask mode starts loading.
  const [state, setState] = useState<BusinessState>(() =>
    isFlaskConfigured() ? LOADING_STATE : DEMO_STATE,
  );

  useEffect(() => {
    // Demo mode: nothing to fetch, downstream keeps its mocks.
    if (!isFlaskConfigured()) return;

    let active = true;
    listBusinesses().then((result) => {
      if (!active) return;

      if (!result.ok) {
        // Transient / unauthorized: stay "loading" rather than declaring "none".
        return;
      }

      const businesses =
        result.data && typeof result.data === "object"
          ? (result.data as { businesses?: FlaskBusiness[] }).businesses
          : null;

      if (!Array.isArray(businesses) || businesses.length === 0) {
        setState({ status: "none", business: null, businessId: null });
        return;
      }

      // Prefer the remembered current business; otherwise the first (most recent) one.
      const cachedId = getCurrentBusinessId();
      const current = businesses.find((b) => b.id === cachedId) ?? businesses[0];
      setCurrentBusinessId(current.id);
      setState({ status: "ready", business: current, businessId: current.id });
    });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
