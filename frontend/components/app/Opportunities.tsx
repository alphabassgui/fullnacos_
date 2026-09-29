"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Icons } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW, DashboardShell } from "./shell";
import { InfoTip } from "@/components/ui/tooltip";
import { useIsMobile } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import { getOpportunities, type FlaskOpportunity } from "@/lib/api";
import {
  categoryLabel,
  impactStyle,
  sortByImpact,
  DEMO_OPPORTUNITIES,
  SUBHEAD_STYLE,
} from "./opportunities-data";

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

/** The scrollable board: intro heading + subtitle, then the Priority Bento —
 *  highest impact first, hero at the top. */
function OpportunitiesList({ opportunities }: { opportunities: FlaskOpportunity[] }) {
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
          Here&apos;s what I{" "}
          <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400 }}>found</em> on your site. I found a few
          things worth fixing.
        </h2>
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
          Highest impact first, so the one to chase is at the top. Nothing goes live until you approve it.
        </p>
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

/** Fetch + render the real opportunities for the current business (Flask mode). */
function RealOpportunities({ businessId }: { businessId: string }) {
  type Fetch =
    | { phase: "loading" }
    | { phase: "error" }
    | { phase: "ready"; opportunities: FlaskOpportunity[] };

  const [state, setState] = useState<Fetch>({ phase: "loading" });
  // Ignore results from a superseded fetch (business change, or a retry mid-flight).
  const reqId = useRef(0);

  const runFetch = useCallback(() => {
    const id = ++reqId.current;
    getOpportunities(businessId).then((result) => {
      if (id !== reqId.current) return;
      const list =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { opportunities?: FlaskOpportunity[] }).opportunities
          : null;
      if (!result.ok || !Array.isArray(list)) {
        setState({ phase: "error" });
        return;
      }
      setState({ phase: "ready", opportunities: list });
    });
  }, [businessId]);

  // Fetch on mount / business change. State is already "loading" (initial value),
  // so the effect only kicks off the async request — no synchronous setState here.
  // Staleness (overlapping fetches from a retry or a business change) is guarded by
  // reqId inside runFetch, so no cleanup is needed.
  useEffect(() => {
    runFetch();
  }, [runFetch]);

  const retry = useCallback(() => {
    setState({ phase: "loading" });
    runFetch();
  }, [runFetch]);

  if (state.phase === "loading") {
    return <CenteredNote><span style={{ fontSize: 14, color: C.muted }}>Loading your opportunities…</span></CenteredNote>;
  }

  if (state.phase === "error") {
    return (
      <CenteredNote>
        <Icons name="alert-triangle" size={24} style={{ color: C.muted }} />
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>
          I couldn&apos;t load your opportunities
        </span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Something went wrong reaching the server. Give it another try.
        </span>
        <button type="button" onClick={retry} style={retryButton}>
          Try again
        </button>
      </CenteredNote>
    );
  }

  if (state.opportunities.length === 0) {
    return (
      <CenteredNote>
        <span style={MONO_EYEBROW}>Groville</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>
          No opportunities yet
        </span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Once I finish reading your site, the gaps worth fixing show up here.
        </span>
        <Link href="/analysing" style={{ ...retryButton, textDecoration: "none" }}>
          Run a scan
        </Link>
      </CenteredNote>
    );
  }

  return <OpportunitiesList opportunities={state.opportunities} />;
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

/**
 * Empty slate for a signed-in user who has no business yet (real Flask path).
 * Sends them to onboarding to add their website. Dashboard tokens + flat surface,
 * no glass. Honesty boundary kept: I read and draft, nothing goes live without approval.
 */
function EmptyState() {
  const m = useIsMobile();
  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg, display: "flex" }}>
      <div
        style={{
          margin: "auto",
          width: "100%",
          maxWidth: 560,
          padding: m ? "40px 16px" : "48px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 24,
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: C.s2,
            border: "1px solid " + C.border,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icons name="globe" size={20} style={{ color: C.blueText }} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={MONO_EYEBROW}>Groville</span>
          <h1
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: m ? "clamp(26px, 8vw, 32px)" : 34,
              lineHeight: m ? 1.15 : "42px",
              letterSpacing: "-0.8px",
              color: C.text,
              textWrap: "pretty",
            }}
          >
            Add your website and I&apos;ll find the customers you&apos;re{" "}
            <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>
              missing
            </em>
            .
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: C.secondary, maxWidth: 460 }}>
            I read your public pages and Search Console to spot the searches you can win, then draft a
            campaign for each one. Nothing goes live until you approve it.
          </p>
        </div>
        <Link
          href="/onboarding"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 44,
            padding: "12px 22px",
            width: m ? "100%" : undefined,
            borderRadius: m ? 999 : 10,
            textDecoration: "none",
            background: C.blue,
            color: C.onPrimary,
            fontFamily: BODY,
            fontWeight: 500,
            fontSize: 15,
          }}
        >
          Add your website
          <Icons name="arrow-right" size={16} />
        </Link>
      </div>
    </main>
  );
}

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
 * demo loop still runs. A signed-in Flask user with a business fetches and
 * renders the real opportunities; one with no business sees the empty slate
 * (so "Skip to my dashboard" lands here and stays) rather than a redirect.
 */
export function OpportunitiesScreen() {
  const business = useBusiness();

  let body: React.ReactNode;
  if (business.status === "none") {
    body = <EmptyState />;
  } else if (business.status === "loading") {
    body = <LoadingState />;
  } else if (business.status === "ready" && business.businessId) {
    body = <RealOpportunities businessId={business.businessId} />;
  } else {
    // Demo mode (or a ready state without an id): the real-shaped sample set.
    body = <OpportunitiesList opportunities={DEMO_OPPORTUNITIES} />;
  }

  return (
    <DashboardShell active="Opportunities" title="Opportunities">
      {body}
    </DashboardShell>
  );
}
