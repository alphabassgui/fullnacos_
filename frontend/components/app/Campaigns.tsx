"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icons } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW, DashboardShell, Chip } from "./shell";
import { InfoTip } from "@/components/ui/tooltip";
import { useIsMobile } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import { listActions, type FlaskAction } from "@/lib/api";
import { typeLabel, statusMeta, statusRank, type StatusTone, DEMO_ACTION } from "./campaign-draft-data";

/**
 * Campaigns — the list of drafts Groville has written, each waiting on the owner's
 * approval. It renders the REAL drafted actions (from the same decision-engine shape
 * the campaign-draft screen uses) so the two screens stay consistent, and each card
 * opens its own draft at /campaign-draft?opportunity=<opportunity_id>.
 *
 *  - Demo mode (no NEXT_PUBLIC_API_BASE) shows the sample action so the demo loop runs.
 *  - Flask mode with a current business fetches GET /actions and lists them, highest
 *    priority (pending) first, with loading + error + empty states.
 *  - A signed-in Flask user with no business sees the "add your website" slate.
 *
 * Honesty boundary: Groville drafts, the owner approves. Nothing here publishes or
 * sends on its own. Flat dashboard surfaces (no glass), both themes.
 */

const SERIF = "var(--font-serif)";

/** A drafted action's link into its own campaign draft. */
function draftHref(opportunityId: string): string {
  return `/campaign-draft?opportunity=${encodeURIComponent(opportunityId)}`;
}

/** Small status/type badge — tinted per tone (matches the campaign-draft Tag palette). */
function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  const t = {
    neutral: { fill: C.s2, line: "transparent", ink: C.muted, dot: null as string | null },
    blue: { fill: "var(--gv-badge-fill)", line: "var(--gv-badge-line)", ink: C.blueText, dot: C.blue },
    good: { fill: "var(--gv-good-fill)", line: "var(--gv-good-line)", ink: C.good, dot: C.good },
    bad: { fill: "var(--gv-bad-fill)", line: "var(--gv-bad-line)", ink: C.bad, dot: C.bad },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 8,
        background: t.fill,
        border: "1px solid " + t.line,
        fontFamily: BODY,
        fontSize: 12,
        lineHeight: "16px",
        color: t.ink,
        whiteSpace: "nowrap",
      }}
    >
      {t.dot && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 100, background: t.dot }} />}
      {children}
    </span>
  );
}

/** One drafted-action card. Title + type + status, and a Review draft CTA into its draft. */
function DraftCard({ action, m }: { action: FlaskAction; m: boolean }) {
  const status = statusMeta(action.status);
  return (
    <article
      className="gv-card"
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: m ? 20 : "clamp(20px, 2.4vw, 28px)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag tone="blue">{typeLabel(action.action_type)}</Tag>
        <InfoTip
          style={{ display: "inline-flex" }}
          tip="Where this draft is in its lifecycle. Nothing runs until you approve it."
        >
          <Tag tone={status.tone}>{status.label}</Tag>
        </InfoTip>
      </div>

      <h3
        style={{
          margin: 0,
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: m ? "clamp(20px, 6vw, 24px)" : "clamp(20px, 2vw, 24px)",
          lineHeight: 1.2,
          letterSpacing: "-0.4px",
          color: C.text,
          textWrap: "pretty",
        }}
      >
        {action.action_title}
      </h3>

      {action.reasoning && (
        <p
          style={{
            margin: 0,
            maxWidth: 680,
            fontFamily: BODY,
            fontSize: 14,
            lineHeight: "21px",
            color: C.secondary,
            textWrap: "pretty",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {action.reasoning}
        </p>
      )}

      <div style={{ display: "flex" }}>
        <Link
          href={draftHref(action.opportunity_id)}
          className="gv-btn gv-btn--primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 44,
            padding: "12px 22px",
            width: m ? "100%" : undefined,
            borderRadius: m ? 999 : 8,
            textDecoration: "none",
            whiteSpace: "nowrap",
            background: C.blue,
            color: C.onPrimary,
            fontFamily: BODY,
            fontWeight: 500,
            fontSize: 15,
            lineHeight: "20px",
          }}
        >
          Review draft
          <Icons name="arrow-right" size={16} />
        </Link>
      </div>
    </article>
  );
}

/** Agent-voice header. Count reflects how many drafts are listed. */
function Header({ m }: { m: boolean }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <span
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 12,
          background: C.s2,
          border: "1px solid " + C.border,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 99, background: C.good }} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <span style={MONO_EYEBROW}>Groville · campaigns</span>
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
            maxWidth: 820,
          }}
        >
          Here are the campaigns I&apos;ve{" "}
          <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>drafted</em>{" "}
          for you. You approve every one.
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: C.secondary, maxWidth: 640 }}>
          Nothing goes live until you approve it. I never publish or send on my own.
        </p>
      </div>
    </div>
  );
}

