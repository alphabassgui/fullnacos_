// Fallback when the webhook cannot reach us (e.g. localhost with no tunnel):
// compare the merchant wallet balance with the last balance we accounted for.
// A rise equal to an open invoice's exact amount pays that invoice.

import { bmoni } from "../bmoni/client";
import { decimalToKobo } from "../bmoni/webhook";
import { applyDeposit } from "./invoices";
import { readDb, update } from "./store";

let last = 0;

export async function reconcileBalance(): Promise<void> {
  const m = readDb().merchant;
  if (!m.bmoniUserId || !m.smartWalletId || m.lastBalanceKobo === undefined) return;
  if (Date.now() - last < 4000) return; // do not hammer BMONI from a polling page
  last = Date.now();

  const bal = await bmoni.walletBalance(m.bmoniUserId, m.smartWalletId);
  const kobo = decimalToKobo(bal.balance);
  if (kobo === null) return;
  const delta = kobo - m.lastBalanceKobo;
  if (delta > 0) {
    await applyDeposit({
      amountKobo: delta,
      txId: `balance-${m.smartWalletId}-${kobo}`,
      via: "balance",
    });
  }
  if (kobo !== m.lastBalanceKobo) {
    await update((db) => {
      db.merchant.lastBalanceKobo = kobo;
    });
  }
}
