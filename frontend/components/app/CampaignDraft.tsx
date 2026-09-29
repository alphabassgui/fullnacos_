"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icons } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW, DashboardShell, Chip } from "./shell";
import { InfoTip } from "@/components/ui/tooltip";
import { useIsMobile, usePrefersReducedMotion } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import {
  isFlaskConfigured,
  listActions,
  approveAction,
  rejectAction,
  getExecution,
  getOpportunities,
  executionOutcome,
  type FlaskAction,
  type FlaskExecution,
  type FlaskOpportunity,
} from "@/lib/api";
import { getExecutionId, setExecutionId } from "@/lib/campaign-draft-store";
import { typeLabel, confidenceLabel, DEMO_ACTION, DEMO_OPP_TITLE } from "./campaign-draft-data";

/**
 * Campaign draft — the screen the Opportunities "Draft the campaign" CTA opens,
 * carrying the opportunity id (`/campaign-draft?opportunity=<id>`). Ported
 * pixel-for-pixel from the Claude Design export
 * (docs/campaign-draft-real-reference.html, decoded from its bundle) and rendered
 * inside the shared DashboardShell.
 *
 * It shows ONE drafted action: a humanized action_type badge, the action_title
 * headline, "Why I'm doing this" (reasoning), "What to watch" (expected_outcome,
 * framed as signals not a promise), "What I'll need from you" (required_inputs, or
 * "Nothing needed from you." when empty) and a confidence indicator derived from
 * the number (>=0.7 High / 0.4-0.69 Medium / <0.4 Low, always with the label).
 *
 * This screen is the literal enforcement of the honesty boundary: nothing runs
 * until the owner approves. Approve queues a Celery execution the UI polls;
 * completed/failed copy reflects the REAL backend outcome/error, never a pretended
 * result.
 *
 * Two modes:
 *  - DEMO (no NEXT_PUBLIC_API_BASE): a sample action in the real shape; Approve
 *    simulates running -> completed with a timer so the demo loop still runs.
 *  - FLASK (configured + a current business): fetch the business's actions, select
 *    the one whose opportunity_id matches the URL, and drive the states off the
 *    action's real status (approve / poll execution / reject).
 *
 * The "Preview state" pill row is kept in both modes (design-export affordance): it
 * sets the displayed status for inspection; the real Approve/Reject/poll write the
 * same display state.
 */

const POLL_MS = 3500; // execution poll interval
const DEMO_RUN_MS = 2600; // demo: dwell on "running" before completing
const RESULTS_HREF = "/results";
const CONNECTIONS_HREF = "/connections";
const OPPORTUNITIES_HREF = "/opportunities";

/** The action lifecycle statuses the UI renders. */
type DraftStatus = "pending_approval" | "running" | "completed" | "failed" | "rejected";

/** The four states the preview toggle exposes (matches the design export). */
const PREVIEW_STATES: [DraftStatus, string][] = [
  ["pending_approval", "Pending approval"],
  ["running", "Running"],
  ["completed", "Completed"],
  ["failed", "Failed"],
];

/* ── Presentational primitives (ported from the reference) ─────────────────── */

type Tone = "neutral" | "blue" | "good" | "bad";

function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
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

function SubHead({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: DISPLAY,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: C.muted,
      }}
    >
      {children}
    </span>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <SubHead>{label}</SubHead>
      {children}
    </div>
  );
}

function Body({ children, ink = C.secondary }: { children: ReactNode; ink?: string }) {
  return (
    <p style={{ margin: 0, maxWidth: 680, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: ink, textWrap: "pretty" }}>
      {children}
    </p>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <Body ink={C.muted}>Nothing needed from you.</Body>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((i) => (
        <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 100, background: C.muted, flexShrink: 0, marginTop: 8 }} />
          <span style={{ fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>{i}</span>
        </li>
      ))}
    </ul>
  );
}

/** Confidence indicator — label + value + bar + the honest caption. Value clamped 0..1. */
function Confidence({ value }: { value: number }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <SubHead>Confidence</SubHead>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.text }}>{confidenceLabel(v)}</span>
        <span style={{ fontFamily: DISPLAY, fontSize: 13, color: C.muted }}>{v.toFixed(2)}</span>
      </div>
      <span style={{ display: "block", width: "100%", maxWidth: 220, height: 6, borderRadius: 6, background: C.border, overflow: "hidden" }}>
        <span style={{ display: "block", width: v * 100 + "%", height: "100%", borderRadius: 6, background: C.blue }} />
      </span>
      <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>
        How sure I am this is the right move, not how sure I am it will work.
      </span>
    </div>
  );
}

