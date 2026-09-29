"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icons, Wordmark } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW } from "./shell";
import { useIsMobile, usePrefersReducedMotion } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import { isFlaskConfigured, analyzeBusiness, getLatestRun, runOutcome, type FlaskRun } from "@/lib/api";

/**
 * Analysing — the "first scan" state in the loop (onboarding → ANALYSING →
 * opportunities). Groville reads the business's site, finds the gaps and drafts
 * the first campaign, then leads into Opportunities.
 *
 * Two modes:
 *  - DEMO (no NEXT_PUBLIC_API_BASE): the trigger→poll is SIMULATED with timers
 *    over the demo facts, then auto-advances to /opportunities. No network.
 *  - FLASK (configured + a current business): the REAL async pipeline —
 *    POST /analyze → 202, then poll GET /runs/latest until it completes — drives
 *    the same progress visuals. On completion it routes to /opportunities; on
 *    failure it shows the run's error with a "Try again"; a business with no
 *    website_url (analyze → 400) gets a CTA back to onboarding.
 *
 * Honesty boundary: Groville reads and drafts. It never publishes or sends on
 * its own — the owner approves everything downstream.
 *
 * Full-screen centered splash (no DashboardShell). It repaints the solid
 * dashboard canvas and suppresses the landing's ambient dark glows itself, so
 * there is no glow bleed and no glass. Both themes first-class; dark default.
 */

const SERIF = "var(--font-serif)";

const NEXT_HREF = "/opportunities";

/** Agent-voice scan steps. Copy stays within Groville's honest scope (read → find →
 *  draft) with no invented metrics. Google Search Console is a later, optional
 *  connection, so it is not part of this first scan. */
const STEPS = [
  "Reading your website",
  "Finding the gaps worth chasing",
  "Drafting your first campaign",
] as const;

const STEP_MS = 1100; // per-step dwell in the animated path (demo)
const DONE_HOLD_MS = 900; // pause on the finished state before auto-advancing (demo)
const POLL_MS = 3500; // real pipeline poll interval

/** Canvas repaint + glow suppression, copied from shell.tsx's DASH_CANVAS_CSS (not exported).
 *  Keeps the landing's tall dark glow pseudo-elements from bleeding into this full-screen state. */
const DASH_CANVAS_CSS = `
html[data-theme="dark"] body::before,
html[data-theme="dark"] body::after,
html[data-theme="dark"]::before,
html[data-theme="dark"] #root::after{content:none!important;display:none!important}
html[data-theme="dark"],html[data-theme="dark"] body{background:#04060F!important}
`;

/** One checklist row: pending (hollow) → active (pulsing) → done (check). */
function StepRow({ label, state }: { label: string; state: "pending" | "active" | "done" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {state === "done" ? (
          <Icons name="check-circle" size={20} style={{ color: C.good }} />
        ) : state === "active" ? (
          <span
            className="gv-pulse"
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 99, background: C.blue, display: "inline-block" }}
          />
        ) : (
          <Icons name="circle" size={20} style={{ color: C.muted }} />
        )}
      </span>
      <span
        style={{
          fontFamily: BODY,
          fontSize: 15,
          lineHeight: "22px",
          color: state === "pending" ? C.muted : C.text,
          transition: "color .3s ease",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** Full-screen centered layout wrapper shared by every Analysing state. */
function Splash({ m, children }: { m: boolean; children: ReactNode }) {
  return (
    <>
      <style href="gv-dash-canvas" precedence="high">
        {DASH_CANVAS_CSS}
      </style>
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "var(--canvas)",
          color: C.text,
          fontFamily: BODY,
          padding: m ? "40px 16px" : "48px 24px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: m ? 24 : 28,
            textAlign: "center",
          }}
        >
          {children}
        </div>
      </main>
    </>
  );
}

/** The scanning / done presentation: wordmark, pulse ring, heading, progress bar,
 *  stepped checklist, honesty note, and a bottom CTA/skip. Purely presentational —
 *  demo and Flask modes both drive it via props. */