/** The list body: header + section of cards, pending first. */
function CampaignsList({ actions }: { actions: FlaskAction[] }) {
  const m = useIsMobile();
  const sorted = [...actions].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <div
        style={{
          maxWidth: 920,
          margin: "0 auto",
          padding: m ? "24px 16px 40px" : "32px 40px 48px",
          display: "flex",
          flexDirection: "column",
          gap: m ? 24 : 32,
        }}
      >
        <Header m={m} />
        <section style={{ display: "flex", flexDirection: "column", gap: m ? 16 : 20, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>Waiting for you</h2>
            <span style={{ fontSize: 13, color: C.muted }}>
              {sorted.length === 1 ? "The one campaign I've drafted so far" : `${sorted.length} drafts so far`}
            </span>
          </div>
          {sorted.map((a) => (
            <DraftCard key={a.id} action={a} m={m} />
          ))}
        </section>
      </div>
    </main>
  );
}

/** A centered status message (loading / error / empty) inside the board. */
function CenteredNote({ children }: { children: ReactNode }) {
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

const primaryBtn: CSSProperties = {
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
  textDecoration: "none",
};

/** Fetch + render the real drafted actions for the current business (Flask mode). */
function RealCampaigns({ businessId }: { businessId: string }) {
  type Fetch =
    | { phase: "loading" }
    | { phase: "error" }
    | { phase: "ready"; actions: FlaskAction[] };

  const [state, setState] = useState<Fetch>({ phase: "loading" });
  const reqId = useRef(0);

  const runFetch = useCallback(() => {
    const id = ++reqId.current;
    listActions(businessId).then((result) => {
      if (id !== reqId.current) return;
      const list =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { actions?: FlaskAction[] }).actions
          : null;
      if (!result.ok || !Array.isArray(list)) {
        setState({ phase: "error" });
        return;
      }
      setState({ phase: "ready", actions: list });
    });
  }, [businessId]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  const retry = useCallback(() => {
    setState({ phase: "loading" });
    runFetch();
  }, [runFetch]);

  if (state.phase === "loading") {
    return (
      <CenteredNote>
        <span style={{ fontSize: 14, color: C.muted }}>Loading your campaigns…</span>
      </CenteredNote>
    );
  }

  if (state.phase === "error") {
    return (
      <CenteredNote>
        <Icons name="alert-triangle" size={24} style={{ color: C.muted }} />
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>
          I couldn&apos;t load your campaigns
        </span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Something went wrong reaching the server. Give it another try.
        </span>
        <button type="button" onClick={retry} className="gv-btn gv-btn--primary" style={primaryBtn}>
          Try again
        </button>
      </CenteredNote>
    );
  }

  if (state.actions.length === 0) {
    return (
      <CenteredNote>
        <span style={MONO_EYEBROW}>Groville</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>No drafts yet</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Once I&apos;ve read your site and found the gaps, the campaigns I&apos;d run show up here for your approval.
        </span>
        <Link href="/opportunities" className="gv-btn gv-btn--primary" style={{ ...primaryBtn, textDecoration: "none" }}>
          See opportunities
        </Link>
      </CenteredNote>
    );
  }

  return <CampaignsList actions={state.actions} />;
}

/** Empty slate for a signed-in Flask user with no business yet. */
function EmptyState() {
  return (
    <CenteredNote>
      <span style={MONO_EYEBROW}>Groville</span>
      <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>Add your website first</span>
      <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
        Once I&apos;ve read your site and found the gaps, the campaigns I&apos;d run show up here for your approval.
      </span>
      <Link href="/onboarding" className="gv-btn gv-btn--primary" style={{ ...primaryBtn, textDecoration: "none" }}>
        Add your website
      </Link>
    </CenteredNote>
  );
}

/**
 * Full Campaigns screen inside the shared dashboard shell. Demo mode renders the
 * sample action so the demo loop still runs; a signed-in Flask user with a business
 * fetches and lists their real drafts.
 */
export function CampaignsScreen() {
  const business = useBusiness();

  let body: React.ReactNode;
  if (business.status === "none") {
    body = <EmptyState />;
  } else if (business.status === "loading") {
    body = (
      <CenteredNote>
        <span style={{ fontSize: 14, color: C.muted }}>Loading your dashboard…</span>
      </CenteredNote>
    );
  } else if (business.status === "ready" && business.businessId) {
    body = <RealCampaigns businessId={business.businessId} />;
  } else {
    // Demo mode (or a ready state without an id): the sample drafted action.
    body = <CampaignsList actions={[DEMO_ACTION]} />;
  }

  return (
    <DashboardShell active="Campaigns" title="Campaigns" chips={<Chip>Drafts</Chip>}>
      {body}
    </DashboardShell>
  );
}
