"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icons } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW, DashboardShell } from "./shell";
import { useIsMobile, usePrefersReducedMotion } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import { StepRow } from "./Analysing";
import {
  gtmRun,
  gtmListRuns,
  gtmGetRun,
  gtmGetDossier,
  type FlaskGtmRun,
  type GtmTile,
  type ApiResult,
  type DossierResult,
} from "@/lib/api";

/**
 * GTM / PixelRAG — the go-to-market audit surface. I screenshot the business's
 * site and its competitors, score the go-to-market surface (five gauges), name the
 * blind spots, and draft a recommendation the owner reads and acts on.
 *
 * The render is an ASYNC ~90s job: POST /api/gtm/run → 202, then poll
 * GET /api/gtm/runs/<id> every 15s through queued → running until completed|failed.
 * Mirrors the trigger→poll discipline of Opportunities.tsx (reqId/alive/pollTimer
 * refs, clean teardown) and reuses the honest scan visual from Analysing.tsx.
 *
 * Honesty boundary (never break): the dossier is a DRAFT recommendation — review
 * before acting. Nothing is sent, published or executed on its own.
 *
 * Data / env safety: only the "ready" business path makes network calls; demo
 * (no backend) and no-business states render a short note with ZERO fetches, so
 * the build passes with no env set. Flat solid surfaces, dashboard `C` tokens,
 * both themes, mobile-pill / desktop rounded-rect buttons, no em dashes.
 */

const SERIF = "var(--font-serif)";
const ONBOARDING_HREF = "/onboarding";

/** Agent-voice scan steps for the GTM render. Honest scope (capture → score →
 *  draft), no invented metrics; the job takes a minute or two, never instant. */
const GTM_STEPS = [
  "Capturing your site",
  "Capturing your competitors",
  "Scoring your go-to-market",
  "Drafting your recommendation",
] as const;

// Poll cadence + ceiling. 15s × 40 = 10 min, comfortably above the ~90s job while
// bounding a stuck run so the poller never spins forever.
const POLL_INTERVAL_MS = 15000;
const POLL_MAX_TICKS = 40;

/** The five go-to-market score fields, in display order, with humanized labels. */
const SCORE_FIELDS: [key: keyof NonNullable<FlaskGtmRun["gtm_scores"]>, label: string][] = [
  ["overall", "Overall"],
  ["above_the_fold", "Above the fold"],
  ["pricing_clarity", "Pricing clarity"],
  ["social_proof", "Social proof"],
  ["cro_friction", "CRO friction"],
];

/* ── Shared text styles (mirrors Connections.tsx) ──────────────────────────── */

const NOTE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: BODY,
  fontSize: 13,
  lineHeight: "19px",
  color: C.muted,
  textWrap: "pretty",
};

const SUBHEAD_STYLE: CSSProperties = {
  fontFamily: DISPLAY,
  fontWeight: 500,
  fontSize: 14,
  lineHeight: "20px",
  color: C.text,
};

const primaryBtn = (m: boolean, disabled = false): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  padding: "12px 22px",
  width: m ? "100%" : undefined,
  borderRadius: m ? 999 : 10,
  border: "none",
  background: C.blue,
  color: C.onPrimary,
  fontFamily: BODY,
  fontWeight: 500,
  fontSize: 15,
  lineHeight: "20px",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  whiteSpace: "nowrap",
});

