"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Icons, Button } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW, DashboardShell } from "./shell";
import { InfoTip } from "@/components/ui/tooltip";
import { useIsMobile } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import {
  getOpportunities,
  getLatestRun,
  analyzeBusiness,
  runOutcome,
  type FlaskOpportunity,
  type FlaskRun,
  type ApiResult,
} from "@/lib/api";
import {
  categoryLabel,
  impactStyle,
  sortByImpact,
  DEMO_OPPORTUNITIES,
  SUBHEAD_STYLE,
} from "./opportunities-data";
import { STEPS, StepRow } from "./Analysing";
import { OpportunitiesEmptyState } from "./OpportunitiesEmptyState";

/**
 * Opportunities — the anchor dashboard, ported pixel-for-pixel from the Claude
 * Design export (docs/opportunities-real-reference.html) and rendered inside the
 * shared DashboardShell. It shows the real QUALITATIVE opportunity shape only:
 * title, description, problem, a humanized problem_key category, a
 * potential_impact badge and evidence bullets. No keyword / search-volume /
 * rank / clicks data appears anywhere.
 *
 * Data:
 *  - Demo mode (no NEXT_PUBLIC_API_BASE) renders DEMO_OPPORTUNITIES — the same
 *    real-shaped sample set, so one card design serves both paths.
 *  - Flask mode with a current business fetches GET /opportunities and renders
 *    the real list, highest impact first, with loading + error states.
 *  - A signed-in Flask user with no business keeps the existing empty slate.
 *
 * Honesty boundary: Groville drafts, the owner approves. Nothing goes live on
 * its own; the CTA opens a draft, it does not publish.
 */

const SERIF = "var(--font-serif)";

/** The per-opportunity CTA opens the campaign draft carrying the opportunity id. */
function draftHref(opportunityId: string): string {
  return `/campaign-draft?opportunity=${encodeURIComponent(opportunityId)}`;
}

/** Impact badge — a dot + label, tinted for high impact, outlined otherwise. */
function ImpactBadge({ level }: { level: string }) {
  const t = impactStyle(level);
  return (
    <InfoTip style={{ display: "inline-flex" }} tip="How much this gap is likely worth if you win it. Higher means chase it first.">
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px",
          borderRadius: 8,
          border: "1px solid " + t.line,
          background: t.fill,
          fontFamily: BODY,
          fontSize: 12,
          lineHeight: "16px",
          color: t.ink,
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 100, background: t.dot }} />
        {t.label}
      </span>
    </InfoTip>
  );
}

/** Humanized problem_key category chip. */
function CategoryTag({ k }: { k: string }) {
  return (
    <InfoTip style={{ display: "inline-flex" }} tip="The kind of gap this is, so you can see the pattern across findings.">
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
        {categoryLabel(k)}
      </span>
    </InfoTip>
  );
}

function SubHead({ children }: { children: string }) {
  return <span style={SUBHEAD_STYLE}>{children}</span>;
}

/** Two-digit ghost rank label (01, 02, …). */
function rankLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Collapsed evidence for secondary cards: a focusable "N signals" pill that
 * reveals the full list in a popover on hover or keyboard focus. Read-only, so
 * a popover (not an inline expand) keeps the grid from reflowing.
 */
