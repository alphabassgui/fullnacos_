import { applyDeposit } from "@/lib/billing/invoices";
import { readDb } from "@/lib/billing/store";
import { decimalToKobo, isValidSignature } from "@/lib/bmoni/webhook";

// BMONI deliveries. Verify the HMAC over the RAW body BEFORE parsing JSON.
// Status codes matter: 5xx/408/429 are retried by BMONI, other 4xx never are,
// so only return 4xx for permanent problems (bad signature).
export async function POST(req: Request) {
  const secret = process.env.BMONI_WEBHOOK_SECRET ?? "";
  if (!secret) {
    console.error("[webhook] BMONI_WEBHOOK_SECRET not set");
    return new Response("not configured", { status: 503 }); // transient: BMONI will retry
  }

  const raw = await req.text();
  if (!isValidSignature(raw, req.headers.get("x-webhook-signature"), secret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let ev: {
    id?: string;
    eventType?: string;
    userId?: string;
    payload?: Record<string, unknown>;
  };
  try {
    ev = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const headerId = req.headers.get("x-webhook-id") ?? undefined;
  const eventId = ev.id ?? headerId;

  // Partner-scoped subscriptions receive employee.deposit.completed (renamed
  // from wallet.deposit.completed). Accept both names.
  if (ev.eventType === "employee.deposit.completed" || ev.eventType === "wallet.deposit.completed") {
    const p = ev.payload ?? {};
    const userId = ev.userId ?? (p.userId as string | undefined);
    const merchant = readDb().merchant;
    const ours = !merchant.bmoniUserId || !userId || userId === merchant.bmoniUserId;
    const cur = String(p.currency ?? "").toUpperCase();
    const amountKobo = decimalToKobo(p.amount);
    if (ours && (cur === "NGN" || cur === "CNGN") && amountKobo !== null) {
      const r = await applyDeposit({
        amountKobo,
        txId: (p.transactionId as string | undefined) ?? (p.transferId as string | undefined),
        eventId,
        via: "webhook",
      });
      console.log(`[webhook] deposit ${eventId}: matched=${r.matched} duplicate=${r.duplicate}`);
    }
  }
  return new Response("ok", { status: 200 });
}