const btnStyle = (kind: "primary" | "secondary" | "quiet"): CSSProperties => {
  const s = {
    primary: { background: C.blue, color: "var(--text-on-primary)", border: "none" },
    secondary: { background: "transparent", color: C.text, border: "1px solid " + C.border },
    quiet: { background: "transparent", color: C.secondary, border: "1px solid " + C.border },
  }[kind];
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    padding: "12px 22px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: BODY,
    fontWeight: 500,
    fontSize: 15,
    lineHeight: "20px",
    textDecoration: "none",
    ...s,
  };
};

function Btn({
  children,
  kind = "secondary",
  onClick,
  icon,
  disabled,
}: {
  children: ReactNode;
  kind?: "primary" | "secondary" | "quiet";
  onClick?: () => void;
  icon?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={"groville-focus gv-btn " + (kind === "primary" ? "gv-btn--primary" : "gv-btn--outline")}
      style={{ ...btnStyle(kind), ...(disabled ? { opacity: 0.55, cursor: "progress" } : null) }}
    >
      {children}
      {icon && <Icons name={icon} size={16} />}
    </button>
  );
}

function LinkBtn({ href, kind, children, icon }: { href: string; kind: "primary" | "secondary"; children: ReactNode; icon?: string }) {
  return (
    <Link
      href={href}
      className={"groville-focus gv-btn " + (kind === "primary" ? "gv-btn--primary" : "gv-btn--outline")}
      style={btnStyle(kind)}
    >
      {children}
      {icon && <Icons name={icon} size={16} />}
    </Link>
  );
}

/**
 * Status strip shown for every state except pending. Title / tone / icon are
 * derived from the status; the body is passed in so Flask mode injects the real
 * execution outcome or error (never a hardcoded result). Running shows the
 * indeterminate track.
 */
function StatusStrip({ status, body, reduced }: { status: DraftStatus; body: string; reduced: boolean }) {
  if (status === "pending_approval" || status === "rejected") return null;
  const meta = {
    running: { tone: "blue" as Tone, tag: "Running", title: "Running this now.", line: "var(--gv-badge-line)" },
    completed: { tone: "good" as Tone, tag: "Completed", title: "This one ran.", line: C.good },
    failed: { tone: "bad" as Tone, tag: "Failed", title: "I could not finish this.", line: C.bad },
  }[status];
  return (
    <div
      style={{
        background: C.s2,
        border: "1px solid " + meta.line,
        borderRadius: 12,
        padding: "clamp(16px, 2vw, 24px)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {status === "running" && (
          <span aria-hidden="true" className={reduced ? undefined : "gv-pulse"} style={{ width: 10, height: 10, borderRadius: 100, background: C.blue }} />
        )}
        {status === "completed" && <Icons name="tick" size={16} style={{ color: C.good }} />}
        {status === "failed" && <Icons name="cross" size={14} style={{ color: C.bad }} />}
        <span style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 16, lineHeight: "22px", color: C.text }}>{meta.title}</span>
        <span style={{ marginLeft: "auto" }}>
          <Tag tone={meta.tone}>{meta.tag}</Tag>
        </span>
      </div>
      {status === "running" && (
        <span aria-hidden="true" style={{ display: "block", width: "100%", height: 4, borderRadius: 4, background: C.border, overflow: "hidden" }}>
          <span className={reduced ? undefined : "gv-track"} style={{ display: "block", width: "38%", height: "100%", borderRadius: 4, background: C.blue }} />
        </span>
      )}
      <Body>{body}</Body>
    </div>
  );
}

/** The state's honesty microcopy shown beside the controls (or on its own). */
const PENDING_MICROCOPY = "Approving lets me run this. Nothing runs until you approve.";
const RUNNING_MICROCOPY = "I'll tell you the moment it finishes. I still publish nothing you have not approved.";

/** Control row per state. No-endpoint reference buttons (Stop this run, Undo this
 *  change) are intentionally omitted — only contract-backed controls are shown. */
