"use client";

/**
 * AppLoader — the full-screen loader the route guards show while GET /api/auth/me
 * is still resolving. It follows the established "Waking things up…" staged pattern
 * (see components/landing/Pricing.tsx): the backend runs on a Render free tier that
 * can cold-start for several seconds, so after ~4s a reassuring label fades in to
 * make a slow wake read as progress rather than a hang.
 *
 * Colours come from the app tokens in globals.css (nothing invented); the spinner
 * slows rather than stops under prefers-reduced-motion.
 */

import { useEffect, useState } from "react";

const LOADER_CSS = `
.gv-app-loader{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--bg);color:var(--text);font-family:var(--font-body)}
.gv-app-loader-spin{width:28px;height:28px;border-radius:999px;border:2px solid var(--border);border-top-color:var(--primary);animation:gv-app-loader-spin .8s linear infinite}
.gv-app-loader-label{font-size:14px;line-height:20px;color:var(--text-secondary)}
.gv-app-loader-sub{font-size:12px;line-height:16px;color:var(--text-muted)}
@media (prefers-reduced-motion:reduce){.gv-app-loader-spin{animation-duration:2.4s}}
@keyframes gv-app-loader-spin{to{transform:rotate(360deg)}}
`;

export function AppLoader() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaking(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="gv-app-loader" role="status" aria-live="polite" aria-busy="true">
      <style href="gv-app-loader" precedence="high">
        {LOADER_CSS}
      </style>
      <span className="gv-app-loader-spin" aria-hidden="true" />
      <span className="gv-app-loader-label">{waking ? "Waking things up…" : "Loading…"}</span>
      {waking && (
        <span className="gv-app-loader-sub">This can take a few seconds on the first visit.</span>
      )}
    </div>
  );
}