function ScanView({
  m,
  reduced,
  done,
  progress,
  completed,
  subtitle,
}: {
  m: boolean;
  reduced: boolean;
  done: boolean;
  progress: number;
  completed: number;
  subtitle: string;
}) {
  const cardPad = m ? 24 : 40;
  const pillRadius = m ? 999 : 10;

  return (
    <Splash m={m}>
      <Wordmark size={24} style={{ color: C.text }} />

      {/* Scan indicator — a pulsing ring around the live dot (static under reduced motion). */}
      <span
        aria-hidden="true"
        style={{ position: "relative", width: 56, height: 56, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        {!reduced && !done && (
          <span
            className="gv-pulse"
            style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--tint, rgba(24,93,241,.16))" }}
          />
        )}
        <span
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 99,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: done ? C.good : C.blue,
            boxShadow: done ? "none" : "var(--shadow-primary-glow)",
            transition: "background .3s ease",
          }}
        >
          <Icons name={done ? "check" : "vital-sign"} size={22} style={{ color: "#fff" }} />
        </span>
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={MONO_EYEBROW}>{done ? "Scan complete" : "Analysing"}</span>
        <h1
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: m ? "clamp(24px, 7vw, 30px)" : 32,
            lineHeight: m ? 1.2 : "40px",
            letterSpacing: "-0.8px",
            color: C.text,
            textWrap: "pretty",
          }}
        >
          {done ? (
            <>
              I found your{" "}
              <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>gaps</em>.
            </>
          ) : (
            <>
              Reading your site and{" "}
              <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>search</em> data.
            </>
          )}
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: C.secondary }}>{subtitle}</p>
      </div>

      {/* Progress bar */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <span
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Analysis progress"
          style={{ display: "block", width: "100%", height: 6, borderRadius: 6, background: C.border, overflow: "hidden" }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: progress + "%",
              borderRadius: 6,
              background: "var(--gradient-primary)",
              transition: reduced ? "none" : "width .5s cubic-bezier(.4,0,.2,1)",
            }}
          />
        </span>
        <span style={{ fontFamily: DISPLAY, fontSize: 12, color: C.muted, alignSelf: "flex-end", fontVariantNumeric: "tabular-nums" }}>
          {progress}%
        </span>
      </div>

      {/* Stepped checklist */}
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: C.s1,
          border: "1px solid " + C.border,
          borderRadius: 16,
          padding: cardPad,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          textAlign: "left",
        }}
      >
        {STEPS.map((label, i) => {
          const state: "pending" | "active" | "done" = i < completed ? "done" : i === completed ? "active" : "pending";
          return <StepRow key={label} label={label} state={state} />;
        })}
      </div>

      {/* Honesty boundary */}
      <p style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: C.muted, maxWidth: 420 }}>
        I only read and draft. Nothing goes live until you approve it. I never publish or send on my own.
      </p>

      {/* On completion: primary CTA appears (auto-advance also fires). Before that, a subtle skip. */}
      {done ? (
        <Link
          href={NEXT_HREF}
          style={
            {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 48,
              padding: "0 22px",
              width: m ? "100%" : undefined,
              borderRadius: pillRadius,
              textDecoration: "none",
              background: C.blue,
              color: "#F3F7FE",
              fontFamily: BODY,
              fontWeight: 500,
              fontSize: 15,
              boxShadow: "0 0 20px rgba(24,93,241,0.35)",
            } as CSSProperties
          }
        >
          See opportunities
          <Icons name="arrow-right" size={16} />
        </Link>
      ) : (
        <Link href={NEXT_HREF} style={{ fontFamily: BODY, fontSize: 13, color: C.muted, textDecoration: "none" }}>
          Skip
        </Link>
      )}
    </Splash>
  );
}

const primaryBtn = (m: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 48,
  padding: "0 22px",
  width: m ? "100%" : undefined,
  borderRadius: m ? 999 : 10,
  border: "none",
  textDecoration: "none",
  background: C.blue,
  color: "#F3F7FE",
  fontFamily: BODY,
  fontWeight: 500,
  fontSize: 15,
  cursor: "pointer",
});

