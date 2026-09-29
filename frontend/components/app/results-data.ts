import type { CSSProperties } from "react";
import { C, DISPLAY } from "./shell";
import type { FlaskMeasurement, FlaskLearning } from "@/lib/api";

/**
 * Shared model for the Results screen — ported from the Claude Design export
 * (docs/results-real-reference.html). One card design serves both the real
 * Flask data and the demo loop, so the maps + the sample measurements/learnings
 * live here, apart from the presentational component.
 *
 * Everything is a REAL measured field: a metric name, a previous_value → value
 * transition, a direction, an outcome, a confidence and the agent's learning.
 * No keyword / search-volume / rank / clicks data appears anywhere.
 */

/** Section eyebrow style (Space Grotesk, uppercase, tracked) — matches the reference SubHead. */
export const SUBHEAD_STYLE: CSSProperties = {
  fontFamily: DISPLAY,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: C.muted,
};

/** Direction indicator — a text label plus a glyph (never colour alone). */
export type DirectionMeta = { label: string; glyph: string };

export const DIRECTION: Record<string, DirectionMeta> = {
  increase: { label: "Increase", glyph: "↑" },
  decrease: { label: "Decrease", glyph: "↓" },
  unchanged: { label: "Unchanged", glyph: "→" },
};

/** Direction meta for a value, defaulting to `unchanged` for anything unexpected. */
export function directionMeta(direction: string): DirectionMeta {
  return DIRECTION[direction] ?? DIRECTION.unchanged;
}

/** Outcome badge styling. Tints derive from the success / error tokens via color-mix. */
export type OutcomeMeta = { label: string; ink: string; line: string; fill: string };

const POSITIVE: OutcomeMeta = {
  label: "Positive",
  ink: "var(--success)",
  line: "color-mix(in oklab, var(--success) 40%, transparent)",
  fill: "color-mix(in oklab, var(--success) 12%, transparent)",
};
const NEGATIVE: OutcomeMeta = {
  label: "Negative",
  ink: "var(--error)",
  line: "color-mix(in oklab, var(--error) 40%, transparent)",
  fill: "color-mix(in oklab, var(--error) 12%, transparent)",
};
const NEUTRAL: OutcomeMeta = {
  label: "Neutral",
  ink: C.secondary,
  line: C.border,
  fill: "transparent",
};

/**
 * Map an outcome to its badge styling. The contract's canonical values are
 * positive | negative | neutral; the backend may also send success | failure |
 * measured, which map onto the same three. Unknown → neutral.
 */
export const OUTCOME: Record<string, OutcomeMeta> = {
  positive: POSITIVE,
  success: POSITIVE,
  negative: NEGATIVE,
  failure: NEGATIVE,
  neutral: NEUTRAL,
  measured: NEUTRAL,
};

export function outcomeMeta(outcome: string): OutcomeMeta {
  return OUTCOME[outcome] ?? NEUTRAL;
}

/** Confidence label derived from the 0.0–1.0 score, plus a rounded percent. */
export function confidenceOf(c: number): { label: string; pct: number } {
  const pct = Math.round((Number.isFinite(c) ? c : 0) * 100);
  if (c >= 0.7) return { label: "High confidence", pct };
  if (c >= 0.4) return { label: "Medium confidence", pct };
  return { label: "Low confidence", pct };
}

/** True when a reading has no prior value to compare against (first measurement). */
export function isFirst(previousValue: number | null | undefined): boolean {
  return previousValue === null || previousValue === undefined;
}

/** Render a numeric reading for display. The contract carries no unit, so the value stands alone. */
export function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Find the learning that belongs to a measurement. Prefer the explicit
 * measurement_id link; fall back to the metric name (older records, or a
 * learning derived before ids were wired).
 */
export function matchLearning(
  measurement: FlaskMeasurement,
  learnings: FlaskLearning[],
): FlaskLearning | undefined {
  return (
    learnings.find((l) => l.measurement_id && l.measurement_id === measurement.id) ??
    learnings.find((l) => l.metric === measurement.metric)
  );
}

/**
 * Demo-mode data (no NEXT_PUBLIC_API_BASE). A small real-shaped sample from the
 * design reference — real fields only, no invented or keyword/rank/clicks
 * metrics — so the demo loop renders the exact same cards as the live pipeline.
 * Stable ids are synthetic (demo-*); each learning links to its measurement.
 */
export const DEMO_MEASUREMENTS: FlaskMeasurement[] = [
  {
    id: "demo-m-contact",
    execution_id: "demo-exec",
    action_id: "demo-action",
    metric: "Contact form submissions",
    value: 14,
    previous_value: 9,
    source: "Google Analytics",
    measured_at: "21 Sep 2026",
  },
  {
    id: "demo-m-time",
    execution_id: "demo-exec",
    action_id: "demo-action",
    metric: "Homepage time on page",
    value: 74,
    previous_value: 61,
    source: "Google Analytics",
    measured_at: "21 Sep 2026",
  },
  {
    id: "demo-m-scroll",
    execution_id: "demo-exec",
    action_id: "demo-action",
    metric: "Reviews section scroll depth",
    value: 46,
    previous_value: null,
    source: "Google Analytics",
    measured_at: "21 Sep 2026",
  },
];

export const DEMO_LEARNINGS: FlaskLearning[] = [
  {
    id: "demo-l-contact",
    execution_id: "demo-exec",
    action_id: "demo-action",
    action_type: "website",
    measurement_id: "demo-m-contact",
    learning_type: "marketing",
    metric: "Contact form submissions",
    previous_value: 9,
    value: 14,
    direction: "increase",
    outcome: "positive",
    confidence: 0.78,
    observation:
      "In the week after the reviews section went up, 14 people sent the contact form, against 9 in the week before.",
    learning:
      "Visitors are more willing to start a conversation once they can see other customers first.",
    created_at: "21 Sep 2026",
  },
  {
    id: "demo-l-time",
    execution_id: "demo-exec",
    action_id: "demo-action",
    action_type: "website",
    measurement_id: "demo-m-time",
    learning_type: "marketing",
    metric: "Homepage time on page",
    previous_value: 61,
    value: 74,
    direction: "increase",
    outcome: "positive",
    confidence: 0.52,
    observation:
      "Average time on the homepage moved from 61 to 74 seconds, and the reviews block was reached by just under half of visitors.",
    learning:
      "The reviews give people a reason to keep reading, though one week is not enough to separate this from normal variation.",
    created_at: "21 Sep 2026",
  },
  {
    id: "demo-l-scroll",
    execution_id: "demo-exec",
    action_id: "demo-action",
    action_type: "website",
    measurement_id: "demo-m-scroll",
    learning_type: "operational",
    metric: "Reviews section scroll depth",
    previous_value: null,
    value: 46,
    direction: "unchanged",
    outcome: "neutral",
    confidence: 0.33,
    observation:
      "46% of homepage visitors scrolled far enough to see the reviews. This is the first measurement, so there is nothing to compare it against.",
    learning:
      "More than half of visitors never reach the proof. Moving it higher up the page is worth testing next.",
    created_at: "21 Sep 2026",
  },
];
