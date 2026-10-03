// Tiny JSON-file store (data/db.json, gitignored). Good enough for a local
// hackathon demo; swap for a real database before production. Writes are
// serialised through one queue and written atomically (tmp file + rename).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Interval, PlanId } from "./plans.config";
import type { OwnerKey } from "../bmoni/wallet";

export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export type InvoiceStatus = "pending" | "paid" | "expired";

export interface Invoice {
  id: string;
  customerId: string;
  planId: PlanId;
  interval: Interval;
  /** Plan price for the period, kobo (from server config). */
  baseKobo: number;
  /** What the customer must transfer: base + a 1..99 kobo tag so a payment can be matched to this invoice. */
  amountKobo: number;
  status: InvoiceStatus;
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  paidVia?: "webhook" | "balance" | "simulated";
  depositTxId?: string;
  renewal?: boolean;
}

export type SubscriptionStatus = "pending" | "active" | "expired";

export interface Subscription {
  id: string;
  customerId: string;
  planId: PlanId;
  interval: Interval;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null; // null for the free plan (never ends)
  createdAt: string;
  reminderSentAt?: string;
}

export interface BankAccountInfo {
  id: string;
  accountNumber: string;
  bankName: string;
  accountName: string;
}

export interface MerchantState {
  /** Which sandbox persona this merchant uses (index into PERSONAS) and the unique email tag. */
  personaIndex?: number;
  emailTag?: string;
  bmoniUserId?: string;
  owner?: OwnerKey; // DEMO ONLY: server-held key
  smartWalletId?: string;
  onboardingStarted?: boolean;
  bankAccount?: BankAccountInfo;
  vbaLinked?: boolean;
  /** Last wallet balance we accounted for, in kobo (balance-check fallback). */
  lastBalanceKobo?: number;
  lastReconcileAt?: number;
}

export interface Notification {
  id: string;
  at: string;
  customerId: string;
  kind: "renewal_reminder" | "subscription_expired" | "payment_received";
  message: string;
}

export interface UnmatchedDeposit {
  at: string;
  amountKobo: number;
  txId?: string;
  eventId?: string;
  note: string;
}

export interface Db {
  customers: Customer[];
  invoices: Invoice[];
  subscriptions: Subscription[];
  merchant: MerchantState;
  processedEvents: string[];
  unmatchedDeposits: UnmatchedDeposit[];
  notifications: Notification[];
  contacts: { id: string; at: string; name: string; email: string; message: string }[];
}

// Use /tmp on Vercel/serverless environments, local data folder in dev:
const FILE = process.env.VERCEL || process.env.NODE_ENV === "production"
  ? path.join(os.tmpdir(), "db.json")
  : path.join(process.cwd(), "data", "db.json");

const empty = (): Db => ({
  customers: [],
  invoices: [],
  subscriptions: [],
  merchant: {
    personaIndex: 0,
    emailTag: "07598cda",
    bmoniUserId: "9e837e68-1852-4196-87ef-da49cfb24159",
    owner: {
      address: "0x2AeE2cC13179C112129D20da3a4314FE53aDfd1C",
      privateKey: "0xcc3616132666c8e52d0e2a9e9a2ae66000d7975171ca8db8f9181354c12c9144",
    },
    smartWalletId: "3b70b7dd-cadd-4d2f-ae91-1c13b6bc2388",
    onboardingStarted: true,
    bankAccount: {
      id: "0400a6c5-449b-4c06-85d8-9edd52ac5e03",
      accountNumber: "5360090884",
      bankName: "PROVIDUS BANK",
      accountName: "Jabo Samson Joe",
    },
    vbaLinked: true,
    lastBalanceKobo: 0,
  },
  processedEvents: [],
  unmatchedDeposits: [],
  notifications: [],
  contacts: [],
});

export function readDb(): Db {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return empty();
  }
}

function writeDb(db: Db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

// One queue so two requests cannot interleave a read-modify-write.
let queue: Promise<unknown> = Promise.resolve();

export function update<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = readDb();
    const result = await fn(db);
    writeDb(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