const secondaryBtn = (m: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  padding: "12px 22px",
  width: m ? "100%" : undefined,
  borderRadius: m ? 999 : 10,
  border: "1px solid " + C.border,
  background: "transparent",
  color: C.text,
  fontFamily: BODY,
  fontWeight: 500,
  fontSize: 15,
  lineHeight: "20px",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

/* ── Small building blocks ─────────────────────────────────────────────────── */

/** A flat card surface (no glass), matching the other dashboards. */
function Card({ children, m }: { children: ReactNode; m: boolean }) {
  return (
    <article
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: m ? 20 : 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {children}
    </article>
  );
}

/** One go-to-market score as a flat horizontal gauge. Value is clamped to 0–100;
 *  the fill transition is suppressed under reduced motion. No invented colors. */
function ScoreGauge({ label, value, reduced }: { label: string; value: number; reduced: boolean }) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.secondary }}>{label}</span>
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 15,
            lineHeight: "20px",
            color: C.text,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(safe)}
          <span style={{ fontFamily: BODY, fontWeight: 400, fontSize: 12, color: C.muted }}> / 100</span>
        </span>
      </div>
      <span
        role="progressbar"
        aria-valuenow={Math.round(safe)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        style={{ display: "block", width: "100%", height: 8, borderRadius: 8, background: C.border, overflow: "hidden" }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: safe + "%",
            borderRadius: 8,
            background: C.blue,
            transition: reduced ? "none" : "width .5s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </span>
    </div>
  );
}

/** A single screenshot tile. Prefer the durable Supabase `url` when present;
 *  otherwise fall back to the relative `path` served off the backend's ephemeral
 *  disk through the Next rewrite proxy. Tiles on ephemeral disk may be gone —
 *  onError hides the broken image rather than showing a torn placeholder. */