/** A centered message card (failure / no-website) sharing the splash chrome. */
function MessageView({
  m,
  eyebrow,
  heading,
  body,
  action,
}: {
  m: boolean;
  eyebrow: string;
  heading: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <Splash m={m}>
      <Wordmark size={24} style={{ color: C.text }} />
      <span
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: 99,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.s1,
          border: "1px solid " + C.border,
        }}
      >
        <Icons name="alert-triangle" size={24} style={{ color: C.muted }} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={MONO_EYEBROW}>{eyebrow}</span>
        <h1
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: m ? "clamp(24px, 7vw, 30px)" : 32,
            lineHeight: m ? 1.2 : "40px",
            letterSpacing: "-0.8px",
            color: C.text,
            textWrap: "pretty",
          }}
        >
          {heading}
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: C.secondary, maxWidth: 440 }}>{body}</p>
      </div>
      {action}
    </Splash>
  );
}

/** DEMO mode: timer-simulated scan that auto-advances to /opportunities. */
function DemoAnalysing() {
  const m = useIsMobile();
  const reduced = usePrefersReducedMotion();
  const router = useRouter();

  const [completed, setCompleted] = useState(reduced ? STEPS.length : 0);
  const [done, setDone] = useState(reduced);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const ts = timers.current;
    const push = () => router.push(NEXT_HREF);

    if (reduced) {
      ts.push(setTimeout(push, DONE_HOLD_MS));
      return () => ts.forEach(clearTimeout);
    }

    for (let i = 1; i <= STEPS.length; i++) {
      ts.push(setTimeout(() => setCompleted(i), STEP_MS * i));
    }
    ts.push(setTimeout(() => setDone(true), STEP_MS * STEPS.length));
    ts.push(setTimeout(push, STEP_MS * STEPS.length + DONE_HOLD_MS));

    return () => ts.forEach(clearTimeout);
  }, [reduced, router]);

  const progress = done ? 100 : Math.round((completed / STEPS.length) * 100);

  return (
    <ScanView
      m={m}
      reduced={reduced}
      done={done}
      progress={progress}
      completed={completed}
      subtitle="Ada's Bakery · adasbakery.com · Yaba, Lagos"
    />
  );
}

type FlaskPhase = "scanning" | "done" | "failed";