function EvidencePill({ evidence }: { evidence: string[] }) {
  return (
    <div className="group/ev relative self-start">
      <button
        type="button"
        aria-label={`${evidence.length} signals I found`}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 font-[var(--font-body)] text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[var(--text-muted)]" />
        {evidence.length} signals
      </button>
      <div className="absolute left-0 top-full z-10 hidden w-[min(320px,80vw)] pt-2 group-hover/ev:block group-focus-within/ev:block">
        <ul className="m-0 flex list-none flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-[var(--gv-card-hover-shadow)]">
          {evidence.map((e) => (
            <li key={e} className="flex items-start gap-2 text-[var(--text-secondary)]">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[var(--text-muted)]" />
              <span className="font-[var(--font-body)] text-[13px] leading-snug text-pretty">{e}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * One opportunity card in the Priority Bento. `hero` = the highest-impact card,
 * which spans two columns, runs taller, and shows the full evidence list
 * (stagger-fading in on mount). Secondary cards clamp their description and
 * collapse evidence into a hover/focus pill. The left accent spine is the only
 * place blue is emphasized — blue for high impact, neutral otherwise.
 */
function OppCard({
  opp,
  hero,
  rank,
  variants,
}: {
  opp: FlaskOpportunity;
  hero: boolean;
  rank: number;
  variants: Variants;
}) {
  const reduced = useReducedMotion();
  const high = opp.potential_impact === "high";

  // Hero evidence stagger — animates on mount; reduced motion collapses to a
  // plain fade with no offset or stagger.
  const evList: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.06, delayChildren: reduced ? 0 : 0.12 } },
  };
  const evItem: Variants = {
    hidden: { opacity: 0, y: reduced ? 0 : 6 },
    show: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.32, ease: "easeOut" } },
  };

  return (
    <motion.article
      variants={variants}
      // The hero card is the product tour's first anchor (TOUR_STEPS[0],
      // data-tour="gap", radius 16 == this card's rounded-2xl). Present on the
      // lead card in every render path (demo + Flask), never on secondary cards.
      {...(hero ? { "data-tour": "gap" } : {})}
      className={
        "group/card relative flex flex-col gap-5 overflow-hidden rounded-2xl border border-[var(--border)] " +
        "transition-[transform,box-shadow,border-color] duration-150 ease-out " +
        "hover:-translate-y-[3px] hover:border-[var(--primary)] hover:shadow-[var(--gv-card-hover-shadow)] " +
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0 " +
        (hero
          ? "bg-[var(--surface-2)] p-7 md:col-span-2 md:p-8 xl:row-span-2"
          : "bg-[var(--surface-1)] p-6")
      }
    >
      {/* Left accent spine — blue only for high impact. */}
      <span
        aria-hidden="true"
        className={"absolute inset-y-0 left-0 w-1 " + (high ? "bg-[var(--primary)]" : "bg-[var(--border)]")}
      />
      {/* Low-opacity ghost rank numeral. */}
      <span
        aria-hidden="true"
        className={
          "pointer-events-none absolute right-4 top-3 font-[var(--font-display)] font-semibold leading-none text-[var(--text)] opacity-[0.06] " +
          (hero ? "text-7xl md:text-8xl" : "text-5xl")
        }
      >
        {rankLabel(rank)}
      </span>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ImpactBadge level={opp.potential_impact} />
          <CategoryTag k={opp.problem_key} />
          {hero && (
            <span className="ml-auto font-[var(--font-body)] text-xs text-[var(--accent-text)]">Start here</span>
          )}
        </div>
        <h3
          className={
            "m-0 font-[var(--font-display)] font-semibold leading-tight tracking-[-0.3px] text-[var(--text)] text-pretty " +
            (hero ? "text-[clamp(24px,3vw,32px)]" : "text-[19px]")
          }
        >
          {opp.title}
        </h3>
        <p
          className={
            "m-0 max-w-[640px] font-[var(--font-body)] leading-relaxed text-[var(--text-secondary)] text-pretty " +
            (hero ? "text-[15px]" : "line-clamp-2 text-sm")
          }
        >
          {opp.description}
        </p>
      </div>

      {hero ? (
        <>
          <div className="flex flex-col gap-2">
            <SubHead>The gap</SubHead>
            <p className="m-0 font-[var(--font-body)] text-sm leading-relaxed text-[var(--text)] text-pretty">
              {opp.problem}
            </p>
          </div>
          <div className="h-px bg-[var(--border)]" />
          <div className="flex flex-col gap-2">
            <SubHead>What I saw</SubHead>
            <motion.ul
              variants={evList}
              initial="hidden"
              animate="show"
              className="m-0 flex list-none flex-col gap-2 p-0"
            >
              {opp.evidence.map((e) => (
                <motion.li key={e} variants={evItem} className="flex items-start gap-2.5 text-[var(--text-secondary)]">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-[5px] w-[5px] flex-shrink-0 rounded-full bg-[var(--text-muted)]"
                  />
                  <span className="font-[var(--font-body)] text-sm leading-relaxed text-pretty">{e}</span>
                </motion.li>
              ))}
            </motion.ul>
          </div>
          <div className="mt-1 flex flex-col gap-2">
            <DraftCta id={opp.id} />
            <p className="m-0 font-[var(--font-body)] text-[13px] leading-tight text-[var(--text-muted)] text-pretty">
              I draft it, you approve. Nothing goes live on its own.
            </p>
          </div>
        </>
      ) : (
        <div className="mt-auto flex flex-col gap-4">
          <EvidencePill evidence={opp.evidence} />
          <DraftCta id={opp.id} />
        </div>
      )}
    </motion.article>
  );
}

