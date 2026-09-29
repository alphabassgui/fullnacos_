// Proves the BMONI sandbox flow end to end with the Samson Jabo test persona.
//   npx tsx --env-file=.env scripts/bmoni-proof.ts
//
// Safe to re-run: progress is saved in data/proof-state.json (gitignored) and
// finished steps are skipped, because wallet creation is NOT duplicate-safe.
// Prints raw responses so we can record the real shapes. Never prints the API
// key or the owner private key.

import fs from "node:fs";
import path from "node:path";
import { bmoni, bmoniConfigured, BmoniError } from "../lib/bmoni/client";
import { PERSONAS, personaEmail } from "../lib/bmoni/sandbox-persona";
import { generateOwnerKey, signOwnerProof, type OwnerKey } from "../lib/bmoni/wallet";

const STATE_FILE = path.join(process.cwd(), "data", "proof-state.json");
interface State {
  emailTag?: string;
  userId?: string;
  owner?: OwnerKey;
  smartWalletId?: string;
  onboardingStarted?: boolean;
}
const state: State = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// PERSONA_INDEX=1 tries Bunch Dillon if Samson Jabo's phone is already taken on the shared key.
// The email is made unique so we never pick up somebody else's user.
const base = PERSONAS[Number(process.env.PERSONA_INDEX ?? 0)];
state.emailTag ??= crypto.randomUUID().slice(0, 8);
save();
// PHONE=+234800000XXXX overrides the persona phone when the real persona phones are taken by other teams.
const PERSONA = { ...base, phoneNumber: process.env.PHONE ?? base.phoneNumber, email: personaEmail(base, state.emailTag) };

const show = (label: string, v: unknown) =>
  console.log(`\n--- ${label}\n${JSON.stringify(v, null, 2)?.slice(0, 2500)}`);

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const r = await fn();
    show(`OK  ${label}`, r);
    return r;
  } catch (e) {
    if (e instanceof BmoniError) {
      show(`FAIL ${label} -> HTTP ${e.statusCode} ${e.method} ${e.path}`, e.body);
    } else {
      console.log(`\n--- FAIL ${label}: ${(e as Error).message}`);
    }
    return undefined;
  }
}

