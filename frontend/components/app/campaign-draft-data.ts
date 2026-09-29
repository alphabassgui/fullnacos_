import type { FlaskAction } from "@/lib/api";

/**
 * Shared model for the Campaign draft screen — ported verbatim from the Claude
 * Design export (docs/campaign-draft-real-reference.html). One card design serves
 * both the real Flask action and the demo loop, so the maps + the sample action
 * live here, apart from the presentational component.
 *
 * Everything mirrors the real action shape from the decision engine: action_type,
 * action_title, reasoning, expected_outcome, required_inputs, confidence. No
 * invented metrics.
 */

/** Humanized labels for the backend's machine `action_type`. Unknown → "Other". */
export const TYPE_LABEL: Record<string, string> = {
  website: "Website",
  github: "Code / GitHub",
  content: "Content",
  seo: "SEO",
  social: "Social",
  email: "Email",
  research: "Research",
  other: "Other",
};

/** Humanize an action_type, falling back to "Other" for anything unmapped. */
export function typeLabel(key: string): string {
  return TYPE_LABEL[key] ?? TYPE_LABEL.other;
}

/**
 * Confidence label from the number — always shown alongside the value.
 * ≥0.7 High · 0.4–0.69 Medium · <0.4 Low.
 */
export function confidenceLabel(value: number): string {
  return value >= 0.7 ? "High confidence" : value >= 0.4 ? "Medium confidence" : "Low confidence";
}

/**
 * Status → a small badge label + tone, shared by the Campaigns list. Tones match
 * the campaign-draft Tag palette (blue / good / bad / neutral). Unknown statuses
 * fall back to the pending look.
 */
export type StatusTone = "blue" | "good" | "bad" | "neutral";
export function statusMeta(status: string): { label: string; tone: StatusTone } {
  const v = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (v === "approved" || v === "running") return { label: "Running", tone: "blue" };
  if (v === "completed") return { label: "Completed", tone: "good" };
  if (v === "failed") return { label: "Failed", tone: "bad" };
  if (v === "rejected") return { label: "Rejected", tone: "neutral" };
  return { label: "Needs your approval", tone: "blue" };
}

/** Sort rank for the Campaigns list — most actionable (pending) first. */
export function statusRank(status: string): number {
  const v = typeof status === "string" ? status.trim().toLowerCase() : "";
  const order: Record<string, number> = {
    pending_approval: 0,
    approved: 1,
    running: 1,
    completed: 2,
    failed: 3,
    rejected: 4,
  };
  return order[v] ?? 0;
}

/** The parent opportunity title shown for context in demo mode. */
export const DEMO_OPP_TITLE = "No proof that other people trust you";

/**
 * Demo-mode action (no NEXT_PUBLIC_API_BASE). The qualitative sample from the
 * design reference — real-shaped, no invented metrics — so the demo loop renders
 * the exact same card design as the live pipeline. The synthetic id is only used
 * as a React key / localStorage key in demo.
 */
export const DEMO_ACTION: FlaskAction = {
  id: "demo-action-reviews",
  opportunity_id: "demo-social-proof",
  action_title: "Collect your first customer reviews and put them on the site",
  action_type: "website",
  reasoning:
    "Nothing on your site tells a first-time visitor that other people have ordered from you and were happy. I read every page I could reach and found no reviews, no testimonials, and no link to your Google reviews, while every photo shows a product on its own. So I would ask your recent customers for a short review, then build a reviews section for the homepage and the cake pages using their words and nothing else.",
  expected_outcome:
    "Signals to monitor once this runs: how many review requests get a reply, how many of those replies you approve for the site, and whether visitors who land on the homepage reach the order form more often than they do now. I cannot promise a number. I will report what I can actually see.",
  required_inputs: [
    "A list of recent customers you are happy for me to contact",
    "Permission to use their first name and last initial on the site",
    "A way to publish homepage changes, or a person I should send the draft to",
  ],
  confidence: 0.82,
  status: "pending_approval",
};