/** Per-card CTA. Opens a draft (never publishes); arrow slides on card hover. */
function DraftCta({ id }: { id: string }) {
  return (
    <Link
      href={draftHref(id)}
      className="inline-flex items-center gap-2 self-start rounded font-[var(--font-body)] text-sm font-medium text-[var(--text)] no-underline transition-colors hover:text-[var(--accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
    >
      Draft the fix
      <span className="inline-flex transition-transform duration-150 group-hover/card:translate-x-1 motion-reduce:transform-none">
        <Icons name="arrow-right" size={16} />
      </span>
    </Link>
  );
}

const REANALYZE_CSS = `
.gv-reanalyze-spin{width:14px;height:14px;flex-shrink:0;border-radius:999px;border:2px solid var(--border);border-top-color:var(--primary);animation:gv-reanalyze-spin .8s linear infinite}
@media (prefers-reduced-motion:reduce){.gv-reanalyze-spin{animation-duration:2.4s}}
@keyframes gv-reanalyze-spin{to{transform:rotate(360deg)}}
`;

/** Quiet in-place status while a fresh audit runs over an existing board. */
function ReanalyzingBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 10,
        background: C.s1,
        border: "1px solid " + C.border,
        maxWidth: 720,
      }}
    >
      <style href="gv-reanalyze" precedence="high">
        {REANALYZE_CSS}
      </style>
      <span className="gv-reanalyze-spin" aria-hidden="true" />
      <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.secondary, textWrap: "pretty" }}>
        Re-analyzing your site… I&apos;ll refresh these gaps when it&apos;s done.
      </span>
    </div>
  );
}

/** The scrollable board: intro heading + subtitle, then the Priority Bento —
 *  highest impact first, hero at the top. `reanalyzing` shows a quiet banner while
 *  a fresh audit runs in the background, keeping the current results on screen. */
function OpportunitiesList({
  opportunities,
  reanalyzing = false,
  onRerun,
}: {
  opportunities: FlaskOpportunity[];
  reanalyzing?: boolean;
  /** When provided, a quiet "Re-run audit" button appears in the board header. */
  onRerun?: () => void;
}) {
  const m = useIsMobile();
  const reduced = useReducedMotion();
  const sorted = sortByImpact(opportunities);

  const gridVariants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.06 } },
  };
  const cardVariants: Variants = {
    hidden: { opacity: 0, y: reduced ? 0 : 8 },
    show: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.32, ease: "easeOut" } },
  };

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
      }}
    >
      {reanalyzing && <ReanalyzingBanner />}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720, minWidth: 0, flex: "1 1 320px" }}>
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
            Here&apos;s what I{" "}
            <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400 }}>found</em> on your site. I found a few
            things worth fixing.
          </h2>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
            Highest impact first, so the one to chase is at the top. Nothing goes live until you approve it.
          </p>
        </div>
        {onRerun && !reanalyzing && (
          <Button
            hierarchy="secondary gray"
            size="md"
            onClick={onRerun}
            style={{ borderRadius: m ? 999 : 10, flexShrink: 0, justifyContent: "center" }}
          >
            Re-run audit
          </Button>
        )}
      </div>

      <motion.section
        variants={gridVariants}
        initial="hidden"
        animate="show"
        className="grid min-w-0 auto-rows-auto grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {sorted.map((opp, i) => (
          <OppCard key={opp.id} opp={opp} hero={i === 0} rank={i} variants={cardVariants} />
        ))}
      </motion.section>
    </main>
  );
}