function Controls({
  status,
  onApprove,
  onReject,
  onRetry,
  busy,
}: {
  status: DraftStatus;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const note = (text: string) => (
    <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.muted, textWrap: "pretty" }}>{text}</span>
  );
  if (status === "pending_approval") {
    return (
      <>
        <Btn kind="primary" onClick={onApprove} disabled={busy}>
          Approve
        </Btn>
        <Btn kind="secondary" onClick={onReject} disabled={busy}>
          Reject
        </Btn>
        {note(PENDING_MICROCOPY)}
      </>
    );
  }
  if (status === "running") return note(RUNNING_MICROCOPY);
  if (status === "completed") {
    return (
      <LinkBtn href={RESULTS_HREF} kind="primary" icon="arrow-right">
        See what it earned
      </LinkBtn>
    );
  }
  if (status === "failed") {
    return (
      <>
        <Btn kind="primary" onClick={onRetry} disabled={busy}>
          Try again
        </Btn>
        <LinkBtn href={CONNECTIONS_HREF} kind="secondary">
          Fix my access
        </LinkBtn>
      </>
    );
  }
  return null;
}

/** The drafted-action card. */
function ActionCard({
  action,
  status,
  statusBody,
  reduced,
  m,
  onApprove,
  onReject,
  onRetry,
  busy,
}: {
  action: FlaskAction;
  status: DraftStatus;
  statusBody: string;
  reduced: boolean;
  m: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <article
      className="gv-card"
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: "clamp(20px, 3vw, 32px)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <InfoTip style={{ display: "inline-flex" }} tip="The channel this draft is for. It only goes out once you approve it.">
            <Tag tone="blue">{typeLabel(action.action_type)}</Tag>
          </InfoTip>
          {status === "pending_approval" && <Tag>Awaiting your approval</Tag>}
        </div>
        <h3
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: "clamp(24px, 3vw, 34px)",
            lineHeight: 1.18,
            letterSpacing: "-0.8px",
            color: C.text,
            textWrap: "pretty",
          }}
        >
          {action.action_title}
        </h3>
      </div>

      <StatusStrip status={status} body={statusBody} reduced={reduced} />

      <div style={{ height: 1, background: C.border }} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: m ? "minmax(0,1fr)" : "minmax(0,1.3fr) minmax(0,1fr)",
          gap: m ? 24 : 32,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
          <Section label="Why I'm doing this">
            <Body>{action.reasoning}</Body>
          </Section>
          <Section label="What to watch">
            <Body>{action.expected_outcome}</Body>
          </Section>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
          <Section label="What I'll need from you">
            <Bullets items={Array.isArray(action.required_inputs) ? action.required_inputs : []} />
          </Section>
          <Confidence value={action.confidence} />
        </div>
      </div>

      <div style={{ height: 1, background: C.border }} />

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Controls status={status} onApprove={onApprove} onReject={onReject} onRetry={onRetry} busy={busy} />
      </div>
    </article>
  );
}

/** Preview-state pill row (kept in both modes — design-export affordance). */
function StatePreview({ status, setStatus }: { status: DraftStatus; setStatus: (s: DraftStatus) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>Preview state</span>
      {PREVIEW_STATES.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => setStatus(v)}
          className="groville-focus"
          style={{
            minHeight: 32,
            padding: "6px 12px",
            borderRadius: 8,
            cursor: "pointer",
            border: "1px solid " + (status === v ? C.blue : C.border),
            background: status === v ? "var(--gv-badge-fill)" : "transparent",
            fontFamily: BODY,
            fontSize: 12,
            lineHeight: "18px",
            color: status === v ? C.blueText : C.secondary,
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Header: intro, honesty line, and the parent opportunity for context. */
function Header({ oppTitle }: { oppTitle: string }) {
  const SERIF = "var(--font-serif)";
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
        Here&apos;s the campaign I{" "}
        <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400 }}>drafted</em>. You approve before anything runs.
      </h2>
      <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
        Nothing goes live until you approve it. I never publish or send on my own.
      </p>
      <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "20px", color: C.muted, textWrap: "pretty" }}>
        For:{" "}
        <Link href={OPPORTUNITIES_HREF} style={{ color: C.blueText }}>
          {oppTitle || "your selected opportunity"}
        </Link>
      </span>
    </div>
  );
}

