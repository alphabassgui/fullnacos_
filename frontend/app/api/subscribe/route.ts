import { createInvoice, HttpError } from "@/lib/billing/invoices";
import { isInterval } from "@/lib/billing/pricing";
import { getPaymentAccount } from "@/lib/billing/merchant";
import { handle, json, readJson, str } from "@/lib/http";

// Growth: the browser sends ONLY { name, email, planId, interval }. The price
// is looked up on the server. Response = what to pay and where.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    if (b.currency === "USD") {
      throw new HttpError(400, "USD payment is not available in this demo. Please pay in NGN.");
    }
    if (!isInterval(b.interval)) throw new HttpError(400, "Choose monthly or annual.");

    // Make sure we can actually receive money before creating an invoice.
    const { bank, demo } = await getPaymentAccount();
    const { invoice, customer } = await createInvoice({
      name: str(b.name),
      email: str(b.email),
      planId: b.planId,
      interval: b.interval,
    });

    return json({
      customerId: customer.id,
      invoiceId: invoice.id,
      status: invoice.status,
      amountNgn: invoice.amountKobo / 100,
      amountKobo: invoice.amountKobo,
      expiresAt: invoice.expiresAt,
      demo, // true = placeholder account (BMONI could not issue a real one)
      bank: {
        accountNumber: bank.accountNumber,
        bankName: bank.bankName,
        accountName: bank.accountName,
      },
    });
  });
}
