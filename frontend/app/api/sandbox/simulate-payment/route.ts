import { applyDeposit, getInvoiceView, HttpError } from "@/lib/billing/invoices";
import { handle, json, readJson, str } from "@/lib/http";

// SANDBOX ONLY. The BMONI sandbox cannot simulate a real bank transfer into a
// virtual account (test tokens are credited by hand, by email). This endpoint
// marks an invoice paid through the SAME code path a real deposit uses, so the
// demo works end to end. It is disabled in production and can be switched off
// with ALLOW_SIMULATE_PAYMENT=false. It moves no money.
export async function POST(req: Request) {
  return handle(async () => {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_SIMULATE_PAYMENT === "false") {
      return json({ error: "Not available." }, 404);
    }
    const b = await readJson(req);
    const view = getInvoiceView(str(b.invoiceId));
    if (!view) throw new HttpError(404, "Invoice not found.");
    if (view.invoice.status !== "pending") {
      throw new HttpError(409, `Invoice is already ${view.invoice.status}.`);
    }

    const r = await applyDeposit({
      amountKobo: view.invoice.amountKobo,
      txId: `simulated-${view.invoice.id}`,
      via: "simulated",
    });
    return json({ simulated: true, matched: r.matched });
  });
}
