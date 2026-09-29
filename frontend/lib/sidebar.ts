import { useSyncExternalStore } from "react";

/**
 * Persistence + store for the dashboard sidebar collapse state. Mirrors
 * `lib/tour.ts`: a tiny external store consumed via `useSyncExternalStore`, so
 * the server always renders expanded and the client reconciles to the persisted
 * value after hydration (no mismatch). localStorage access is try/catch-wrapped
 * and never throws, degrading gracefully under SSR / private mode / blocked
 * storage.
 */

/** localStorage flag: "1" when the desktop rail is collapsed to the icon-only width. */
export const SIDEBAR_COLLAPSED_KEY = "gv-sidebar-collapsed";

/** Read the persisted flag. Never throws (defaults to expanded). */
export function getSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    // Storage unavailable (private mode, blocked, SSR) — default to expanded.
    return false;
  }
}

/** Persist the collapse flag. Never throws. */
export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // no-op when storage is unavailable
  }
}

// In-memory store: null until first hydrated from localStorage on the client.
let collapsed: boolean | null = null;
const listeners = new Set<() => void>();

function ensureHydrated(): void {
  if (collapsed === null) collapsed = getSidebarCollapsed();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  ensureHydrated();
  return collapsed as boolean;
}

// Server render (and first client render): the rail is always expanded, so the
// SSR HTML matches the initial client HTML; the persisted value is adopted after
// hydration via a store update.
function getServerSnapshot(): boolean {
  return false;
}

/** Flip the collapse state, persist it, and notify subscribers. */
export function toggleSidebarCollapsed(): void {
  ensureHydrated();
  collapsed = !collapsed;
  setSidebarCollapsed(collapsed);
  for (const l of listeners) l();
}

/** React binding for the sidebar collapse store. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
