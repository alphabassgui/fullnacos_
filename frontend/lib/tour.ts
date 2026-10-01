import { useSyncExternalStore } from "react";

/**
 * Product tour (coach-mark / spotlight overlay) state + step data.
 *
 * Ported from the Claude Design export in `docs/tour-reference.html`
 * (decoded bundler module — the `STOPS` array is the source of truth). The
 * step copy is the trust contract: it is verbatim from the reference and must
 * not gain numbers or claims. The only campaign data allowed is what the
 * reference contains (`bakery near me · 880 · rank 34th`).
 *
 * The store is a tiny external store consumed via `useSyncExternalStore`, so
 * `startTour()` can be called from anywhere (e.g. a future "replay tour" entry
 * point) without threading a provider through the tree.
 */

export type TourStep = {
  /** `data-tour="…"` attribute on the real element this step anchors to. */
  target: string;
  /** Screen the anchor lives on (all five run from `/opportunities`). */
  screen: string;
  /** Corner radius of the spotlight cut-out, matching the anchor's radius. */
  radius: number;
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    target: "gap",
    screen: "/opportunities",
    radius: 16,
    title: "The customer you’re missing",
    body: "I always lead with the single biggest gap, so you know what to chase first. Right now it’s bakery near me · 880 searches a month · you rank 34th.",
  },
  {
    target: "nav-opportunities",
    screen: "/opportunities",
    radius: 8,
    title: "Everything starts here",
    body: "This is where I show you the biggest gaps I find each week, ranked so the one that matters most is first.",
  },
  {
    target: "nav-campaigns",
    screen: "/opportunities",
    radius: 8,
    title: "I draft it, you approve it",
    body: "When I find a gap, I draft the campaign to win it. You review and approve. Nothing goes live without your approval.",
  },
  {
    target: "nav-results",
    screen: "/opportunities",
    radius: 8,
    title: "Then I measure what it earned",
    body: "After you approve, I track what the campaign earned, and I tell you what I learned for next time.",
  },
  {
    target: "nav-connections",
    screen: "/opportunities",
    radius: 8,
    title: "The data I read",
    body: "Everything I’m connected to lives here: your website and Search Console. Read-only, and I never post on my own.",
  },
];

/** localStorage flag so the tour auto-starts only on the first visit. */
export const TOUR_SEEN_KEY = "groville_tour_seen";

/** True once the tour has been completed or skipped. Never throws. */
export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    // Storage unavailable (private mode, blocked, SSR) — treat as unseen but
    // callers gate auto-start on this, so it just means "don't auto-start".
    return false;
  }
}

/** Whether the tour should auto-start: only when storage is readable AND the
 *  tour has not been seen. If storage is unavailable we cannot persist "seen",
 *  so we deliberately do NOT auto-start (it would otherwise reappear forever). */
export function canAutoStartTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

/** Persist that the tour has been seen. Never throws. */
export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // no-op when storage is unavailable
  }
}

type TourState = { open: boolean; step: number };

let state: TourState = { open: false, step: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: Partial<TourState>) {
  state = { ...state, ...next };
  emit();
}

/** Open the tour at the first step. Safe to call from anywhere (replay). */
export function startTour(): void {
  setState({ open: true, step: 0 });
}

/** Close the tour (Skip or the final button). Does not persist on its own. */
export function closeTour(): void {
  setState({ open: false });
}

/**
 * Advance to the next step, or close on the last one.
 *
 * `auto` marks a programmatic advance past a missing anchor (Tour.tsx's graceful
 * skip). When the tour reaches the end purely by auto-skipping, we close WITHOUT
 * marking it seen, so an absent anchor can never silently burn the seen flag —
 * the tour retries on the next visit. A genuine user advance (`auto` false, the
 * default) persists as before.
 */
export function nextStep(auto = false): void {
  if (state.step >= TOUR_STEPS.length - 1) {
    if (!auto) markTourSeen();
    setState({ open: false });
    return;
  }
  setState({ step: state.step + 1 });
}

/** Go back one step (no-op on the first). */
export function prevStep(): void {
  setState({ step: Math.max(0, state.step - 1) });
}

/** Jump directly to a step index (used when skipping an absent anchor). */
export function goToStep(index: number): void {
  setState({ step: Math.min(Math.max(0, index), TOUR_STEPS.length - 1) });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): TourState {
  return state;
}

// Server render: the tour is never open until the client mounts.
const SERVER_STATE: TourState = { open: false, step: 0 };
function getServerSnapshot(): TourState {
  return SERVER_STATE;
}

/** React binding for the tour store. */
export function useTour(): TourState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
