// Provisions the ONE merchant BMONI user that receives all customer payments:
// user -> KYC -> wallet -> Nigeria onboarding -> virtual account -> link.
// Each step saves its result so a retry resumes instead of repeating. Wallet
// creation is NOT duplicate-safe, so we always list wallets before creating.

import { bmoni, BmoniConfigError, BmoniError } from "../bmoni/client";
import { PERSONAS, personaEmail } from "../bmoni/sandbox-persona";
import { generateOwnerKey, signOwnerProof } from "../bmoni/wallet";
import { HttpError } from "./invoices";
import { decimalToKobo } from "../bmoni/webhook";
import { readDb, update, type BankAccountInfo, type MerchantState } from "./store";

type ReadyMerchant = MerchantState & { bankAccount: BankAccountInfo };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patch = (p: Partial<MerchantState>) =>
  update((db) => {
    Object.assign(db.merchant, p);
  });

/** Read the account fields we show to the customer. Fails loudly if the shape is not what we expect. */
function toBankAccount(raw: Record<string, unknown>): BankAccountInfo {
  const s = (...keys: string[]) => {
    for (const k of keys) if (typeof raw[k] === "string" && raw[k]) return raw[k] as string;
    return undefined;
  };
  const id = s("id");
  const accountNumber = s("accountNumber", "account_number", "nuban");
  if (!id || !accountNumber) {
    throw new Error(`Unexpected deposit account shape. Keys: ${Object.keys(raw).join(", ")}`);
  }
  return {
    id,
    accountNumber,
    bankName: s("bankName", "bank_name", "bank") ?? "",
    accountName: s("accountName", "account_name", "name") ?? "",
  };
}

let inflight: Promise<ReadyMerchant> | null = null;