/** The scrollable board shared by both modes. */
function Board({ children }: { children: ReactNode }) {
  const m = useIsMobile();
  return (
    <main
      style={{
        flex: 1,
        overflowY: "auto",
        padding: m ? "20px 16px 32px" : "clamp(20px, 3vw, 32px)",
        display: "flex",
        flexDirection: "column",
        gap: 32,
        minWidth: 0,
      }}
    >
      {children}
    </main>
  );
}

/** A centered status message (loading / missing / error) inside the board. */
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

/* ── Demo mode ─────────────────────────────────────────────────────────────── */

function DemoDraft() {
  const m = useIsMobile();
  const reduced = usePrefersReducedMotion();
  const router = useRouter();
  const [status, setStatus] = useState<DraftStatus>("pending_approval");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const ts = timers.current;
    return () => ts.forEach(clearTimeout);
  }, []);

  const approve = useCallback(() => {
    setStatus("running");
    if (reduced) {
      setStatus("completed");
      return;
    }
    const t = setTimeout(() => setStatus("completed"), DEMO_RUN_MS);
    timers.current.push(t);
  }, [reduced]);

  const reject = useCallback(() => router.push(OPPORTUNITIES_HREF), [router]);

  const statusBody =
    status === "completed"
      ? "I finished this run. I published nothing you had not approved, and anything I can measure will show up on your Results page."
      : status === "failed"
      ? "I could not finish this run because a channel I need is not connected yet. Nothing was published. Connect it and try again."
      : RUNNING_BODY;

  return (
    <Board>
      <Header oppTitle={DEMO_OPP_TITLE} />
      <StatePreview status={status} setStatus={setStatus} />
      <ActionCard
        action={DEMO_ACTION}
        status={status}
        statusBody={statusBody}
        reduced={reduced}
        m={m}
        onApprove={approve}
        onReject={reject}
        onRetry={approve}
        busy={false}
      />
    </Board>
  );
}

const RUNNING_BODY = "I am working through it. This runs in the background, so you can leave the page and I will keep going.";

/* ── Flask mode ────────────────────────────────────────────────────────────── */

type FetchPhase = "loading" | "missing" | "error" | "ready";

/** Read the first non-empty string among a few plausible outcome fields. The exact
 *  field name is not part of the verified contract, so this is defensive: if none
 *  is present the completed state falls back to a generic (never invented) summary. */