/** FLASK mode: trigger the real pipeline (once), poll it, and drive the visuals. */
function FlaskScan({ businessId, subtitle }: { businessId: string; subtitle: string }) {
  const m = useIsMobile();
  const reduced = usePrefersReducedMotion();
  const router = useRouter();

  const [phase, setPhase] = useState<FlaskPhase>("scanning");
  const [error, setError] = useState<string>("");
  const [noWebsite, setNoWebsite] = useState(false);
  // Synthetic step progression while polling — never reaches the last "done" step
  // until the real run completes, so the visuals track a live run without faking it.
  const [completed, setCompleted] = useState(0);
  // A monotonically increasing token: bumping it restarts the whole trigger→poll flow.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError("");
    setNoWebsite(false);
    setCompleted(0);
    setPhase("scanning");
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let stepTimer: ReturnType<typeof setInterval> | undefined;

    const finishAndRoute = () => {
      if (!active) return;
      setCompleted(STEPS.length);
      setPhase("done");
      // Auto-advance after a short beat; the CTA is also shown.
      pollTimer = setTimeout(() => {
        if (active) router.push(NEXT_HREF);
      }, DONE_HOLD_MS);
    };

    const fail = (message: string) => {
      if (!active) return;
      setError(message || "The scan could not be completed. Please try again.");
      setPhase("failed");
    };

    // Advance the checklist steps on a gentle timer, holding on the last step until
    // the run actually completes (so we never claim "done" before the backend does).
    // Under reduced motion we skip the timer; the shown step count is derived below.
    if (!reduced) {
      stepTimer = setInterval(() => {
        setCompleted((c) => (c < STEPS.length - 1 ? c + 1 : c));
      }, STEP_MS);
    }

    const poll = () => {
      if (!active) return;
      getLatestRun(businessId).then((result) => {
        if (!active) return;
        if (!result.ok) {
          // Transient poll error — keep trying; a real terminal state ends this.
          pollTimer = setTimeout(poll, POLL_MS);
          return;
        }
        const run =
          result.data && typeof result.data === "object"
            ? (result.data as { run?: FlaskRun | null }).run ?? null
            : null;
        const outcome = runOutcome(run);
        if (outcome === "complete") {
          finishAndRoute();
        } else if (outcome === "failed") {
          fail(run?.error ?? "");
        } else {
          pollTimer = setTimeout(poll, POLL_MS);
        }
      });
    };

    // On entry: is a run already in progress? If so, just poll it; if it already
    // finished, route straight through; otherwise start a fresh run.
    getLatestRun(businessId).then((result) => {
      if (!active) return;
      const run =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { run?: FlaskRun | null }).run ?? null
          : null;
      const outcome = runOutcome(run);

      if (outcome === "complete") {
        finishAndRoute();
        return;
      }
      if (run && outcome === "pending") {
        // A run is already going — don't start a second one, just poll.
        pollTimer = setTimeout(poll, POLL_MS);
        return;
      }

      // No run in progress (or the last one failed): start one.
      analyzeBusiness(businessId).then((res) => {
        if (!active) return;
        if (res.status === 202 || res.ok) {
          pollTimer = setTimeout(poll, POLL_MS);
          return;
        }
        if (res.status === 400) {
          setNoWebsite(true);
          setPhase("failed");
          return;
        }
        const msg =
          res.data && typeof res.data === "object" && typeof (res.data as { error?: string }).error === "string"
            ? (res.data as { error?: string }).error
            : "";
        fail(msg ?? "");
      });
    });

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (stepTimer) clearInterval(stepTimer);
    };
  }, [businessId, reduced, router, attempt]);

  if (noWebsite) {
    return (
      <MessageView
        m={m}
        eyebrow="Add your website"
        heading="I need your website first"
        body="I read your public pages to find the gaps worth fixing, so add your website in onboarding and I'll run the scan."
        action={
          <Link href="/onboarding" style={primaryBtn(m)}>
            Back to onboarding
            <Icons name="arrow-right" size={16} />
          </Link>
        }
      />
    );
  }

  if (phase === "failed") {
    return (
      <MessageView
        m={m}
        eyebrow="Scan failed"
        heading="The scan did not finish"
        body={error}
        action={
          <button type="button" onClick={retry} style={primaryBtn(m)}>
            Try again
          </button>
        }
      />
    );
  }

  const done = phase === "done";
  // Under reduced motion the timer is off, so show all but the final step until done.
  const shown = done ? STEPS.length : reduced ? STEPS.length - 1 : completed;
  const progress = done ? 100 : Math.round((shown / STEPS.length) * 100);
  return <ScanView m={m} reduced={reduced} done={done} progress={progress} completed={shown} subtitle={subtitle} />;
}

/** FLASK mode wrapper: resolve the current business, then run the pipeline. */
function FlaskAnalysing() {
  const m = useIsMobile();
  const business = useBusiness();

  if (business.status === "loading") {
    // Business still resolving — show the scan at rest so there is no flash.
    return <ScanView m={m} reduced={false} done={false} progress={0} completed={0} subtitle="Getting your business ready…" />;
  }

  if (business.status === "none" || !business.businessId) {
    return (
      <MessageView
        m={m}
        eyebrow="Add your website"
        heading="I need your website first"
        body="Add your business and website in onboarding, then I'll read your pages and find the gaps worth fixing."
        action={
          <Link href="/onboarding" style={primaryBtn(m)}>
            Back to onboarding
            <Icons name="arrow-right" size={16} />
          </Link>
        }
      />
    );
  }

  const site = business.business?.website_url?.replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? "";
  const subtitle = [business.business?.name, site].filter(Boolean).join(" · ") || "Reading your site.";

  return <FlaskScan businessId={business.businessId} subtitle={subtitle} />;
}

/**
 * Entry point. Flask mode (configured + a current business) runs the real
 * trigger→poll pipeline; otherwise the demo timer simulation keeps the demo loop
 * running. isFlaskConfigured() is stable per session (build-time env), so this
 * render branch never changes hook order.
 */
export function AnalysingScreen() {
  return isFlaskConfigured() ? <FlaskAnalysing /> : <DemoAnalysing />;
}
