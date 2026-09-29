// Price maths. Everything is derived from plans.config.ts on the server.
// The browser never sends a price; it only sends { planId, interval }.

import { BILLING, PLANS, type Interval, type PlanConfig, type PlanId } from "./plans.config";

export const isInterval = (v: unknown): v is Interval =>
  v === "monthly" || v === "annual";

export function getPlan(id: unknown): PlanConfig | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Total charged per billing period, in whole naira. */
export function periodTotalNgn(plan: PlanConfig, interval: Interval): number {
  if (interval === "monthly") return plan.monthlyNgn;
  return Math.round(plan.monthlyNgn * 12 * (1 - BILLING.annualDiscount));
}

/** Total charged per billing period, in kobo (integer maths only after this point). */
export const periodTotalKobo = (plan: PlanConfig, interval: Interval) =>
  periodTotalNgn(plan, interval) * 100;

export interface PricedPlan {
  id: PlanId;
  name: string;
  tagline: string;
  kind: PlanConfig["kind"];
  popular: boolean;
  cta: string;
  note?: string;
  features: PlanConfig["features"];
  interval: Interval;
  /** Headline "per month" number for this interval. */
  perMonthNgn: number;
  /** Full monthly list price, shown struck through on annual. */
  listPerMonthNgn: number;
  /** What one billing period costs in total. */
  billedNgn: number;
  /** Annual only: naira saved per year vs paying monthly. */
  savesPerYearNgn: number;
  perDayNgn: number;
  perMonthUsd: number | null;
  listPerMonthUsd: number | null;
  /** Annual only: (list - annual per month) x 12, in USD. */
  savesPerYearUsd: number;
}

export function priceAll(interval: Interval): PricedPlan[] {
  return PLANS.map((p) => {
    const billed = periodTotalNgn(p, interval);
    const perMonth = interval === "annual" ? Math.round(billed / 12) : billed;
    const usdPerMonth =
      p.monthlyUsd === null
        ? null
        : interval === "annual"
          ? Math.round(p.monthlyUsd * (1 - BILLING.annualDiscount)) // whole dollars, as in the mockup
          : p.monthlyUsd;
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      kind: p.kind,
      popular: !!p.popular,
      cta: p.cta,
      note: p.note,
      features: p.features,
      interval,
      perMonthNgn: perMonth,
      listPerMonthNgn: p.monthlyNgn,
      billedNgn: billed,
      savesPerYearNgn: interval === "annual" ? p.monthlyNgn * 12 - billed : 0,
      perDayNgn: Math.round(perMonth / BILLING.daysPerMonth),
      perMonthUsd: usdPerMonth,
      listPerMonthUsd: p.monthlyUsd,
      savesPerYearUsd:
        interval === "annual" && p.monthlyUsd !== null && usdPerMonth !== null
          ? (p.monthlyUsd - usdPerMonth) * 12
          : 0,
    };
  });
}
