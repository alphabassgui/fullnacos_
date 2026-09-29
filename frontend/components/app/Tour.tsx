"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import {
  TOUR_STEPS,
  canAutoStartTour,
  closeTour,
  markTourSeen,
  nextStep,
  prevStep,
  startTour,
  useTour,
} from "@/lib/tour";

/**
 * Product tour (coach-mark / spotlight overlay). Ported pixel-for-pixel from the
 * decoded Claude Design export in `docs/tour-reference.html`. It renders on top
 * of the existing dashboard screens and anchors tooltips to real elements via
 * their `data-tour="…"` attribute (no brittle class selectors).
 *
 * `<Tour />` mounts once inside `DashboardShell`. It auto-starts once on the
 * first visit to `/opportunities` (gated by localStorage) and otherwise stays
 * dormant until `startTour()` is called (replay entry point).
 */

const CARD_W = 356;
const CARD_H = 250;
const PAD = 10;
const EASE = "cubic-bezier(.4,0,.2,1)";
const NARROW = 900;

// Tokens live on :root / [data-theme] in globals.css; fonts mirror shell.tsx.
const BODY = "var(--font-body)";
const DISPLAY = "var(--font-display)";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Rect = { top: number; left: number; width: number; height: number };

type RectState = { rect: Rect | null; found: boolean; measured: boolean };

/** Locates an anchor by its `data-tour` attribute and tracks its rect.
 *  `found` = the element exists in the DOM; `rect` is null when it is absent
 *  OR positioned off-screen (e.g. inside the collapsed mobile drawer), so those
 *  steps fall back to a pinned, ring-less card. `measured` distinguishes the
 *  pre-measurement first frame from a confirmed-absent anchor, so the graceful
 *  skip never fires on the initial (unmeasured) render. */
