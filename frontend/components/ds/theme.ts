/**
 * Theme resolution shared by the no-flash boot script (app/layout.tsx) and the
 * theme-owning components (Mode, MobileNav). They must agree so React's first
 * client render matches the DOM the boot script produced.
 *
 * Resolution order (identical to the boot script): ?theme -> localStorage -> OS
 * preference, falling back to dark.
 */
export type Theme = "light" | "dark";

export function resolveTheme(): Theme {
  try {
    const q = new URLSearchParams(window.location.search).get("theme");
    const stored = q || localStorage.getItem("groville-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Set the theme on <html>. Re-applied on mount so React Strict Mode's dev remount,
 *  which clears script-set attributes, doesn't drop the theme. `persist` writes the
 *  user's explicit choice; the mount re-apply passes false so OS defaults aren't locked in. */
export function applyTheme(t: Theme, persist = false) {
  try {
    document.documentElement.setAttribute("data-theme", t);
    if (persist) localStorage.setItem("groville-theme", t);
  } catch {}
}
