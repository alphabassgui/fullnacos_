"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icons } from "@/components/ds";
import { C, DISPLAY, BODY, DashboardShell, Chip } from "./shell";
import { InfoTip } from "@/components/ui/tooltip";
import { useIsMobile } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import {
  getMeasurements,
  getLearnings,
  type FlaskMeasurement,
  type FlaskLearning,
} from "@/lib/api";
import {
  SUBHEAD_STYLE,
  directionMeta,
  outcomeMeta,
  confidenceOf,
  isFirst,
  fmt,
  matchLearning,
  DEMO_MEASUREMENTS,
  DEMO_LEARNINGS,
} from "./results-data";

/**
 * Results — the payoff that closes the demo loop (analysing → opportunities →
 * draft → approve → RESULTS). It reports on what an approved action actually
 * EARNED, ported pixel-for-pixel from the Claude Design export
 * (docs/results-real-reference.html) and rendered inside the shared
 * DashboardShell.
 *
 * It shows only real measured fields: a metric name, a previous_value → value
 * transition (or "first measurement" when there is no prior value), a direction
 * indicator, an outcome badge, and the agent's learning + observation with a
 * confidence label. No keyword / search-volume / rank / clicks data appears
 * anywhere; every number comes from the data.
 *
 * Data:
 *  - Demo mode (no NEXT_PUBLIC_API_BASE) renders the real-shaped sample set, so
 *    one card design serves both paths and the demo loop still runs.
 *  - Flask mode with a current business fetches GET /measurements + /learnings
 *    and renders the real readings, with loading / error / empty states.
 *
 * Honesty boundary (kept verbatim in copy): I report real signals, never a
 * promised result. Nothing here implies Groville published or sent on its own.
 */

const SERIF = "var(--font-serif)";

/** Where the closing / empty CTAs lead. Both routes already exist. */
const OPPORTUNITIES_HREF = "/opportunities";
const CONNECTIONS_HREF = "/connections";

/** Section eyebrow — Space Grotesk, uppercase, tracked. */
function SubHead({ children }: { children: string }) {
  return <span style={SUBHEAD_STYLE}>{children}</span>;
}

/** Outcome badge — a dot + text label, tinted per outcome (never colour alone). */
function OutcomeBadge({ outcome }: { outcome: string }) {
  const o = outcomeMeta(outcome);
  return (
    <InfoTip style={{ display: "inline-flex" }} tip="My read on how this result landed against what I expected.">
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px",
          borderRadius: 8,
          border: "1px solid " + o.line,
          background: o.fill,
          fontFamily: BODY,
          fontSize: 12,
          lineHeight: "16px",
          color: o.ink,
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 100, background: o.ink }} />
        {o.label}
      </span>
    </InfoTip>
  );
}

/** Direction indicator — a glyph + text label. On a first measurement it reads "First measurement". */
function DirectionTag({ direction, first }: { direction: string; first: boolean }) {
  const d = directionMeta(direction);
  const tip = first
    ? "No earlier reading yet, so this is the baseline I will measure against."
    : "Which way this metric moved since the last reading.";
  return (
    <InfoTip style={{ display: "inline-flex" }} tip={tip}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: BODY,
          fontSize: 12,
          lineHeight: "16px",
          color: C.secondary,
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden="true" style={{ fontFamily: DISPLAY, fontSize: 13 }}>
          {first ? "·" : d.glyph}
        </span>
        {first ? "First measurement" : d.label}
      </span>
    </InfoTip>
  );
}

/** One "What changed" card: metric, prev → current transition, outcome, direction, source line. */
function MeasurementCard({ m, learning }: { m: FlaskMeasurement; learning?: FlaskLearning }) {
  const first = isFirst(m.previous_value);
  return (
    <article
      className="gv-card"
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: "clamp(18px, 2vw, 24px)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <InfoTip style={{ flex: 1, minWidth: 0 }} tip="The signal I tracked for this result, read from your connected data.">
          <span
            style={{
              fontFamily: BODY,
              fontSize: 14,
              lineHeight: "20px",
              color: C.secondary,
              textWrap: "pretty",
            }}
          >
            {m.metric}
          </span>
        </InfoTip>
        {learning && <OutcomeBadge outcome={learning.outcome} />}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        {!first && (
          <>
            <span
              style={{
                fontFamily: DISPLAY,
                fontWeight: 500,
                fontSize: "clamp(20px, 2.2vw, 24px)",
                lineHeight: 1.1,
                color: C.muted,
              }}
            >
              {fmt(m.previous_value)}
            </span>
            <span aria-hidden="true" style={{ fontFamily: DISPLAY, fontSize: 16, color: C.muted }}>
              →
            </span>
          </>
        )}
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: "clamp(30px, 3.6vw, 40px)",
            lineHeight: 1.05,
            letterSpacing: "-1px",
            color: C.text,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmt(m.value)}
        </span>
      </div>

      <DirectionTag direction={learning ? learning.direction : "unchanged"} first={first} />

      <div style={{ height: 1, background: C.border }} />

      <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "17px", color: C.muted, textWrap: "pretty" }}>
        {m.source} · measured {m.measured_at}
      </span>
    </article>
  );
}