function useRect(target: string, deps: unknown[]): RectState {
  const [state, setState] = useState<RectState>({ rect: null, found: false, measured: false });

  // Track the anchor every frame while the step is active. A rAF loop (rather
  // than resize/scroll listeners alone) keeps the spotlight locked on as the
  // mobile drawer slides open on sidebar steps, then settles once still.
  useEffect(() => {
    let raf = 0;
    let prevKey = "";
    const measure = () => {
      const el = document.querySelector<HTMLElement>('[data-tour="' + target + '"]');
      let next: RectState;
      if (!el) {
        next = { rect: null, found: false, measured: true };
      } else {
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const onScreen =
          r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
        next = {
          rect: onScreen
            ? {
                top: Math.round(r.top),
                left: Math.round(r.left),
                width: Math.round(r.width),
                height: Math.round(r.height),
              }
            : null,
          found: true,
          measured: true,
        };
      }
      const key = next.found + "|" + next.measured + "|" + JSON.stringify(next.rect);
      if (key !== prevKey) {
        prevKey = key;
        setState(next);
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

type Placement = {
  style: CSSProperties;
  side: "left" | "top" | "bottom" | null;
  anchorY?: number;
};

/** Places the coach mark beside the spotlit element; on narrow screens it pins to
 *  whichever edge is furthest from the anchor so the lit element is never covered. */
function placeCard(rect: Rect | null, narrow: boolean): Placement {
  if (narrow) {
    const vh = window.innerHeight;
    const low = rect ? rect.top + rect.height / 2 > vh / 2 : false;
    const edge = low ? { top: 16 } : { bottom: 16 };
    return { style: { left: 16, right: 16, ...edge, width: "auto" }, side: null };
  }
  if (!rect)
    return { style: { left: "50%", bottom: 28, transform: "translateX(-50%)", width: CARD_W }, side: null };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 22;
  const clampTop = (t: number) => Math.min(Math.max(16, t), Math.max(16, vh - CARD_H - 16));
  if (rect.left + rect.width + gap + CARD_W + 16 < vw) {
    return {
      style: { left: rect.left + rect.width + gap, top: clampTop(rect.top - 8), width: CARD_W },
      side: "left",
      anchorY: rect.top + rect.height / 2,
    };
  }
  if (rect.top + rect.height + gap + CARD_H < vh) {
    return {
      style: {
        left: Math.min(Math.max(16, rect.left), vw - CARD_W - 16),
        top: rect.top + rect.height + gap,
        width: CARD_W,
      },
      side: "top",
    };
  }
  return {
    style: {
      left: Math.min(Math.max(16, rect.left), vw - CARD_W - 16),
      top: Math.max(16, rect.top - CARD_H - gap),
      width: CARD_W,
    },
    side: "bottom",
  };
}

function Beak({ side, offset }: { side: Placement["side"]; offset: number }) {
  if (!side) return null;
  const base: CSSProperties = {
    position: "absolute",
    width: 14,
    height: 14,
    background: "var(--tour-card)",
    borderTop: "1px solid var(--tour-card-border)",
    borderLeft: "1px solid var(--tour-card-border)",
  };
  const at: Record<Exclude<Placement["side"], null>, CSSProperties> = {
    left: { left: -8, top: offset, transform: "rotate(-45deg)" },
    top: { top: -8, left: 36, transform: "rotate(45deg)" },
    bottom: { bottom: -8, left: 36, transform: "rotate(-135deg)" },
  };
  return <span aria-hidden="true" style={{ ...base, ...at[side] }} />;
}

function Dots({ n, i, reduced }: { n: number; i: number; reduced: boolean }) {
  return (
    <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length: n }, (_, k) => (
        <span
          key={k}
          style={{
            width: k === i ? 18 : 6,
            height: 6,
            borderRadius: 100,
            background: k === i ? "var(--primary)" : "var(--tour-dot)",
            transition: reduced ? "none" : "width .3s " + EASE,
          }}
        />
      ))}
    </span>
  );
}

function TourOverlay({ requestDrawer }: { requestDrawer?: (open: boolean) => void }) {
  const { step } = useTour();
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < NARROW : false,
  );
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Subscribe to viewport width and reduced-motion changes (initial values come
  // from the useState initializers, which read the client environment on mount).
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const onMotion = () => setReduced(prefersReducedMotion());
    mq?.addEventListener("change", onMotion);
    return () => {
      window.removeEventListener("resize", onResize);
      mq?.removeEventListener("change", onMotion);
    };
  }, []);

  // Move focus to the primary control so the tour is keyboard-operable at once.
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  const stop = TOUR_STEPS[step];
  const { rect, found, measured } = useRect(stop.target, [stop.target, narrow]);
  const last = step === TOUR_STEPS.length - 1;

  // Gracefully skip a step whose anchor is confirmed absent from the DOM (e.g.
  // the tour was launched on a screen that lacks it). Only after a real
  // measurement — never on the pre-measurement first frame. Off-screen-but-
  // present anchors keep the step (pinned, ring-less card) — see useRect.
  useEffect(() => {
    if (measured && !found) nextStep();
  }, [measured, found, step]);

  // On mobile the sidebar lives in a collapsed drawer, so its nav anchors are
  // off-screen. For the nav steps, ask the shell to open the drawer so the
  // spotlight has a real, visible target; close it again for the hero step.
  // `requestDrawer` is only supplied by the mobile shell branch — on desktop
  // the sidebar is always visible and this is a no-op.
  const inSidebar = stop.target.startsWith("nav-");
  useEffect(() => {
    requestDrawer?.(inSidebar);
  }, [requestDrawer, inSidebar, step]);
  useEffect(() => {
    return () => requestDrawer?.(false);
  }, [requestDrawer]);

  if (measured && !found) return null;

  const place = placeCard(rect, narrow);
  // On narrow screens the spotlight follows the drawer slide frame-by-frame
  // (rAF), so a CSS transition would only lag behind it.
  const move =
    reduced || narrow
      ? "none"
      : ["top", "left", "width", "height"].map((p) => p + " .42s " + EASE).join(", ");
  const beakOffset =
    place.side === "left" && place.anchorY != null && typeof place.style.top === "number"
      ? Math.min(Math.max(16, place.anchorY - place.style.top - 7), CARD_H - 40)
      : 34;

  const dismiss = () => {
    markTourSeen();
    closeTour();
  };

  return (
    // Above the mobile nav drawer (z-index 41) so, on the sidebar steps, the
    // tooltip and spotlight sit over the freshly opened drawer.
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div
        onClick={dismiss}
        style={{
          position: "absolute",
          inset: 0,
          background: rect ? "transparent" : "var(--tour-scrim)",
        }}
      />
      {rect && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            pointerEvents: "none",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: stop.radius + PAD,
            transition: move,
            boxShadow:
              "0 0 0 9999px var(--tour-scrim), 0 0 0 2px var(--primary), 0 0 34px rgba(24,93,241,.45)",
          }}
        />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick tour"
        style={{
          position: "absolute",
          ...place.style,
          background: "var(--tour-card)",
          border: "1px solid var(--tour-card-border)",
          borderRadius: 16,
          boxShadow: "var(--tour-card-shadow)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          transition: reduced
            ? "none"
            : ["top", "left", "bottom"].map((p) => p + " .42s " + EASE).join(", "),
        }}
      >
        <Beak side={place.side} offset={beakOffset} />
        <span
          style={{
            fontFamily: BODY,
            fontSize: 12,
            lineHeight: "16px",
            letterSpacing: "0.02em",
            color: "var(--tour-label)",
          }}
        >
          Quick tour
        </span>
        <h2
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 19,
            lineHeight: "25px",
            color: "var(--tour-title)",
          }}
        >
          {stop.title}
        </h2>
        <p
          style={{
            margin: 0,
            fontFamily: BODY,
            fontSize: 14,
            lineHeight: "21px",
            color: "var(--tour-body)",
            textWrap: "pretty",
          }}
        >
          {stop.body}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 8,
            paddingTop: 14,
            borderTop: "1px solid var(--tour-card-border)",
            flexWrap: "wrap",
          }}
        >
          <Dots n={TOUR_STEPS.length} i={step} reduced={reduced} />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={dismiss}
              className="gv-tour-focus"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "8px 6px",
                fontFamily: BODY,
                fontSize: 13,
                color: "var(--tour-label)",
              }}
            >
              Skip tour
            </button>
            {step > 0 && (
              <button
                onClick={() => prevStep()}
                className="gv-tour-focus"
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: "1px solid var(--tour-card-border)",
                  background: "transparent",
                  fontFamily: BODY,
                  fontSize: 13,
                  lineHeight: "18px",
                  color: "var(--tour-title)",
                }}
              >
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              onClick={() => nextStep()}
              className="gv-tour-focus"
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: "var(--primary)",
                color: "var(--text-on-primary)",
                fontFamily: BODY,
                fontWeight: 500,
                fontSize: 14,
                lineHeight: "19px",
                whiteSpace: "nowrap",
              }}
            >
              {last ? "Start using Groville" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Tour({ requestDrawer }: { requestDrawer?: (open: boolean) => void } = {}) {
  const { open } = useTour();
  const pathname = usePathname();
  const autoStarted = useRef(false);

  // Auto-start once, only on the first landing on /opportunities.
  useEffect(() => {
    if (autoStarted.current) return;
    if (pathname === "/opportunities" && canAutoStartTour()) {
      autoStarted.current = true;
      startTour();
    }
  }, [pathname]);

  // Esc closes the tour (treated as skip).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markTourSeen();
        closeTour();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return <TourOverlay requestDrawer={requestDrawer} />;
}
