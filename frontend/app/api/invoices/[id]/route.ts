import { getInvoiceView } from "@/lib/billing/invoices";
import { reconcileBalance } from "@/lib/billing/reconcile";
import { readDb } from "@/lib/billing/store";
import { bmoniConfigured } from "@/lib/bmoni/client";
import { handle, json } from "@/lib/http";

// Polled by the "waiting for payment" screen.
export async function GET(_req: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    let view = getInvoiceView(id);
    if (!view) return json({ error: "Invoice not found." }, 404);

    if (view.invoice.status === "pending" && bmoniConfigured()) {
      try {
        await reconcileBalance(); // fallback if the webhook did not arrive
      } catch (e) {
        console.error("[reconcile]", e instanceof Error ? e.message : e);
      }
      view = getInvoiceView(id)!;
    }

    const { invoice, subscription } = view;
    const bank = readDb().merchant.bankAccount;
    return json({
      invoiceId: invoice.id,
      status: invoice.status,
      planId: invoice.planId,
      interval: invoice.interval,
      amountNgn: invoice.amountKobo / 100,
      expiresAt: invoice.expiresAt,
      paidAt: invoice.paidAt ?? null,
      paidVia: invoice.paidVia ?? null,
      subscription: subscription && {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      bank: bank && {
        accountNumber: bank.accountNumber,
        bankName: bank.bankName,
        accountName: bank.accountName,
      },
    });
  });
}