/** One "What I learned" card: metric pill + direction + confidence, the learning, and the observation. */
function LearningCard({ l }: { l: FlaskLearning }) {
  const conf = confidenceOf(l.confidence);
  const first = isFirst(l.previous_value);
  return (
    <article
      className="gv-card"
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: "clamp(18px, 2.2vw, 28px)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "5px 10px",
            borderRadius: 8,
            background: C.s2,
            fontFamily: BODY,
            fontSize: 12,
            lineHeight: "16px",
            color: C.muted,
            whiteSpace: "nowrap",
          }}
        >
          {l.metric}
        </span>
        <DirectionTag direction={l.direction} first={first} />
        <InfoTip
          side="left"
          style={{ marginLeft: "auto", display: "inline-flex" }}
          tip="How sure I am of this learning, based on the strength of the data behind it."
        >
          <span
            style={{
              fontFamily: BODY,
              fontSize: 12,
              lineHeight: "16px",
              color: C.secondary,
              whiteSpace: "nowrap",
            }}
          >
            {conf.label} · {conf.pct}%
          </span>
        </InfoTip>
      </div>

      <p
        style={{
          margin: 0,
          maxWidth: 680,
          fontFamily: DISPLAY,
          fontWeight: 500,
          fontSize: "clamp(17px, 1.8vw, 20px)",
          lineHeight: 1.36,
          letterSpacing: "-0.2px",
          color: C.text,
          textWrap: "pretty",
        }}
      >
        {l.learning}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SubHead>What I saw</SubHead>
        <p
          style={{
            margin: 0,
            maxWidth: 680,
            fontFamily: BODY,
            fontSize: 14,
            lineHeight: "21px",
            color: C.secondary,
            textWrap: "pretty",
          }}
        >
          {l.observation}
        </p>
      </div>
    </article>
  );
}

/** Intro heading + honesty subtitle. The serif accent word matches the other dashboards. */
function ResultsHeader() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: DISPLAY,
          fontWeight: 500,
          fontSize: "clamp(20px, 2.2vw, 24px)",
          lineHeight: 1.36,
          letterSpacing: "-0.3px",
          color: C.text,
          textWrap: "pretty",
        }}
      >
        Here&apos;s what your campaign{" "}
        <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400 }}>earned</em>, and what I
        learned.
      </h2>
      <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
        This is what I could actually measure after you approved it. I report real signals, never a promised result.
      </p>
    </div>
  );
}

/** Outlined navigation link (desktop rectangle, full-width pill on mobile per the button rule). */
function OutlineLink({ href, children, m, icon }: { href: string; children: ReactNode; m: boolean; icon?: string }) {
  return (
    <Link
      href={href}
      className="gv-btn gv-btn--outline"
      style={{ ...outlineButton, width: m ? "100%" : undefined, borderRadius: m ? 999 : 8 }}
    >
      {children}
      {icon && <Icons name={icon} size={16} />}
    </Link>
  );
}

/** Primary navigation link. */
function PrimaryLink({ href, children, m, icon }: { href: string; children: ReactNode; m: boolean; icon?: string }) {
  return (
    <Link
      href={href}
      className="gv-btn gv-btn--primary"
      style={{ ...primaryButton, width: m ? "100%" : undefined, borderRadius: m ? 999 : 8 }}
    >
      {children}
      {icon && <Icons name={icon} size={16} />}
    </Link>
  );
}

/** The populated screen: What changed grid → What I learned stack → next-opportunity link. */
function PopulatedResults({
  measurements,
  learnings,
  m,
}: {
  measurements: FlaskMeasurement[];
  learnings: FlaskLearning[];
  m: boolean;
}) {
  return (
    <>
      <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <SubHead>What changed</SubHead>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(248px, 1fr))",
            gap: 16,
            minWidth: 0,
          }}
        >
          {measurements.map((mm) => (
            <MeasurementCard key={mm.id} m={mm} learning={matchLearning(mm, learnings)} />
          ))}
        </div>
      </section>

      {learnings.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <SubHead>What I learned</SubHead>
          {learnings.map((l) => (
            <LearningCard key={l.id} l={l} />
          ))}
        </section>
      )}

      <OutlineLink href={OPPORTUNITIES_HREF} m={m} icon="arrow-right">
        See the next opportunity
      </OutlineLink>
    </>
  );
}