/** A centered status message (loading / error / empty findings) inside the board. */
function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg, display: "flex" }}>
      <div
        style={{
          margin: "auto",
          width: "100%",
          maxWidth: 480,
          padding: "48px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </main>
  );
}

/* ── Flask status helpers ─────────────────────────────────────────────────── */

/** The latest analyze run from GET /runs/latest, or null when there is none. */
function extractRun(res: ApiResult): FlaskRun | null {
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const run = (res.data as { run?: FlaskRun | null }).run;
  return run ?? null;
}

/** The opportunity list from GET /opportunities, or null when the fetch failed. */
function extractOpps(res: ApiResult): FlaskOpportunity[] | null {
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const list = (res.data as { opportunities?: FlaskOpportunity[] }).opportunities;
  return Array.isArray(list) ? list : null;
}

// Poll cadence + ceiling for watching a run to completion. 4s × 45 ≈ 3 min, which
// sits above apiFetch's own 60s per-request ceiling without adding new timeout logic.
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_TICKS = 45;

type View =
  | { kind: "detecting" }
  | { kind: "empty" } // dual-recovery: no business, or a business with no website
  | { kind: "analyzing" }
  // reanalyzing = a fresh audit is running while an existing board stays on screen.
  | { kind: "ready"; opportunities: FlaskOpportunity[]; reanalyzing?: boolean }
  | { kind: "noGaps" } // run finished (or site saved) with zero opportunities — offer a re-run
  | { kind: "error"; mode: "load" | "failed" | "timeout" };

/**
 * In-board analyzing state — shown on the dashboard (inside DashboardShell) while a
 * first audit runs, in place of the generic "Waking things up…" cold-start loader.
 * Reuses the real, honest scan copy from Analysing.tsx (STEPS + StepRow) so it reads
 * as "running your analysis", not "starting a server". The checklist advances on a
 * gentle cosmetic timer (never claims server-side progress or 100%) — the real
 * completion comes from the parent's poll, which then swaps in the board.
 */