async function main() {
  if (!bmoniConfigured()) {
    console.log(
      "BMONI_API_KEY is empty.\nPaste the sandbox key into backend/.env on the line:  BMONI_API_KEY=\nThen run this script again.",
    );
    return;
  }
  await step("health", () => bmoni.health());

  // 1. user
  if (!state.userId) {
    const created = await step("create user (with BVN)", () => bmoni.createUser(PERSONA));
    if (created) {
      state.userId = created.user.bmoniUserId;
      save();
    } else {
      // 409 = already exists. The shared key lists EVERY team's users, so look for
      // our own unique email and never print the list (it holds other people's data).
      try {
        const rows = (await bmoni.listUsers()).users ?? [];
        const hit = rows.find((u) => u.email === PERSONA.email);
        if (hit?.bmoniUserId) {
          state.userId = String(hit.bmoniUserId);
          save();
          console.log("\nRecovered our own user from an earlier run.");
        } else {
          console.log(
            `\nNot ours: ${PERSONA.phoneNumber} belongs to another user on the shared key (checked ${rows.length} users, none printed).\nTry the other persona:  PERSONA_INDEX=1 npx tsx --env-file=.env scripts/bmoni-proof.ts`,
          );
        }
      } catch (e) {
        console.log(`\nCould not check existing users: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  if (!state.userId) return console.log("\nStopped: no user id.");
  const userId = state.userId;
  console.log(`\nuserId = ${userId}`);

  // 2. KYC
  const lookup = await step("bvn-lookup (fetch only)", () => bmoni.bvnLookup(userId, PERSONA.bvn));
  await step("kyc profile BEFORE patch", () => bmoni.getKyc(userId));
  await step("patch kyc", () =>
    bmoni.patchKyc(userId, {
      personalInfo: {
        firstName: PERSONA.firstName,
        lastName: PERSONA.lastName,
        phoneNumber: PERSONA.phoneNumber,
        ...(lookup?.dateOfBirth ? { dateOfBirth: lookup.dateOfBirth } : {}),
      },
      // Fake Lagos address from the spec's own example.
      address: {
        streetLine1: "15 Admiralty Way",
        city: "Lagos",
        state: "Lagos",
        postalCode: "101241",
        countryCode: "NGA",
      },
      identificationNumbers: [
        { type: "bvn", number: PERSONA.bvn, issuingCountryCode: "NGA" },
      ],
    }),
  );
  await step("kyc readiness", () => bmoni.kycReadiness(userId));

  // 3. wallet (NOT duplicate-safe: check first)
  if (!state.owner) {
    state.owner = generateOwnerKey();
    save(); // persist BEFORE the call so a crash cannot orphan the key
  }
  const owner = state.owner;
  console.log(`owner address = ${owner.address}`);

  const existing = await step("list wallets (check before create)", () => bmoni.listWallets(userId));
  const found = Array.isArray(existing) ? existing.find((w) => w.currency === "CNGN" || w.currency === "NGN") : undefined;
  if (found) {
    state.smartWalletId = found.id;
    save();
  } else if (!state.smartWalletId) {
    const ch = await step("owner-proof challenge", () =>
      bmoni.createOwnerProofChallenge(userId, { currency: "CNGN", userOwnerAddress: owner.address }),
    );
    if (ch) {
      const sig = await signOwnerProof(owner.privateKey, ch.message);
      const w = await step("create-managed wallet", () =>
        bmoni.createManagedWallet(userId, {
          currency: "CNGN",
          userOwnerAddress: owner.address,
          ownerProofChallengeId: ch.challengeId,
          ownerProofSignature: sig,
        }),
      );
      if (w) {
        state.smartWalletId = w.id;
        save();
      }
    }
  }
  if (!state.smartWalletId) return console.log("\nStopped: no wallet.");
  const walletId = state.smartWalletId;
  await step("wallets after", () => bmoni.listWallets(userId));

  // 4. Nigeria onboarding (ngnWalletIndex: 0 as in the docs quickstart)
  if (!state.onboardingStarted) {
    const r = await step("start-nigeria", () =>
      bmoni.startNigeria(userId, {
        bvn: PERSONA.bvn,
        ngnWalletAddress: owner.address,
        ngnWalletIndex: 0,
      }),
    );
    if (r !== undefined) {
      state.onboardingStarted = true;
      save();
    }
  }
  for (let i = 0; i < 12; i++) {
    const s = await step(`onboarding status (poll ${i + 1})`, () => bmoni.onboardingStatus(userId));
    if (!s || s.anchorStatus === "active" || s.anchorStatus === "rejected" || s.anchorStatus === "resubmission_required") break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 5. deposit account
  const dep = await step("deposit accounts NGN", () => bmoni.depositAccounts(userId, "NGN"));
  await step("all bank accounts of user", () => bmoni.depositAccounts(userId, "NGN"));
  const first = dep?.accounts?.[0];
  if (first?.id) {
    await step("link VBA to wallet (onramp/vba/nigeria)", () =>
      bmoni.linkNigeriaVba(userId, walletId, String(first.id)),
    );
  }

  // 6. balance + transactions (to learn shapes)
  await step("wallet balance", () => bmoni.walletBalance(userId, walletId));
  await step("account balances", () => bmoni.accountBalances(userId));
  await step("wallet transactions", () => bmoni.walletTransactions(userId, walletId));
  // The config response contains the signing secret, so only show whether one exists and where it points.
  await step("webhook config (secret hidden)", async () => {
    try {
      const c = (await bmoni.getWebhookConfig()) as { callbackUrl?: string; active?: boolean; events?: string[] };
      let host = "?";
      try { host = new URL(String(c.callbackUrl)).host; } catch {}
      return { exists: true, callbackHost: host, active: c.active, events: c.events };
    } catch (e) {
      if (e instanceof BmoniError && e.statusCode === 404) return { exists: false };
      throw e;
    }
  });

  console.log("\nDone. State saved in data/proof-state.json");
}

main().catch((e) => {
  console.error("\nUnexpected error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