/** A pulsing skeleton bar. Animation is defined once via <style> and respects reduced motion. */
function Bar({ w, h }: { w: number | string; h: number }) {
  return (
    <span
      aria-hidden="true"
      className="gv-skel"
      style={{ display: "block", width: w, maxWidth: "100%", height: h, borderRadius: 6, background: C.s2 }}
    />
  );
}

/** Loading state — skeleton cards mirroring the populated layout. */
function LoadingState() {
  return (
    <>
      <style href="gv-results-skel" precedence="high">{SKEL_CSS}</style>
      <span role="status" style={{ fontFamily: BODY, fontSize: 14, lineHeight: "20px", color: C.secondary }}>
        Reading your measurements. This takes a moment.
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(248px, 1fr))", gap: 16, minWidth: 0 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              background: C.s1,
              border: "1px solid " + C.border,
              borderRadius: 16,
              padding: "clamp(18px, 2vw, 24px)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 0,
            }}
          >
            <Bar w="60%" h={14} />
            <Bar w="45%" h={36} />
            <Bar w={110} h={12} />
            <span style={{ height: 1, background: C.border }} />
            <Bar w="70%" h={12} />
          </div>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            background: C.s1,
            border: "1px solid " + C.border,
            borderRadius: 16,
            padding: "clamp(18px, 2.2vw, 28px)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0,
          }}
        >
          <Bar w={180} h={12} />
          <Bar w="80%" h={20} />
          <Bar w="92%" h={14} />
        </div>
      ))}
    </>
  );
}

/** Error state — honest about showing nothing rather than a number it can't stand behind. */
function ErrorState({ onRetry, m }: { onRetry: () => void; m: boolean }) {
  return (
    <div
      style={{
        background: C.s1,
        border: "1px solid color-mix(in oklab, var(--error) 40%, transparent)",
        borderRadius: 16,
        padding: "clamp(24px, 3vw, 32px)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignItems: "flex-start",
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px",
          borderRadius: 8,
          border: "1px solid color-mix(in oklab, var(--error) 40%, transparent)",
          background: "color-mix(in oklab, var(--error) 12%, transparent)",
          fontFamily: BODY,
          fontSize: 12,
          lineHeight: "16px",
          color: C.bad,
        }}
      >
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 100, background: C.bad }} />
        Could not load
      </span>
      <h3
        style={{
          margin: 0,
          maxWidth: 560,
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: "clamp(20px, 2.2vw, 24px)",
          lineHeight: 1.22,
          letterSpacing: "-0.4px",
          color: C.text,
          textWrap: "pretty",
        }}
      >
        I couldn&apos;t read your measurements.
      </h3>
      <p style={{ margin: 0, maxWidth: 560, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
        The server didn&apos;t answer, so I have nothing to report. I&apos;d rather show you nothing than a number I can&apos;t
        stand behind.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", width: m ? "100%" : undefined }}>
        <button
          type="button"
          onClick={onRetry}
          className="gv-btn gv-btn--primary"
          style={{ ...primaryButton, width: m ? "100%" : undefined, borderRadius: m ? 999 : 8, cursor: "pointer" }}
        >
          Try again
        </button>
        <OutlineLink href={CONNECTIONS_HREF} m={m}>
          Check connections
        </OutlineLink>
      </div>
    </div>
  );
}

/** Empty state — dry-run / website executions may produce no measurements yet. */
function EmptyState({ m }: { m: boolean }) {
  return (
    <div
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: "clamp(24px, 4vw, 48px)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignItems: "flex-start",
        minWidth: 0,
      }}
    >
      <h3
        style={{
          margin: 0,
          maxWidth: 520,
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: "clamp(22px, 2.6vw, 28px)",
          lineHeight: 1.2,
          letterSpacing: "-0.5px",
          color: C.text,
          textWrap: "pretty",
        }}
      >
        No results yet.
      </h3>
      <p style={{ margin: 0, maxWidth: 520, fontFamily: BODY, fontSize: 15, lineHeight: "23px", color: C.secondary, textWrap: "pretty" }}>
        Approve and run a campaign, and I&apos;ll measure what it earned.
      </p>
      <PrimaryLink href={OPPORTUNITIES_HREF} m={m} icon="arrow-right">
        See your opportunities
      </PrimaryLink>
    </div>
  );
}