function AnalyzingBoard() {
  const m = useIsMobile();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(reduced ? STEPS.length - 1 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => {
      setActive((a) => (a < STEPS.length - 1 ? a + 1 : a));
    }, 2400);
    return () => window.clearInterval(t);
  }, [reduced]);

  // Cosmetic only: ramps but never reaches 100% (completion swaps the view).
  const progress = Math.round(((active + 1) / (STEPS.length + 1)) * 100);

  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg, display: "flex", minWidth: 0 }}>
      <div
        style={{
          margin: "auto",
          width: "100%",
          maxWidth: 520,
          boxSizing: "border-box",
          padding: m ? "40px 16px" : "48px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: m ? 22 : 26,
          textAlign: "center",
        }}
      >
        {/* Scan indicator — pulsing ring around the live dot (static under reduced motion). */}
        <span
          aria-hidden="true"
          style={{ position: "relative", width: 56, height: 56, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          {!reduced && (
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
              background: C.blue,
              boxShadow: "var(--shadow-primary-glow)",
            }}
          >
            <Icons name="vital-sign" size={22} style={{ color: "#fff" }} />
          </span>
        </span>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={MONO_EYEBROW}>Analysing</span>
          <h2
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: m ? "clamp(22px, 6vw, 28px)" : 28,
              lineHeight: m ? 1.2 : "36px",
              letterSpacing: "-0.6px",
              color: C.text,
              textWrap: "pretty",
            }}
          >
            Reading your{" "}
            <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>site</em>.
          </h2>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 15, lineHeight: "22px", color: C.secondary }}>
            I&apos;m scanning your public pages for the gaps worth fixing. This usually takes a minute or two.
          </p>
        </div>

        {/* Cosmetic progress bar */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Analysis in progress"
            style={{ display: "block", width: "100%", height: 6, borderRadius: 6, background: C.border, overflow: "hidden" }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                width: progress + "%",
                borderRadius: 6,
                background: "var(--gradient-primary, " + C.blue + ")",
                transition: reduced ? "none" : "width .5s cubic-bezier(.4,0,.2,1)",
              }}
            />
          </span>
        </div>

        {/* Stepped checklist (shared with the /analysing screen) */}
        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: C.s1,
            border: "1px solid " + C.border,
            borderRadius: 16,
            padding: m ? 20 : 28,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            textAlign: "left",
          }}
        >
          {STEPS.map((label, i) => {
            const state: "pending" | "active" | "done" = i < active ? "done" : i === active ? "active" : "pending";
            return <StepRow key={label} label={label} state={state} />;
          })}
        </div>

        <p style={{ margin: 0, fontFamily: BODY, fontSize: 12, lineHeight: "18px", color: C.muted, maxWidth: 420 }}>
          I only read and draft. Nothing goes live until you approve it.
        </p>
      </div>
    </main>
  );
}

/**
 * The real Flask Opportunities experience: status-aware branching driven by the
 * actual backend signals (GET /runs/latest classified via runOutcome, plus
 * GET /opportunities), never by list length alone. Owns the current business id so
 * the recovery flow can create a business and keep rendering here (no page reload),
 * and polls a running audit to completion before swapping in the populated board.
 */