function TileImage({ tile, alt }: { tile: GtmTile; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  const src = typeof tile.url === "string" && tile.url ? tile.url : `/api/backend/${tile.path}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ display: "block", width: "100%", height: "auto", borderBottom: "1px solid " + C.border }}
    />
  );
}

/** A vertical stack of a site's tiles (scroll slices reconstruct the page). When
 *  there are no tiles, a clear note stands in — never a broken-image look. */
function TileStack({ tiles, labelPrefix }: { tiles: GtmTile[] | undefined; labelPrefix: string }) {
  const list = Array.isArray(tiles) ? [...tiles].sort((a, b) => a.index - b.index) : [];
  if (list.length === 0) {
    return <p style={NOTE_STYLE}>Visual capture unavailable for this run.</p>;
  }
  return (
    <div
      style={{
        border: "1px solid " + C.border,
        borderRadius: 12,
        overflow: "hidden",
        maxHeight: 480,
        overflowY: "auto",
        background: C.s2,
      }}
    >
      {list.map((tile) => (
        <TileImage key={tile.index + "-" + tile.filename} tile={tile} alt={`${labelPrefix} screenshot, section ${tile.index + 1}`} />
      ))}
    </div>
  );
}

/** One labeled column of competitor insights (strengths OR weaknesses). Each item
 *  carries a small colored marker — success for strengths, error for weaknesses —
 *  so the two read apart at a glance without inventing new colors. */
function InsightColumn({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: 13,
          lineHeight: "18px",
          color: C.text,
        }}
      >
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 100, background: color, flexShrink: 0 }} />
        {label}
      </span>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, idx) => (
          <li
            key={idx}
            style={{
              display: "flex",
              gap: 8,
              fontFamily: BODY,
              fontSize: 13,
              lineHeight: "19px",
              color: C.secondary,
              textWrap: "pretty",
            }}
          >
            <span aria-hidden="true" style={{ color: C.muted, flexShrink: 0 }}>·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Competitor strengths / weaknesses, surfaced on each competitor card. Both lists
 *  are optional (older runs and empty analyses omit them), so this renders nothing
 *  when there's nothing to show — the screenshot capture still stands on its own.
 *  Side-by-side on desktop, stacked on mobile. */
function CompetitorInsights({
  strengths,
  weaknesses,
  m,
}: {
  strengths: string[] | undefined;
  weaknesses: string[] | undefined;
  m: boolean;
}) {
  const clean = (list: string[] | undefined) =>
    Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.trim()) : [];
  const s = clean(strengths);
  const w = clean(weaknesses);
  if (s.length === 0 && w.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: m ? 16 : 24 }}>
      {s.length > 0 && <InsightColumn label="What they do well" items={s} color={C.good} />}
      {w.length > 0 && <InsightColumn label="Where they're weak" items={w} color={C.bad} />}
    </div>
  );
}

/* ── Tiny inline markdown renderer (no library installed) ──────────────────── */

/** Render inline markdown: **bold**, [text](url), `code`. Builds React nodes (no
 *  dangerouslySetInnerHTML). Links are limited to http(s)/mailto/relative. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${i++}`;
    if (match[1]) {
      nodes.push(<strong key={key} style={{ fontWeight: 600, color: C.text }}>{match[2]}</strong>);
    } else if (match[3]) {
      const url = match[5];
      const safe = /^(https?:|mailto:|\/)/i.test(url) ? url : undefined;
      nodes.push(
        safe ? (
          <a key={key} href={safe} target="_blank" rel="noreferrer noopener" style={{ color: C.blueText, textDecoration: "none" }}>
            {match[4]}
          </a>
        ) : (
          match[4]
        ),
      );
    } else if (match[6]) {
      nodes.push(
        <code
          key={key}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.9em", background: C.s2, padding: "1px 5px", borderRadius: 4 }}
        >
          {match[7]}
        </code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Split a markdown table row into trimmed cells, dropping the empty edges from
 *  leading/trailing pipes. */
function splitTableRow(row: string): string[] {
  const cells = row.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** A hand-rolled, line-based markdown block renderer: headings, bold, tables,
 *  lists (ordered + unordered), links and paragraphs. Deliberately small — a
 *  lightweight converter, not a full CommonMark implementation. */
function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
  const isSeparator = (s: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(s) && s.includes("-");

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading (# .. ######).
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const size = level <= 1 ? 22 : level === 2 ? 18 : 15;
      blocks.push(
        <p
          key={key++}
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 1.3,
            color: C.text,
            textWrap: "pretty",
          }}
        >
          {renderInline(heading[2], "h" + key)}
        </p>,
      );
      i++;
      continue;
    }

    // Table: a header row, an optional separator, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // consume header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} style={{ overflowX: "auto", border: "1px solid " + C.border, borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BODY, fontSize: 13 }}>
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      borderBottom: "1px solid " + C.border,
                      color: C.text,
                      fontFamily: DISPLAY,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderInline(cell, `th-${key}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, c) => (
                    <td
                      key={c}
                      style={{
                        padding: "8px 12px",
                        borderBottom: ri === rows.length - 1 ? "none" : "1px solid " + C.border,
                        color: C.secondary,
                        verticalAlign: "top",
                      }}
                    >
                      {renderInline(r[c] ?? "", `td-${key}-${ri}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // List (unordered - / * or ordered 1.).
    const unordered = /^\s*[-*]\s+/.test(line);
    const ordered = /^\s*\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (unordered && /^\s*[-*]\s+/.test(l)) {
          items.push(l.replace(/^\s*[-*]\s+/, ""));
          i++;
        } else if (ordered && /^\s*\d+\.\s+/.test(l)) {
          items.push(l.replace(/^\s*\d+\.\s+/, ""));
          i++;
        } else {
          break;
        }
      }
      const listStyle: CSSProperties = {
        margin: 0,
        paddingLeft: 22,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: BODY,
        fontSize: 14,
        lineHeight: "21px",
        color: C.secondary,
      };
      blocks.push(
        ordered ? (
          <ol key={key++} style={listStyle}>
            {items.map((it, idx) => (
              <li key={idx} style={{ textWrap: "pretty" }}>
                {renderInline(it, `li-${key}-${idx}`)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={key++} style={listStyle}>
            {items.map((it, idx) => (
              <li key={idx} style={{ textWrap: "pretty" }}>
                {renderInline(it, `li-${key}-${idx}`)}
              </li>
            ))}
          </ul>
        ),
      );
      continue;
    }

    // Paragraph: accumulate consecutive plain lines.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "22px", color: C.secondary, textWrap: "pretty" }}>
        {renderInline(para.join(" "), "p" + key)}
      </p>,
    );
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{blocks}</div>;
}

/* ── Scan / progress board (reuses the Analysing visual + StepRow) ─────────── */

function GtmAnalyzingBoard() {
  const m = useIsMobile();
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(reduced ? GTM_STEPS.length - 1 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => {
      setActive((a) => (a < GTM_STEPS.length - 1 ? a + 1 : a));
    }, 3000);
    return () => window.clearInterval(t);
  }, [reduced]);

  // Cosmetic only: ramps but never reaches 100% (the real poll swaps the view).
  const progress = Math.round(((active + 1) / (GTM_STEPS.length + 1)) * 100);

  return (
    <div
      style={{
        margin: "0 auto",
        width: "100%",
        maxWidth: 520,
        boxSizing: "border-box",
        padding: m ? "16px 0" : "24px 0",
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
          <Icons name="audit" size={22} style={{ color: "#fff" }} />
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
          <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>market</em>.
        </h2>
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 15, lineHeight: "22px", color: C.secondary }}>
          I&apos;m capturing your site and your competitors and scoring the go-to-market. This usually takes a minute or two.
        </p>
      </div>

      {/* Cosmetic progress bar */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <span
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="GTM analysis in progress"
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

      {/* Stepped checklist (shared StepRow with the /analysing screen) */}
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
        {GTM_STEPS.map((label, idx) => {
          const state: "pending" | "active" | "done" = idx < active ? "done" : idx === active ? "active" : "pending";
          return <StepRow key={label} label={label} state={state} />;
        })}
      </div>

      <p style={{ margin: 0, fontFamily: BODY, fontSize: 12, lineHeight: "18px", color: C.muted, maxWidth: 420 }}>
        I only read and draft. Nothing goes live until you approve it.
      </p>
    </div>
  );
}

/* ── Runs history ──────────────────────────────────────────────────────────── */

/** Short, readable date for a run row. Falls back to the raw string if unparseable. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A status badge mirroring the dashboards' chip look. */
function RunStatusBadge({ status }: { status: FlaskGtmRun["status"] }) {
  const label =
    status === "completed" ? "Completed" : status === "failed" ? "Failed" : status === "running" ? "Running" : "Queued";
  const color = status === "completed" ? C.good : status === "failed" ? C.bad : C.muted;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        border: "1px solid " + C.border,
        fontFamily: BODY,
        fontSize: 12,
        lineHeight: "16px",
        color,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 100, background: color }} />
      {label}
    </span>
  );
}

function RunsHistory({
  runs,
  activeRunId,
  onOpen,
}: {
  runs: FlaskGtmRun[];
  activeRunId: string | null;
  onOpen: (run: FlaskGtmRun) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={SUBHEAD_STYLE}>Past runs</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {runs.map((run) => {
          const done = run.status === "completed";
          const overall = run.gtm_scores?.overall;
          const selected = run.id === activeRunId;
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => done && onOpen(run)}
              disabled={!done}
              aria-pressed={selected}
              className="gv-nav-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                borderRadius: 12,
                cursor: done ? "pointer" : "default",
                background: selected ? C.s2 : "transparent",
                border: "1px solid " + (selected ? C.blueText : C.border),
                fontFamily: BODY,
              }}
            >
              <RunStatusBadge status={run.status} />
              <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.secondary, minWidth: 0, flex: 1 }}>
                {fmtDate(run.created_at)}
              </span>
              {done && typeof overall === "number" && (
                <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 13, color: C.text, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(overall)}
                  <span style={{ fontFamily: BODY, fontWeight: 400, color: C.muted }}> / 100</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Result view ───────────────────────────────────────────────────────────── */

type DossierState = { kind: "loading" } | { kind: "ready"; text: string } | { kind: "empty" };

function GtmResult({ run, dossier, m, reduced }: { run: FlaskGtmRun; dossier: DossierState; m: boolean; reduced: boolean }) {
  const scores = run.gtm_scores;
  const blindSpots = Array.isArray(run.blind_spots) ? run.blind_spots.filter((s) => typeof s === "string" && s.trim()) : [];
  const competitors = Array.isArray(run.competitors_analyzed) ? run.competitors_analyzed : [];
  const userTiles = run.user_manifest?.tiles;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: m ? 20 : 24 }}>
      {/* Scores */}
      <Card m={m}>
        <span style={SUBHEAD_STYLE}>Go-to-market scores</span>
        {scores ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {SCORE_FIELDS.map(([k, label]) => (
              <ScoreGauge key={k} label={label} value={scores[k]} reduced={reduced} />
            ))}
          </div>
        ) : (
          <p style={NOTE_STYLE}>Scores unavailable for this run.</p>
        )}
      </Card>

      {/* Blind spots */}
      {blindSpots.length > 0 && (
        <Card m={m}>
          <span style={SUBHEAD_STYLE}>Blind spots I found</span>
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {blindSpots.map((spot, idx) => (
              <li key={idx} style={{ fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
                {spot}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Your site capture */}
      <Card m={m}>
        <span style={SUBHEAD_STYLE}>Your site</span>
        <TileStack tiles={userTiles} labelPrefix="Your site" />
      </Card>

      {/* Competitors */}
      {competitors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: m ? 20 : 24 }}>
          <span style={SUBHEAD_STYLE}>Competitors I looked at</span>
          {competitors.map((comp, idx) => (
            <Card key={(comp.domain || "") + idx} m={m}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 16, lineHeight: "22px", color: C.text }}>
                  {comp.domain || "Competitor"}
                </span>
                {comp.url && (
                  <a
                    href={/^https?:\/\//i.test(comp.url) ? comp.url : undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.blueText, textDecoration: "none", wordBreak: "break-all" }}
                  >
                    {comp.url}
                  </a>
                )}
              </div>
              <CompetitorInsights strengths={comp.strengths} weaknesses={comp.weaknesses} m={m} />
              <TileStack tiles={comp.manifest?.tiles} labelPrefix={comp.domain || "Competitor"} />
            </Card>
          ))}
        </div>
      )}

      {/* Dossier — the draft recommendation */}
      <Card m={m}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={SUBHEAD_STYLE}>Groville&apos;s draft recommendation</span>
          <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "17px", color: C.muted }}>
            Review before acting. This is a draft I wrote for you · nothing is sent, published or run on its own.
          </span>
        </div>
        {dossier.kind === "loading" ? (
          <p style={NOTE_STYLE}>Reading your recommendation…</p>
        ) : dossier.kind === "ready" ? (
          <Markdown source={dossier.text} />
        ) : (
          <p style={NOTE_STYLE}>The recommendation is unavailable for this run.</p>
        )}
      </Card>
    </div>
  );
}

