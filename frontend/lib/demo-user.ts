/**
 * Demo user data layer (the fallback identity).
 *
 * Real email/password auth is wired via Supabase (see lib/supabase/*), but the
 * demo loop must keep running when no Supabase keys are configured. This module
 * holds the mock owner — Ada Osei of Ada's Bakery, the business behind the locked
 * demo numbers (see components/landing/VoiceCarousel.tsx) — used as that fallback.
 *
 * The ONE place that resolves the CURRENT user for the UI is useUser()
 * (lib/use-user.ts): it returns the real signed-in Supabase user when auth is
 * configured, and otherwise falls back to getDemoUser() below. Screens (Welcome,
 * /pay checkout) read through useUser(), never a hardcoded name, so the display
 * name and prefill stay in one seam. getDemoUser() / welcomeGreeting() keep their
 * shape so the fallback path is unchanged.
 *
 * (Separate future task: connecting the Supabase user to the teammate's Flask
 * agent API via its session cookie — not done here.)
 */

import { useSyncExternalStore } from "react";

export type DemoUser = {
  /** The user's name for greetings; null when we don't have one yet. */
  name: string | null;
  /** Work email, used to prefill checkout; null when unknown. */
  email?: string | null;
  /** Business name, used to prefill checkout; null when unknown. */
  businessName?: string | null;
};

/** The mock owner behind the locked demo numbers. Referentially stable so it can
 *  serve as the external store's server/fallback snapshot without re-render loops. */
const DEMO_FALLBACK: DemoUser = { name: "Ada", email: "ada@adasbakery.com", businessName: "Ada's Bakery" };

/** The mock signed-up user for the demo loop. First name only, for a natural greeting.
 *  Returns a fresh copy so callers can never mutate the shared fallback. */
export function getDemoUser(): DemoUser {
  return { ...DEMO_FALLBACK };
}

/**
 * Persisted demo identity (demo mode only) — a tiny external store over
 * localStorage, mirroring lib/sidebar.ts and lib/tour.ts.
 *
 * In demo mode there is no backend, so the Auth screen has nowhere to send what
 * the user types. We stash it in localStorage here so useUser() can surface the
 * real typed name / business / email in the account card, avatar and greeting,
 * instead of the hardcoded "Ada" mock. Consumed via useSyncExternalStore so the
 * server always renders the stable fallback and the client reconciles to the
 * persisted value after hydration (no mismatch, no setState-in-effect). Every
 * storage access is guarded and never throws. The dashboard's opportunity /
 * results numbers are separate locked demo data and are unaffected.
 */
const DEMO_USER_KEY = "groville:demo-user";

// In-memory snapshot: null until first hydrated from localStorage on the client.
// Cached so getSnapshot returns a referentially stable value between renders.
let current: DemoUser | null = null;
const listeners = new Set<() => void>();

/** Read + normalize the persisted identity, or null when unset / unavailable / malformed. */
export function getStoredDemoUser(): DemoUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    // Normalize to the DemoUser shape; treat any non-string field as unknown.
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      email: typeof parsed.email === "string" ? parsed.email : null,
      businessName: typeof parsed.businessName === "string" ? parsed.businessName : null,
    };
  } catch {
    return null;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** Persist the typed demo identity and notify subscribers. Best-effort storage. */
export function saveDemoUser(user: DemoUser): void {
  try {
    window.localStorage.setItem(DEMO_USER_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable (private mode, quota, blocked) — keep the in-memory value.
  }
  current = user;
  emit();
}

/** Forget the persisted demo identity (e.g. on demo logout), reverting to the mock. */
export function clearDemoUser(): void {
  try {
    window.localStorage.removeItem(DEMO_USER_KEY);
  } catch {
    // no-op when storage is unavailable
  }
  current = null; // re-hydrate on next read → falls back to DEMO_FALLBACK
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): DemoUser {
  // Hydrate once from storage; the stable fallback keeps the reference constant.
  if (current === null) current = getStoredDemoUser() ?? DEMO_FALLBACK;
  return current;
}

// Server render (and first client render): the stable mock, so SSR HTML matches
// the initial client HTML; the persisted value is adopted after hydration.
function getServerSnapshot(): DemoUser {
  return DEMO_FALLBACK;
}

/** React binding for the demo identity store. Returns the typed sign-up identity
 *  when one is persisted, otherwise the "Ada" demo mock. */
export function useDemoIdentity(): DemoUser {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Personalized welcome line, with a graceful fallback when no name exists. */
export function welcomeGreeting(user: DemoUser): string {
  return user.name ? `Welcome, ${user.name}` : "Welcome to Groville";
}