function execOutcomeLine(exec: FlaskExecution | null): string {
  if (!exec) return "";
  for (const k of ["summary", "result", "message", "outcome"]) {
    const v = exec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function errText(data: unknown): string {
  if (data && typeof data === "object") {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) return e.trim();
  }
  return "";
}

/** Fetch the action for this opportunity, then drive the states off its real status. */
function FlaskDraftInner({ businessId, opportunityId }: { businessId: string; opportunityId: string }) {
  const m = useIsMobile();
  const reduced = usePrefersReducedMotion();
  const router = useRouter();

  const [fetchPhase, setFetchPhase] = useState<FetchPhase>("loading");
  const [action, setAction] = useState<FlaskAction | null>(null);
  const [status, setStatus] = useState<DraftStatus>("pending_approval");
  const [execId, setExecId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string>("");
  const [outcomeLine, setOutcomeLine] = useState<string>("");
  const [oppTitle, setOppTitle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // Bumped to re-run the whole action fetch (e.g. a manual refetch on missing).
  const [refetch, setRefetch] = useState(0);

  // Normalize a backend status string to a DraftStatus the UI renders.
  const toDraftStatus = (s: string): DraftStatus => {
    const v = typeof s === "string" ? s.trim().toLowerCase() : "";
    if (v === "approved" || v === "running") return "running";
    if (v === "completed") return "completed";
    if (v === "failed") return "failed";
    if (v === "rejected") return "rejected";
    return "pending_approval";
  };

  // Fetch the action for this opportunity (broad — no status filter), retrying a
  // couple of times if generation still lags behind the opportunities render.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const MAX_TRIES = 3; // initial + 2 retries

    const attempt = () => {
      listActions(businessId).then((result) => {
        if (!active) return;
        if (!result.ok) {
          setFetchPhase("error");
          return;
        }
        const list =
          result.data && typeof result.data === "object"
            ? (result.data as { actions?: FlaskAction[] }).actions
            : null;
        const found = Array.isArray(list) ? list.find((a) => a.opportunity_id === opportunityId) : undefined;
        if (found) {
          setAction(found);
          const draft = toDraftStatus(found.status);
          setStatus(draft);
          // Resume a run already in progress using the stored execution id.
          if (draft === "running") setExecId(getExecutionId(found.id));
          // Seed the parent title if the action carries one; a fetch below refines it.
          const carried = typeof found.opportunity_title === "string" ? found.opportunity_title : "";
          if (carried) setOppTitle(carried);
          setFetchPhase("ready");
          return;
        }
        tries += 1;
        if (tries < MAX_TRIES) {
          timer = setTimeout(attempt, 2500);
        } else {
          setFetchPhase("missing");
        }
      });
    };

    // fetchPhase is already "loading" on mount, and the retry handler resets it
    // before bumping `refetch`, so the effect only kicks off the async request.
    attempt();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [businessId, opportunityId, refetch]);

  // Resolve the parent opportunity title for context (non-blocking).
  useEffect(() => {
    if (fetchPhase !== "ready") return;
    let active = true;
    getOpportunities(businessId).then((result) => {
      if (!active || !result.ok) return;
      const list =
        result.data && typeof result.data === "object"
          ? (result.data as { opportunities?: FlaskOpportunity[] }).opportunities
          : null;
      const opp = Array.isArray(list) ? list.find((o) => o.id === opportunityId) : undefined;
      if (opp?.title) setOppTitle(opp.title);
    });
    return () => {
      active = false;
    };
  }, [fetchPhase, businessId, opportunityId]);

  // Poll the execution while running and we hold its id (from approve or storage).
  useEffect(() => {
    if (status !== "running" || !execId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = () => {
      getExecution(businessId, execId).then((result) => {
        if (!active) return;
        if (!result.ok) {
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        const exec =
          result.data && typeof result.data === "object"
            ? (result.data as { execution?: FlaskExecution | null }).execution ?? null
            : null;
        const outcome = executionOutcome(exec);
        if (outcome === "completed") {
          setOutcomeLine(execOutcomeLine(exec));
          setStatus("completed");
        } else if (outcome === "failed") {
          setRunError(exec?.error ?? "");
          setStatus("failed");
        } else {
          timer = setTimeout(poll, POLL_MS);
        }
      });
    };

    timer = setTimeout(poll, POLL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [status, execId, businessId]);

  const approve = useCallback(() => {
    if (!action || busy) return;
    setBusy(true);
    setRunError("");
    approveAction(businessId, action.id).then((result) => {
      setBusy(false);
      // execution_id is returned on the 202 success path AND on the 500
      // "approved but couldn't queue" path.
      const eid =
        result.data && typeof result.data === "object"
          ? (result.data as { execution_id?: unknown }).execution_id
          : undefined;
      const executionId = typeof eid === "string" && eid.trim() ? eid.trim() : null;
      // On success (202/ok) or already_approved: persist the id and start polling.
      if (result.status === 202 || result.ok) {
        if (executionId) {
          setExecutionId(action.id, executionId);
          setExecId(executionId);
        }
        setStatus("running");
        return;
      }
      // A 500 can mean "approved but execution couldn't queue" and still returns
      // execution_id — keep it, but show the failed state with the error.
      if (executionId) {
        setExecutionId(action.id, executionId);
        setExecId(executionId);
      }
      setRunError(errText(result.data) || "I could not start this run. Please try again.");
      setStatus("failed");
    });
  }, [action, businessId, busy]);

  const reject = useCallback(() => {
    if (!action || busy) return;
    setBusy(true);
    rejectAction(businessId, action.id).then(() => {
      router.push(OPPORTUNITIES_HREF);
    });
  }, [action, businessId, busy, router]);

  if (fetchPhase === "loading") {
    return (
      <CenteredNote>
        <span style={{ fontSize: 14, color: C.muted }}>Finishing your draft…</span>
      </CenteredNote>
    );
  }

  if (fetchPhase === "error") {
    return (
      <CenteredNote>
        <Icons name="alert-triangle" size={24} style={{ color: C.muted }} />
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>I couldn&apos;t load your draft</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>Something went wrong reaching the server. Give it another try.</span>
        <button
          type="button"
          onClick={() => {
            setFetchPhase("loading");
            setRefetch((n) => n + 1);
          }}
          style={btnStyle("primary")}
          className="groville-focus gv-btn gv-btn--primary"
        >
          Try again
        </button>
      </CenteredNote>
    );
  }

  if (fetchPhase === "missing" || !action) {
    return (
      <CenteredNote>
        <span style={MONO_EYEBROW}>Groville</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>No draft for this one yet</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          I haven&apos;t drafted an action for this opportunity yet. Head back and pick one, and I&apos;ll show you the plan.
        </span>
        <Link href={OPPORTUNITIES_HREF} style={{ ...btnStyle("primary"), textDecoration: "none" }} className="groville-focus gv-btn gv-btn--primary">
          Back to opportunities
        </Link>
      </CenteredNote>
    );
  }

  if (status === "rejected") {
    return (
      <CenteredNote>
        <Icons name="cross" size={20} style={{ color: C.muted }} />
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>You passed on this draft</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Nothing ran. When you want a different move, the other opportunities are waiting.
        </span>
        <Link href={OPPORTUNITIES_HREF} style={{ ...btnStyle("primary"), textDecoration: "none" }} className="groville-focus gv-btn gv-btn--primary">
          Back to opportunities
        </Link>
      </CenteredNote>
    );
  }

  // Body copy per state: reflect the REAL backend outcome/error, never a pretend result.
  const statusBody =
    status === "completed"
      ? outcomeLine || "I finished this run. I published nothing you had not approved, and anything I can measure will show up on your Results page."
      : status === "failed"
      ? runError || "I could not finish this run. Nothing was published. Check the details and try again."
      : status === "running" && !execId
      ? "This run is already in progress. It runs in the background, so you can leave the page and come back."
      : RUNNING_BODY;

  return (
    <Board>
      <Header oppTitle={oppTitle} />
      <StatePreview status={status} setStatus={setStatus} />
      <ActionCard
        action={action}
        status={status}
        statusBody={statusBody}
        reduced={reduced}
        m={m}
        onApprove={approve}
        onReject={reject}
        onRetry={approve}
        busy={busy}
      />
    </Board>
  );
}

/** Flask wrapper: resolve the current business, then load + drive the action. */
function FlaskDraft({ opportunityId }: { opportunityId: string }) {
  const business = useBusiness();

  if (business.status === "loading") {
    return (
      <CenteredNote>
        <span style={{ fontSize: 14, color: C.muted }}>Loading your dashboard…</span>
      </CenteredNote>
    );
  }

  if (business.status === "none" || !business.businessId) {
    return (
      <CenteredNote>
        <span style={MONO_EYEBROW}>Groville</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>Add your website first</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Once I&apos;ve read your site and found the gaps, the campaign I&apos;d run shows up here for your approval.
        </span>
        <Link href="/onboarding" style={{ ...btnStyle("primary"), textDecoration: "none" }} className="groville-focus">
          Add your website
        </Link>
      </CenteredNote>
    );
  }

  if (!opportunityId) {
    return (
      <CenteredNote>
        <span style={MONO_EYEBROW}>Groville</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>Pick an opportunity first</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Open an opportunity and choose &quot;Draft the campaign&quot; and I&apos;ll show you the plan for it here.
        </span>
        <Link href={OPPORTUNITIES_HREF} style={{ ...btnStyle("primary"), textDecoration: "none" }} className="groville-focus">
          See opportunities
        </Link>
      </CenteredNote>
    );
  }

  return <FlaskDraftInner businessId={business.businessId} opportunityId={opportunityId} />;
}

/**
 * Full Campaign draft screen inside the shared dashboard shell. isFlaskConfigured()
 * is stable per session (build-time env), so this branch never changes hook order.
 */
export function CampaignDraftScreen({ opportunityId = "" }: { opportunityId?: string }) {
  return (
    <DashboardShell active="Campaigns" title="Campaign draft" chips={<Chip>Draft · not published</Chip>}>
      {isFlaskConfigured() ? <FlaskDraft opportunityId={opportunityId} /> : <DemoDraft />}
    </DashboardShell>
  );
}