/* ── Flask machine ─────────────────────────────────────────────────────────── */

type View =
  | { kind: "idle" }
  | { kind: "running"; runId: string }
  | { kind: "failed"; error: string }
  | { kind: "completed"; run: FlaskGtmRun };

/** The latest GTM run from GET /runs/<id>, or null when the fetch failed. */
function extractRun(res: ApiResult): FlaskGtmRun | null {
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const run = (res.data as { run?: FlaskGtmRun | null }).run;
  return run ?? null;
}

/** The runs list from GET /runs, newest first, or [] when the fetch failed. */
function extractRuns(res: ApiResult): FlaskGtmRun[] {
  if (!res.ok || !res.data || typeof res.data !== "object") return [];
  const list = (res.data as { runs?: FlaskGtmRun[] }).runs;
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

function FlaskGtm({ businessId, websiteUrl }: { businessId: string; websiteUrl: string | null }) {
  const m = useIsMobile();
  const reduced = usePrefersReducedMotion();

  const [view, setView] = useState<View>({ kind: "idle" });
  const [runs, setRuns] = useState<FlaskGtmRun[]>([]);
  const [dossier, setDossier] = useState<DossierState>({ kind: "loading" });
  const [starting, setStarting] = useState(false);

  // Stale-result guard (business change / retry), poll handle, and unmount flag.
  const reqId = useRef(0);
  const pollTimer = useRef<number | null>(null);
  const pollTicks = useRef(0);
  const alive = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current != null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    pollTicks.current = 0;
  }, []);

  const refreshRuns = useCallback(async () => {
    const list = extractRuns(await gtmListRuns(businessId));
    if (!alive.current) return;
    setRuns(list);
  }, [businessId]);

  // Load a completed run into the result view (fetches its dossier as text).
  const openCompleted = useCallback(
    async (run: FlaskGtmRun) => {
      stopPolling();
      setView({ kind: "completed", run });
      setDossier({ kind: "loading" });
      const token = ++reqId.current;
      const res: DossierResult = await gtmGetDossier(run.id, businessId);
      if (!alive.current || token !== reqId.current) return;
      setDossier(res.ok && res.text.trim() ? { kind: "ready", text: res.text } : { kind: "empty" });
    },
    [businessId, stopPolling],
  );

  // Poll a running run to completion. On terminal status swaps the view and
  // refreshes the history; a ceiling bounds a stuck run.
  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      pollTicks.current = 0;
      pollTimer.current = window.setInterval(async () => {
        pollTicks.current += 1;
        const res = await gtmGetRun(runId, businessId);
        if (!alive.current) {
          stopPolling();
          return;
        }
        const run = extractRun(res);
        if (run && run.status === "completed") {
          stopPolling();
          void refreshRuns();
          void openCompleted(run);
          return;
        }
        if (run && run.status === "failed") {
          stopPolling();
          void refreshRuns();
          setView({ kind: "failed", error: typeof run.error === "string" ? run.error : "" });
          return;
        }
        if (pollTicks.current >= POLL_MAX_TICKS) {
          stopPolling();
          setView({ kind: "failed", error: "This is taking longer than usual. You can run the analysis again." });
        }
      }, POLL_INTERVAL_MS);
    },
    [businessId, stopPolling, refreshRuns, openCompleted],
  );

  // Mount: load the history; if a run is already in flight, resume polling it.
  useEffect(() => {
    alive.current = true;
    const kickoff = window.setTimeout(async () => {
      const list = extractRuns(await gtmListRuns(businessId));
      if (!alive.current) return;
      setRuns(list);
      const inFlight = list.find((r) => r.status === "queued" || r.status === "running");
      if (inFlight) {
        setView({ kind: "running", runId: inFlight.id });
        startPolling(inFlight.id);
      }
    }, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(kickoff);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async () => {
    if (starting || !websiteUrl) return;
    setStarting(true);
    const res = await gtmRun(businessId);
    if (!alive.current) return;
    setStarting(false);
    const runId =
      res.data && typeof res.data === "object" ? (res.data as { run_id?: string }).run_id : undefined;
    if ((res.status === 202 || res.ok) && typeof runId === "string" && runId) {
      setView({ kind: "running", runId });
      void refreshRuns();
      startPolling(runId);
      return;
    }
    const msg =
      res.data && typeof res.data === "object" && typeof (res.data as { error?: string }).error === "string"
        ? (res.data as { error?: string }).error
        : "";
    setView({ kind: "failed", error: msg || "I couldn't start the analysis. Give it another try." });
  }, [businessId, websiteUrl, starting, refreshRuns, startPolling]);

  // ── Render ──
  if (view.kind === "running") {
    return (
      <main style={{ flex: 1, overflowY: "auto", background: C.bg }}>
        <div style={{ padding: m ? "24px 16px 40px" : "32px 40px 48px", display: "flex", flexDirection: "column" }}>
          <GtmAnalyzingBoard />
        </div>
      </main>
    );
  }

  const header = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 }}>
      <span style={MONO_EYEBROW}>GTM</span>
      <h2
        style={{
          margin: 0,
          fontFamily: DISPLAY,
          fontWeight: 500,
          fontSize: m ? 22 : 26,
          lineHeight: m ? "30px" : "34px",
          letterSpacing: "-0.3px",
          color: C.text,
          textWrap: "pretty",
        }}
      >
        Let me score your go-to-market against your{" "}
        <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>competitors</em>.
      </h2>
      <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
        I capture your site and your competitors, score the surface, name the blind spots, and draft a recommendation you
        review. Nothing goes live on its own.
      </p>
    </div>
  );

  let body: ReactNode;
  if (view.kind === "idle") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button type="button" onClick={run} disabled={!websiteUrl || starting} style={primaryBtn(m, !websiteUrl || starting)}>
          <Icons name="audit" size={16} />
          {starting ? "Starting…" : "Run GTM analysis"}
        </button>
        {!websiteUrl && (
          <p style={NOTE_STYLE}>
            I need your website first.{" "}
            <Link href={ONBOARDING_HREF} style={{ color: C.blueText, textDecoration: "none" }}>
              Add it in onboarding
            </Link>{" "}
            and then I can run the analysis.
          </p>
        )}
        <RunsHistory runs={runs} activeRunId={null} onOpen={(r) => void openCompleted(r)} />
      </div>
    );
  } else if (view.kind === "failed") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icons name="alert-triangle" size={20} style={{ color: C.muted }} />
          <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, color: C.text }}>The analysis didn&apos;t finish</span>
        </div>
        {view.error && <p style={{ ...NOTE_STYLE, color: C.secondary }}>{view.error}</p>}
        <button type="button" onClick={run} disabled={!websiteUrl || starting} style={primaryBtn(m, !websiteUrl || starting)}>
          {starting ? "Starting…" : "Try again"}
        </button>
        <RunsHistory runs={runs} activeRunId={null} onOpen={(r) => void openCompleted(r)} />
      </div>
    );
  } else {
    // completed
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: m ? 24 : 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: BODY, fontSize: 13, color: C.muted }}>Run from {fmtDate(view.run.created_at)}</span>
          <button type="button" onClick={run} disabled={!websiteUrl || starting} style={secondaryBtn(m)}>
            {starting ? "Starting…" : "Run a new analysis"}
          </button>
        </div>
        <GtmResult run={view.run} dossier={dossier} m={m} reduced={reduced} />
        <RunsHistory runs={runs} activeRunId={view.run.id} onOpen={(r) => void openCompleted(r)} />
      </div>
    );
  }

  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <div style={{ padding: m ? "24px 16px 40px" : "32px 40px 48px", display: "flex", flexDirection: "column", gap: m ? 24 : 32 }}>
        {header}
        {body}
      </div>
    </main>
  );
}

