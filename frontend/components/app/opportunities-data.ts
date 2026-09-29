import type { CSSProperties } from "react";
import { C, BODY } from "./shell";
import type { FlaskOpportunity } from "@/lib/api";

/**
 * Shared card model for the Opportunities screen — ported verbatim from the
 * Claude Design export (docs/opportunities-real-reference.html). One card design
 * serves both the real Flask data and the demo loop, so the maps + sample
 * opportunities live here, apart from the presentational component.
 *
 * Everything is QUALITATIVE: title, description, problem, a humanized
 * problem_key category, a potential_impact badge, and evidence bullets. No
 * keyword / search-volume / rank / clicks data appears anywhere.
 */

/** Humanized labels for the backend's machine `problem_key`. Unknown → "Other". */
export const CATEGORY: Record<string, string> = {
  social_proof: "Social proof",
  pricing_transparency: "Pricing clarity",
  value_proposition: "Value proposition",
  support_information: "Support information",
  legal_information: "Legal information",
  seo_visibility: "SEO visibility",
  content_gap: "Content gap",
  conversion_friction: "Conversion friction",
  technical_issue: "Technical issue",
  audience_targeting: "Audience targeting",
  other: "Other",
};

/** Humanize a problem_key, falling back to "Other" for anything unmapped. */
export function categoryLabel(key: string): string {
  return CATEGORY[key] ?? CATEGORY.other;
}

/** Per-impact badge styling. `high` gets the tinted, ringed treatment. */
export type ImpactStyle = { label: string; fill: string; line: string; ink: string; dot: string };

export const IMPACT: Record<string, ImpactStyle> = {
  high: { label: "High impact", fill: "var(--gv-badge-fill)", line: "var(--gv-badge-line)", ink: C.blueText, dot: C.blue },
  medium: { label: "Medium impact", fill: "transparent", line: C.border, ink: C.secondary, dot: C.secondary },
  low: { label: "Low impact", fill: "transparent", line: C.border, ink: C.muted, dot: C.muted },
};

/** Impact styling for a value, defaulting to `medium` for anything unexpected. */
export function impactStyle(level: string): ImpactStyle {
  return IMPACT[level] ?? IMPACT.medium;
}

/** Rank order for sorting — highest impact first. Unknown impacts sort last. */
const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Return a new array sorted highest potential_impact first (stable within a tier). */
export function sortByImpact(list: FlaskOpportunity[]): FlaskOpportunity[] {
  const rank = (o: FlaskOpportunity) => IMPACT_RANK[o.potential_impact] ?? 99;
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/**
 * Demo-mode opportunities (no NEXT_PUBLIC_API_BASE). These are the qualitative
 * samples from the design reference — real-shaped, no invented metrics — so the
 * demo loop renders the exact same card design as the live pipeline. Stable ids
 * are synthetic (demo-*), only used as React keys.
 */
export const DEMO_OPPORTUNITIES: FlaskOpportunity[] = [
  {
    id: "demo-social-proof",
    title: "No proof that other people trust you",
    description:
      "Your site asks people to place an order without showing them a single review or a photo of a real customer. A first-time visitor has nothing to go on.",
    problem:
      "There is no social proof anywhere on the site, so someone who has never bought from you has no way to judge whether the orders turn out well.",
    problem_key: "social_proof",
    potential_impact: "high",
    evidence: [
      "No reviews, testimonials or ratings on any page I could reach",
      'The words "review" and "testimonial" do not appear on the site',
      "Your Google reviews are not linked or embedded anywhere",
      "Every photo shows a product on its own, none show a customer or an event",
    ],
  },
  {
    id: "demo-pricing",
    title: "Cake prices are not on the site",
    description:
      'Every product page ends with "contact for price". People who want a quick answer before they commit tend to leave instead of messaging you.',
    problem:
      "Prices are missing, so a visitor cannot tell whether you fit their budget without starting a conversation first.",
    problem_key: "pricing_transparency",
    potential_impact: "medium",
    evidence: [
      'Nine of the eleven product pages say "contact for price"',
      "No price, price range or starting figure appears anywhere on the site",
      "The order form asks for a budget but gives no guide to what things cost",
    ],
  },
  {
    id: "demo-support",
    title: "No clear way to ask a question",
    description:
      "Contact is one form at the bottom of one page. There is no phone number, no opening hours, and no answers to the questions people ask before ordering.",
    problem:
      "Someone with a question about delivery, notice period or dietary needs has to send a form and wait, with no idea when you will reply.",
    problem_key: "support_information",
    potential_impact: "low",
    evidence: [
      "A contact form on the contact page is the only way to reach you",
      "No phone number or WhatsApp link on any page",
      "No opening hours and no stated reply time",
      "No FAQ or delivery information page",
    ],
  },
];

/** Shared uppercase mono sub-heading style used inside the opportunity cards. */
export const SUBHEAD_STYLE: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: C.muted,
};

/** Re-exported so card components import one place. */
export const CARD_BODY = BODY;
