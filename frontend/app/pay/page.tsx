import type { Metadata } from "next";
import { PaymentScreen } from "@/components/app/Payment";
import { getPlan } from "@/lib/billing/pricing";
import type { PlanId } from "@/lib/billing/plans.config";

export const metadata: Metadata = {
  title: "Checkout · Groville",
  description:
    "Start your plan by bank transfer. Groville shows the exact amount and account, waits for your transfer, and confirms it. Bank transfer only, no card, and nothing charges automatically.",
};

/**
 * Reads the `tier` query param (Next 16 `searchParams` is a Promise) and hands
 * the validated plan to the checkout. Only self-serve PAID plans are honored;
 * anything missing or invalid (free/contact tiers, a bad value) falls back to
 * Growth. Reading it here avoids a `useSearchParams` Suspense boundary.
 */
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tier } = await searchParams;
  const raw = Array.isArray(tier) ? tier[0] : tier;
  const plan = getPlan(raw);
  const paidTier: PlanId = plan && plan.kind === "paid" ? plan.id : "growth";
  return <PaymentScreen tier={paidTier} />;
}
