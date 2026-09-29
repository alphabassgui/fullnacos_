// THE ONE PLACE for plans, prices, billing intervals, the annual discount and
// page copy. Change prices here and nothing else. No other file may contain a
// price. Amounts are whole naira (NGN); the server converts to kobo.
//
// Source: William's Groville pricing mockup (monthly + annual, NGN view).
// USD prices come from the USD view of the same mockup. USD is DISPLAY ONLY:
// payments are NGN bank transfers only (USD needs a second KYC stage + USD account).

export type PlanId = "scan" | "growth" | "studio";
export type Interval = "monthly" | "annual";
export type PlanKind = "free" | "paid" | "contact";

export interface PlanConfig {
  id: PlanId;
  name: string;
  tagline: string;
  kind: PlanKind;
  popular?: boolean;
  /** Monthly list price in NGN. */
  monthlyNgn: number;
  /** Monthly list price in whole USD. DISPLAY ONLY (payments are NGN only). null = not provided. */
  monthlyUsd: number | null;
  cta: string;
  note?: string;
  features: { text: string; included: boolean; strong?: boolean }[];
}

export const BILLING = {
  currency: "NGN" as const,
  /** Annual plans are this much cheaper than 12 x monthly. */
  annualDiscount: 0.2,
  /** Used for the "about N a day" line. */
  daysPerMonth: 30,
  /** How long an invoice can be paid before it expires. */
  invoiceTtlHours: 48,
  /** Period length added on payment. */
  periodMonths: { monthly: 1, annual: 12 } as Record<Interval, number>,
  /** Renewal invoice + reminder this many days before the period ends. */
  reminderDaysBeforeEnd: 7,
  headline: {
    NGN: "Billed in Naira. No dollar card, no FX surprise.",
    USD: "Billed in USD. Cards and invoices welcome.",
  },
};

export const PLANS: PlanConfig[] = [
  {
    id: "scan",
    name: "Scan",
    tagline: "For shops trying Groville out.",
    kind: "free",
    monthlyNgn: 0,
    monthlyUsd: 0,
    cta: "Start free",
    features: [
      { text: "1 website connected", included: true },
      { text: "1 campaign a month", included: true },
      { text: "Weekly digest", included: true },
      { text: "Email support", included: true },
      { text: "Email, SMS & call routing", included: false },
      { text: "Full telemetry & learning", included: false },
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For one shop growing on purpose.",
    kind: "paid",
    popular: true,
    monthlyNgn: 30_000,
    monthlyUsd: 59,
    cta: "Start free",
    note: "No card required. Cancel anytime.",
    features: [
      { text: "Everything in Scan", included: true },
      { text: "10 campaigns a month", included: true, strong: true },
      { text: "Email, SMS & call routing", included: true },
      { text: "Full telemetry & learning", included: true },
      { text: "Guardrails & approval rules", included: true },
      { text: "Priority support", included: true },
    ],
  },
  {
    id: "studio",
    name: "Studio",
    tagline: "For multi-location shops & agencies.",
    kind: "contact",
    monthlyNgn: 90_000,
    monthlyUsd: 149,
    cta: "Talk to us",
    features: [
      { text: "Everything in Growth", included: true },
      { text: "Unlimited campaigns", included: true, strong: true },
      { text: "Multiple websites", included: true },
      { text: "Team seats", included: true },
      { text: "Dedicated success manager", included: true },
    ],
  },
];