function FlaskOpportunities({
  initialBusinessId,
  websiteUrl,
}: {
  initialBusinessId: string | null;
  websiteUrl: string | null;
}) {
  const [businessId, setBusinessId] = useState<string | null>(initialBusinessId);
  const [view, setView] = useState<View>({ kind: "detecting" });

  // Guards a superseded detect/refetch (business change or retry mid-flight).
  const reqId = useRef(0);
  const pollTimer = useRef<number | null>(null);
  const pollTicks = useRef(0);
  // False after unmount — stops any in-flight fetch/poll from calling setState.
  const alive = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current != null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    pollTicks.current = 0;
  }, []);

  // Refetch opportunities once a run completes and show the board (or the no-gaps
  // state). Never reloads the page — just swaps local state.
  const loadOpportunities = useCallback(async (id: string) => {
    const token = ++reqId.current;
    const opps = extractOpps(await getOpportunities(id));
    if (!alive.current || token !== reqId.current) return;
    if (opps == null) {
      setView({ kind: "error", mode: "load" });
      return;
    }
    setView(opps.length > 0 ? { kind: "ready", opportunities: opps } : { kind: "noGaps" });
  }, []);

  // `fallbackOpps` is the board already on screen (a re-run). On failure/timeout we
  // keep it rather than wiping valid results with a full error screen.
  const startPolling = useCallback(
    (id: string, fallbackOpps?: FlaskOpportunity[] | null) => {
      stopPolling();
      pollTicks.current = 0;
      const giveUp = (mode: "failed" | "timeout") => {
        stopPolling();
        if (fallbackOpps && fallbackOpps.length > 0) {
          setView({ kind: "ready", opportunities: fallbackOpps });
        } else {
          setView({ kind: "error", mode });
        }
      };
      pollTimer.current = window.setInterval(async () => {
        pollTicks.current += 1;
        const res = await getLatestRun(id);
        if (!alive.current) {
          stopPolling();
          return;
        }
        const outcome = runOutcome(extractRun(res));
        if (outcome === "complete") {
          stopPolling();
          void loadOpportunities(id);
          return;
        }
        if (outcome === "failed") {
          giveUp("failed");
          return;
        }
        if (pollTicks.current >= POLL_MAX_TICKS) {
          giveUp("timeout");
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, loadOpportunities],
  );

  // Detect which state to show for the current business.
  const detect = useCallback(async () => {
    stopPolling();
    const token = ++reqId.current;
    setView({ kind: "detecting" });

    if (businessId == null) {
      setView({ kind: "empty" });
      return;
    }

    const [runRes, oppRes] = await Promise.all([getLatestRun(businessId), getOpportunities(businessId)]);
    if (!alive.current || token !== reqId.current) return;

    const run = extractRun(runRes);
    const opps = extractOpps(oppRes);
    const outcome = runOutcome(run);

    if (run != null && outcome === "failed") {
      setView({ kind: "error", mode: "failed" });
      return;
    }
    if (run != null && outcome === "pending") {
      // A re-run with an existing board stays on the board (quiet "re-analyzing"
      // banner); only a first run (no board yet) shows the full-screen spinner.
      if (opps != null && opps.length > 0) {
        setView({ kind: "ready", opportunities: opps, reanalyzing: true });
        startPolling(businessId, opps);
      } else {
        setView({ kind: "analyzing" });
        startPolling(businessId);
      }
      return;
    }
    // Completed, or no run yet. Populated board wins (length as last-resort tiebreaker).
    if (opps != null && opps.length > 0) {
      setView({ kind: "ready", opportunities: opps });
      return;
    }
    if (run != null && outcome === "complete") {
      // A real run finished with zero gaps — distinct from skipped onboarding.
      if (opps == null) {
        setView({ kind: "error", mode: "load" });
        return;
      }
      setView({ kind: "noGaps" });
      return;
    }
    // No run yet: a business without a website is the skipped-audit recovery case;
    // one that has a website but was never analyzed can simply run its first audit.
    setView(websiteUrl ? { kind: "noGaps" } : { kind: "empty" });
  }, [businessId, websiteUrl, startPolling, stopPolling]);

  // Run detection once on mount. Kicked off on a macrotask (not synchronously in
  // the effect body) so the initial "detecting" state the UI already renders isn't
  // re-set mid-commit. Later businessId changes come only from onAuditStarted /
  // rerun below, which drive the view directly — so detect must NOT re-run on
  // businessId change, which would cancel an in-flight poll and could bounce a
  // freshly created business back to the empty state.
  useEffect(() => {
    alive.current = true;
    const kickoff = window.setTimeout(() => void detect(), 0);
    return () => {
      alive.current = false;
      window.clearTimeout(kickoff);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recovery flow started an audit (and possibly created the business): adopt the
  // id, flip to the analyzing loader, and poll — no reload.
  const onAuditStarted = useCallback(
    (id: string) => {
      setBusinessId(id);
      setView({ kind: "analyzing" });
      startPolling(id);
    },
    [startPolling],
  );

  // Re-run the audit. From a populated board (keepOpps passed) we keep the board on
  // screen with the "re-analyzing" banner; from no-gaps / error (no board) we show the
  // full in-board analyzing state.
  const rerun = useCallback(
    async (keepOpps?: FlaskOpportunity[]) => {
      if (businessId == null) {
        setView({ kind: "empty" });
        return;
      }
      const hasBoard = !!keepOpps && keepOpps.length > 0;
      if (hasBoard) {
        setView({ kind: "ready", opportunities: keepOpps as FlaskOpportunity[], reanalyzing: true });
      } else {
        setView({ kind: "analyzing" });
      }
      const started = await analyzeBusiness(businessId);
      if (!started.ok) {
        // Keep valid results if a board was showing; otherwise surface the error.
        if (hasBoard) {
          setView({ kind: "ready", opportunities: keepOpps as FlaskOpportunity[] });
        } else {
          setView({ kind: "error", mode: "failed" });
        }
        return;
      }
      startPolling(businessId, hasBoard ? keepOpps : undefined);
    },
    [businessId, startPolling],
  );

  if (view.kind === "detecting") {
    return (
      <CenteredNote>
        <span style={{ fontSize: 14, color: C.muted }}>Loading your opportunities…</span>
      </CenteredNote>
    );
  }

  if (view.kind === "empty") {
    return <OpportunitiesEmptyState businessId={businessId} onAuditStarted={onAuditStarted} />;
  }

  if (view.kind === "analyzing") {
    // In-board scan UI (reuses the honest Analysing copy) — reads as "running your
    // analysis", not the generic server-cold-start loader.
    return <AnalyzingBoard />;
  }

  if (view.kind === "error") {
    const copy =
      view.mode === "failed"
        ? "The audit didn't finish. Give it another try."
        : view.mode === "timeout"
          ? "This is taking longer than usual. You can try the audit again."
          : "Something went wrong reaching the server. Give it another try.";
    const onRetry = view.mode === "load" ? () => void detect() : () => void rerun();
    return (
      <CenteredNote>
        <Icons name="alert-triangle" size={24} style={{ color: C.muted }} />
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>
          {view.mode === "load" ? "I couldn't load your opportunities" : "The audit didn't finish"}
        </span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>{copy}</span>
        <button type="button" onClick={onRetry} style={retryButton}>
          Try again
        </button>
      </CenteredNote>
    );
  }

  if (view.kind === "noGaps") {
    return (
      <CenteredNote>
        <span style={MONO_EYEBROW}>Groville</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>
          No gaps found
        </span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          I read your site and didn&apos;t spot a gap worth chasing right now. Things change — re-run the
          audit whenever you&apos;d like a fresh look.
        </span>
        <button type="button" onClick={() => void rerun()} style={retryButton}>
          Re-run audit
        </button>
      </CenteredNote>
    );
  }

  return (
    <OpportunitiesList
      opportunities={view.opportunities}
      reanalyzing={view.reanalyzing}
      onRerun={() => void rerun(view.opportunities)}
    />
  );
}

const retryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "10px 20px",
  borderRadius: 10,
  border: "none",
  background: C.blue,
  color: C.onPrimary,
  fontFamily: BODY,
  fontWeight: 500,
  fontSize: 15,
  cursor: "pointer",
};

/** Brief placeholder while the current business resolves (avoids flashing mock data). */
function LoadingState() {
  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg, display: "flex" }}>
      <span style={{ margin: "auto", fontSize: 14, color: C.muted }}>Loading your dashboard…</span>
    </main>
  );
}

/**
 * Full Opportunities screen inside the shared dashboard shell.
 *
 * Demo mode (no NEXT_PUBLIC_API_BASE) renders the qualitative sample set so the
 * demo loop still runs. Every signed-in Flask path — a business with findings, a
 * running audit, a finished run with no gaps, a failure, or no business/website at
 * all — is handled by FlaskOpportunities, which branches on the real backend
 * status (not list length) and offers in-place recovery without a page reload.
 */
export function OpportunitiesScreen() {
  const business = useBusiness();

  let body: React.ReactNode;
  if (business.status === "loading") {
    body = <LoadingState />;
  } else if (business.status === "demo") {
    // Demo mode (no backend): the real-shaped sample set.
    body = <OpportunitiesList opportunities={DEMO_OPPORTUNITIES} />;
  } else {
    // Flask: "none" (no business) or "ready" (have one). FlaskOpportunities owns the
    // status-aware branching and the dual-recovery empty state.
    body = (
      <FlaskOpportunities
        initialBusinessId={business.status === "ready" ? business.businessId : null}
        websiteUrl={business.status === "ready" ? business.business?.website_url ?? null : null}
      />
    );
  }

  return (
    <DashboardShell active="Opportunities" title="Opportunities">
      {body}
    </DashboardShell>
  );
}
