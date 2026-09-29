"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media query hook. Renders the `false` branch on the server and on the
 * first client render (so hydration matches), then adopts the real match after
 * mount — the same pattern the landing's MobileNav uses for theme.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Dashboards switch to their stacked / drawer layout below 768px. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** Honour the OS "reduce motion" setting for the drawer transition. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