/* ── Non-ready / demo states (no network calls) ────────────────────────────── */

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
          gap: 14,
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </main>
  );
}

/**
 * GTM screen inside the shared dashboard shell. Only the "ready" business path runs
 * the real GTM surface; demo (no backend) and no-business states render a short
 * note with zero network calls, so the build passes with no env set.
 */
export function GtmScreen() {
  const business = useBusiness();

  let body: ReactNode;
  if (business.status === "loading") {
    body = (
      <CenteredNote>
        <span style={{ fontSize: 14, color: C.muted }}>Loading your dashboard…</span>
      </CenteredNote>
    );
  } else if (business.status === "demo") {
    body = (
      <CenteredNote>
        <span style={MONO_EYEBROW}>GTM</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>Connect a backend to run GTM</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          The go-to-market analysis runs against the live backend. Sign in with a connected environment and add your business
          to run it on your real site.
        </span>
      </CenteredNote>
    );
  } else if (business.status === "ready" && business.businessId) {
    body = <FlaskGtm businessId={business.businessId} websiteUrl={business.business?.website_url ?? null} />;
  } else {
    // status === "none": signed in, no business yet.
    body = (
      <CenteredNote>
        <span style={MONO_EYEBROW}>GTM</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: C.text }}>I need a business first</span>
        <span style={{ fontSize: 14, lineHeight: "21px", color: C.secondary }}>
          Add your website in onboarding and then I can score your go-to-market.
        </span>
        <Link href={ONBOARDING_HREF} style={{ color: C.blueText, textDecoration: "none", fontFamily: BODY, fontSize: 14 }}>
          Go to onboarding
        </Link>
      </CenteredNote>
    );
  }

  return (
    <DashboardShell active="GTM" title="GTM" chips={false}>
      {body}
    </DashboardShell>
  );
}