/** Fetch + render the real measurements + learnings for the current business (Flask mode). */
function RealResults({ businessId }: { businessId: string }) {
  type Fetch =
    | { phase: "loading" }
    | { phase: "error" }
    | { phase: "ready"; measurements: FlaskMeasurement[]; learnings: FlaskLearning[] };

  const m = useIsMobile();
  const [state, setState] = useState<Fetch>({ phase: "loading" });
  // Ignore results from a superseded fetch (business change, or a retry mid-flight).
  const reqId = useRef(0);

  const runFetch = useCallback(() => {
    const id = ++reqId.current;
    Promise.all([getMeasurements(businessId), getLearnings(businessId)]).then(([mRes, lRes]) => {
      if (id !== reqId.current) return;
      const measurements =
        mRes.ok && mRes.data && typeof mRes.data === "object"
          ? (mRes.data as { measurements?: FlaskMeasurement[] }).measurements
          : null;
      const learnings =
        lRes.ok && lRes.data && typeof lRes.data === "object"
          ? (lRes.data as { learnings?: FlaskLearning[] }).learnings
          : null;
      if (!mRes.ok || !lRes.ok || !Array.isArray(measurements) || !Array.isArray(learnings)) {
        setState({ phase: "error" });
        return;
      }
      setState({ phase: "ready", measurements, learnings });
    });
  }, [businessId]);

  // Fetch on mount / business change. State starts "loading"; reqId guards staleness.
  useEffect(() => {
    runFetch();
  }, [runFetch]);

  const retry = useCallback(() => {
    setState({ phase: "loading" });
    runFetch();
  }, [runFetch]);

  let body: ReactNode;
  if (state.phase === "loading") {
    body = <LoadingState />;
  } else if (state.phase === "error") {
    body = <ErrorState onRetry={retry} m={m} />;
  } else if (state.measurements.length === 0) {
    body = <EmptyState m={m} />;
  } else {
    body = <PopulatedResults measurements={state.measurements} learnings={state.learnings} m={m} />;
  }

  return <Board m={m}>{body}</Board>;
}

/** The scrollable board: header always, then the state-specific body. */
function Board({ children, m }: { children: ReactNode; m: boolean }) {
  return (
    <main
      style={{
        flex: 1,
        overflowY: "auto",
        background: C.bg,
        padding: m ? "24px 16px 40px" : "clamp(20px, 3vw, 32px)",
        display: "flex",
        flexDirection: "column",
        gap: 32,
        minWidth: 0,
      }}
    >
      <ResultsHeader />
      {children}
    </main>
  );
}

/**
 * Full Results screen inside the shared dashboard shell.
 *
 * Demo mode (no NEXT_PUBLIC_API_BASE) renders the real-shaped sample so the demo
 * loop still runs. A signed-in Flask user with a business fetches and renders
 * the real readings; one with no business (or none measured yet) sees the empty
 * state rather than a redirect.
 */
export function ResultsScreen() {
  const business = useBusiness();
  const m = useIsMobile();

  let body: ReactNode;
  if (business.status === "none") {
    body = (
      <Board m={m}>
        <EmptyState m={m} />
      </Board>
    );
  } else if (business.status === "loading") {
    body = (
      <Board m={m}>
        <LoadingState />
      </Board>
    );
  } else if (business.status === "ready" && business.businessId) {
    body = <RealResults businessId={business.businessId} />;
  } else {
    // Demo mode (or a ready state without an id): the real-shaped sample set.
    body = (
      <Board m={m}>
        <PopulatedResults measurements={DEMO_MEASUREMENTS} learnings={DEMO_LEARNINGS} m={m} />
      </Board>
    );
  }

  return (
    <DashboardShell active="Results" title="Results" chips={<Chip>Measured this week</Chip>}>
      {body}
    </DashboardShell>
  );
}

/** Shared button styles. Full-width pill treatment is applied per-call on mobile. */
const primaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  padding: "12px 22px",
  textDecoration: "none",
  whiteSpace: "nowrap",
  background: C.blue,
  border: "none",
  color: C.onPrimary,
  fontFamily: BODY,
  fontWeight: 500,
  fontSize: 15,
  lineHeight: "20px",
};

const outlineButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  padding: "12px 22px",
  textDecoration: "none",
  whiteSpace: "nowrap",
  alignSelf: "flex-start",
  background: "transparent",
  border: "1px solid " + C.border,
  color: C.text,
  fontFamily: BODY,
  fontWeight: 500,
  fontSize: 15,
  lineHeight: "20px",
};

/** Skeleton pulse — defined once, disabled under prefers-reduced-motion. */
const SKEL_CSS = `
@keyframes gv-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.gv-skel{animation:gv-pulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.gv-skel{animation:none}}
`;