export function ensureMerchant(): Promise<ReadyMerchant> {
  const m = readDb().merchant;
  if (m.bankAccount && m.vbaLinked && m.bmoniUserId && m.smartWalletId) {
    return Promise.resolve(m as ReadyMerchant);
  }
  inflight ??= provision().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function provision(): Promise<ReadyMerchant> {
  let m = readDb().merchant;

  // 1. user. The shared sandbox key means a shared BMONI partner, so another team
  // may already own a persona's phone (BMONI answers 409 on duplicate phone/email).
  // The unique email tag is saved BEFORE the create, so if we crash mid-way a retry
  // can recover OUR user by that email. A 409 we cannot recover means the phone is
  // taken by someone else: fall back to the next persona.
  if (!m.bmoniUserId) {
    let idx = m.personaIndex ?? 0;
    while (!readDb().merchant.bmoniUserId) {
      if (idx >= PERSONAS.length) {
        throw new HttpError(503, "Both sandbox test personas are already in use on this API key. Ask the organisers for your own key.");
      }
      const persona = PERSONAS[idx];
      const tag = readDb().merchant.emailTag ?? crypto.randomUUID().slice(0, 8);
      await patch({ personaIndex: idx, emailTag: tag });
      const email = personaEmail(persona, tag);
      try {
        const { user } = await bmoni.createUser({
          firstName: persona.firstName,
          lastName: persona.lastName,
          // KYC verifies the BVN + name + date of birth, NOT the phone. On the shared
          // sandbox key both personas' built-in phones are already registered by other
          // teams (BMONI answers 409), which blocks user creation. BMONI accepts a spare
          // made-up phone, so allow overriding it via env (the standalone bmoni-proof.ts
          // script does the same with PHONE=). Defaults to the persona phone, so nothing
          // changes unless BMONI_MERCHANT_PHONE is set.
          phoneNumber: process.env.BMONI_MERCHANT_PHONE || persona.phoneNumber,
          bvn: persona.bvn,
          email,
        });
        await patch({ bmoniUserId: user.bmoniUserId });
      } catch (e) {
        if (!(e instanceof BmoniError && e.statusCode === 409)) throw e;
        let found: string | undefined;
        for (let page = 1; page <= 5 && !found; page++) {
          const { users } = await bmoni.listUsers(page, 100);
          found = users.find((u) => u.email === email)?.bmoniUserId as string | undefined;
          if (users.length < 100) break;
        }
        if (found) await patch({ bmoniUserId: found });
        else {
          idx++;
          await patch({ personaIndex: idx, emailTag: undefined });
        }
      }
    }
    m = readDb().merchant;
  }
  const P = PERSONAS[m.personaIndex ?? 0];
  const userId = m.bmoniUserId!;

  // 2. KYC profile (BVN-based; persona data only)
  if (!m.onboardingStarted) {
    const lookup = await bmoni.bvnLookup(userId, P.bvn);
    await bmoni.patchKyc(userId, {
      personalInfo: {
        firstName: P.firstName,
        lastName: P.lastName,
        phoneNumber: P.phoneNumber,
        ...(lookup.dateOfBirth ? { dateOfBirth: lookup.dateOfBirth } : {}),
      },
      address: {
        streetLine1: "15 Admiralty Way",
        city: "Lagos",
        state: "Lagos",
        postalCode: "101241",
        countryCode: "NGA",
      },
      identificationNumbers: [{ type: "bvn", number: P.bvn, issuingCountryCode: "NGA" }],
    });
  }

  // 3. wallet (NOT duplicate-safe: persist the key first, list before create)
  if (!m.owner) {
    await patch({ owner: generateOwnerKey() });
    m = readDb().merchant;
  }
  const owner = m.owner!;
  if (!m.smartWalletId) {
    // A brand-new user has no wallet group yet: BMONI answers 400 until the first
    // owner-proof challenge (seen live). Treat that as "no wallets".
    const wallets = await bmoni.listWallets(userId).catch((e) => {
      if (e instanceof BmoniError && e.statusCode === 400) return [];
      throw e;
    });
    // We ask for CNGN, but BMONI labels the wallet "NGN" (seen live).
    let walletId = wallets.find((w) => w.currency === "NGN" || w.currency === "CNGN")?.id;
    if (!walletId) {
      const ch = await bmoni.createOwnerProofChallenge(userId, {
        currency: "CNGN",
        userOwnerAddress: owner.address,
      });
      const sig = await signOwnerProof(owner.privateKey, ch.message); // EIP-191, with prefix
      const w = await bmoni.createManagedWallet(userId, {
        currency: "CNGN",
        userOwnerAddress: owner.address,
        ownerProofChallengeId: ch.challengeId,
        ownerProofSignature: sig,
      });
      walletId = w.id;
    }
    await patch({ smartWalletId: walletId });
    m = readDb().merchant;
  }
  const walletId = m.smartWalletId!;

  // 4. Nigeria onboarding (issues the virtual account)
  if (!m.onboardingStarted) {
    try {
      await bmoni.startNigeria(userId, {
        bvn: P.bvn,
        ngnWalletAddress: owner.address,
        ngnWalletIndex: 0,
      });
    } catch (e) {
      // Seen live: this call times out (504) or returns 500 on BMONI's side.
      if (e instanceof BmoniError && e.statusCode >= 500) {
        throw new HttpError(503, `BMONI could not start Nigeria onboarding (HTTP ${e.statusCode}). Try again later.`);
      }
      throw e;
    }
    await patch({ onboardingStarted: true });
  }
  let active = false;
  for (let i = 0; i < 10 && !active; i++) {
    const st = await bmoni.onboardingStatus(userId);
    if (st.anchorStatus === "active") active = true;
    else if (st.anchorStatus === "rejected" || st.anchorStatus === "resubmission_required") {
      throw new HttpError(503, `Merchant onboarding ${st.anchorStatus}: ${st.anchorRejectionReason ?? "see BMONI"}`);
    } else await new Promise((r) => setTimeout(r, 3000));
  }
  if (!active) throw new HttpError(503, "The payment account is still being set up. Try again in a minute.");

  // 5. deposit account + link it to the wallet
  // Before onboarding BMONI lists a shared "pooled-vba-1" account (not a UUID,
  // cannot be linked, not ours). Only accept an account with a real UUID id.
  const { accounts } = await bmoni.depositAccounts(userId, "NGN");
  const own = (accounts ?? []).find((a) => UUID.test(String(a.id)));
  if (!own) throw new HttpError(503, "No virtual account has been issued yet. Try again shortly.");
  const bank = toBankAccount(own);
  await patch({ bankAccount: bank });
  const link = await bmoni.linkNigeriaVba(userId, walletId, bank.id);
  if (!link.linked) throw new HttpError(503, "Could not link the virtual account to the wallet.");
  await patch({ vbaLinked: true });

  // 6. baseline balance for the balance-check fallback
  const bal = await bmoni.walletBalance(userId, walletId);
  await patch({ lastBalanceKobo: decimalToKobo(bal.balance) ?? 0 });

  return readDb().merchant as ReadyMerchant;
}

// ---------------------------------------------------------------------------
// Demo fallback. DEMO_FALLBACK_ACCOUNT=true (never in production): if BMONI
// cannot give us a real virtual account, show a clearly labelled PLACEHOLDER so
// the rest of the demo (invoice -> waiting -> simulate -> active) still runs.
// The real BMONI account is always tried first. While BMONI keeps failing we
// retry quietly in the background every 2 minutes (BMONI asks callers to back off).
// ---------------------------------------------------------------------------

export const DEMO_BANK: BankAccountInfo = {
  id: "demo",
  accountNumber: "0000000000",
  bankName: "DEMO ONLY - not a real account",
  accountName: "BMONI sandbox account unavailable",
};

let retryAfter = 0;
let failedOnce = false;

export async function getPaymentAccount(): Promise<{ bank: BankAccountInfo; demo: boolean }> {
  const fallback = process.env.DEMO_FALLBACK_ACCOUNT === "true";

  // Real account already set up: always use it.
  const m = readDb().merchant;
  if (m.bankAccount && m.vbaLinked && m.bmoniUserId && m.smartWalletId) {
    return { bank: m.bankAccount, demo: false };
  }

  // BMONI failed earlier: never make a customer wait again. Retry quietly in the
  // background (at most every 2 minutes) and show the placeholder meanwhile.
  if (fallback && failedOnce) {
    if (Date.now() >= retryAfter) {
      retryAfter = Date.now() + 120_000;
      ensureMerchant().catch((e) =>
        console.error("[merchant] background retry failed:", e instanceof Error ? e.message : e),
      );
    }
    return { bank: DEMO_BANK, demo: true };
  }

  try {
    const ready = await ensureMerchant();
    return { bank: ready.bankAccount, demo: false };
  } catch (e) {
    const providerProblem = e instanceof BmoniError || e instanceof BmoniConfigError || e instanceof HttpError;
    if (!fallback || !providerProblem) throw e;
    console.error("[merchant] BMONI account unavailable, showing the DEMO placeholder:", e instanceof Error ? e.message : e);
    failedOnce = true;
    retryAfter = Date.now() + 120_000;
    return { bank: DEMO_BANK, demo: true };
  }
}
