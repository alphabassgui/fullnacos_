import { BILLING } from "@/lib/billing/plans.config";
import { isInterval, priceAll } from "@/lib/billing/pricing";
import { json } from "@/lib/http";

// Public pricing. Everything is computed on the server from plans.config.ts.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("interval");
  const interval = isInterval(q) ? q : "monthly";
  return json({
    interval,
    annualDiscount: BILLING.annualDiscount,
    headline: BILLING.headline,
    payableCurrency: BILLING.currency,
    plans: priceAll(interval),
  });
}
