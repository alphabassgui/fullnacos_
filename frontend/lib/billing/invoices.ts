// Invoices, subscriptions, deposit matching and the daily job.
//
// Why amounts carry a 1..99 kobo tag: BMONI's deposit event has no payer name
// and no reference (payload = transactionId, smartWalletId, amount, currency,
// transferId). We pay into ONE merchant virtual account, so the amount is the
// only thing that can tell two open invoices apart. See docs/payments/README.md.

import { BILLING } from "./plans.config";
import { getPlan, periodTotalKobo } from "./pricing";
import {
  newId,
  readDb,
  update,
  type Customer,
  type Db,
  type Invoice,
} from "./store";
import type { Interval, PlanId } from "./plans.config";

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const hours = (h: number) => h * 3600_000;

/** Add calendar months in UTC, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

const isOpen = (i: Invoice, t = now()) =>
  i.status === "pending" && new Date(i.expiresAt) > t;

// ---------- customers ----------

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export function upsertCustomer(db: Db, name: string, email: string): Customer {
  const e = email.trim().toLowerCase();
  if (!validEmail(e)) throw new HttpError(400, "Enter a valid email address.");
  const n = name.trim();
  if (n.length < 2) throw new HttpError(400, "Enter your name.");
  let c = db.customers.find((x) => x.email === e);
  if (!c) {
    c = { id: newId("cus"), name: n.slice(0, 80), email: e, createdAt: iso(now()) };
    db.customers.push(c);
  }
  return c;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Scan (free): just create the account + a subscription that never expires. No BMONI call. */
export function signUpFree(name: string, email: string) {
  return update((db) => {
    const c = upsertCustomer(db, name, email);
    let sub = db.subscriptions.find((s) => s.customerId === c.id && s.planId === "scan");
    if (!sub) {
      sub = {
        id: newId("sub"),
        customerId: c.id,
        planId: "scan",
        interval: "monthly",
        status: "active",
        currentPeriodEnd: null,
        createdAt: iso(now()),
      };
      db.subscriptions.push(sub);
    }
    return { customer: c, subscription: sub };
  });
}

// ---------- invoices ----------

/**
 * Create (or return the customer's still-open) invoice for a paid plan.
 * Price comes ONLY from config; the caller passes plan id + interval.
 */
export function createInvoice(args: {
  name?: string;
  email?: string;
  customerId?: string;
  planId: unknown;
  interval: Interval;
  renewal?: boolean;
}) {
  return update((db) => {
    const plan = getPlan(args.planId);
    if (!plan) throw new HttpError(400, "Unknown plan.");
    if (plan.kind !== "paid") throw new HttpError(400, "This plan is not paid online.");

    const customer = args.customerId
      ? db.customers.find((c) => c.id === args.customerId)
      : upsertCustomer(db, args.name ?? "", args.email ?? "");
    if (!customer) throw new HttpError(404, "Customer not found.");

    const t = now();
    const existing = db.invoices.find(
      (i) =>
        i.customerId === customer.id &&
        i.planId === plan.id &&
        i.interval === args.interval &&
        isOpen(i, t),
    );
    if (existing) return { customer, invoice: existing, reused: true };

    const baseKobo = periodTotalKobo(plan, args.interval);
    const used = new Set(db.invoices.filter((i) => isOpen(i, t)).map((i) => i.amountKobo));
    let tag = 0;
    for (let k = 1; k <= 99; k++) {
      if (!used.has(baseKobo + k)) {
        tag = k;
        break;
      }
    }
    if (!tag) throw new HttpError(503, "Too many open invoices for this amount. Try again shortly.");

    const invoice: Invoice = {
      id: newId("inv"),
      customerId: customer.id,
      planId: plan.id,
      interval: args.interval,
      baseKobo,
      amountKobo: baseKobo + tag,
      status: "pending",
      createdAt: iso(t),
      expiresAt: iso(new Date(t.getTime() + hours(BILLING.invoiceTtlHours))),
      renewal: args.renewal,
    };
    db.invoices.push(invoice);

    // Pending subscription (does not grant access until paid).
    const hasSub = db.subscriptions.some(
      (s) => s.customerId === customer.id && s.planId === plan.id,
    );
    if (!hasSub) {
      db.subscriptions.push({
        id: newId("sub"),
        customerId: customer.id,
        planId: plan.id,
        interval: args.interval,
        status: "pending",
        currentPeriodEnd: null,
        createdAt: iso(t),
      });
    }
    return { customer, invoice, reused: false };
  });
}

export function getInvoiceView(id: string) {
  const db = readDb();
  const invoice = db.invoices.find((i) => i.id === id);
  if (!invoice) return null;
  const sub = db.subscriptions.find(
    (s) => s.customerId === invoice.customerId && s.planId === invoice.planId,
  );
  // Report expiry even if the daily job has not run yet.
  const status =
    invoice.status === "pending" && !isOpen(invoice) ? "expired" : invoice.status;
  return { invoice: { ...invoice, status }, subscription: sub ?? null };
}

// ---------- payment ----------

function markPaid(db: Db, invoice: Invoice, via: NonNullable<Invoice["paidVia"]>, txId?: string) {
  const t = now();
  invoice.status = "paid";
  invoice.paidAt = iso(t);
  invoice.paidVia = via;
  invoice.depositTxId = txId;

  const plan = getPlan(invoice.planId)!;
  let sub = db.subscriptions.find(
    (s) => s.customerId === invoice.customerId && s.planId === invoice.planId,
  );
  if (!sub) {
    sub = {
      id: newId("sub"),
      customerId: invoice.customerId,
      planId: plan.id as PlanId,
      interval: invoice.interval,
      status: "pending",
      currentPeriodEnd: null,
      createdAt: iso(t),
    };
    db.subscriptions.push(sub);
  }
  // Paying early extends from the current end, not from today.
  const start =
    sub.status === "active" && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > t
      ? new Date(sub.currentPeriodEnd)
      : t;
  sub.status = "active";
  sub.interval = invoice.interval;
  sub.currentPeriodEnd = iso(addMonths(start, BILLING.periodMonths[invoice.interval]));
  sub.reminderSentAt = undefined;

  db.notifications.push({
    id: newId("ntf"),
    at: iso(t),
    customerId: invoice.customerId,
    kind: "payment_received",
    message: `Payment received for ${plan.name} (${invoice.interval}). Active until ${sub.currentPeriodEnd}.`,
  });
}

/**
 * Apply an incoming deposit. Idempotent on txId / eventId. Matches an OPEN
 * invoice by exact amount; anything else is stored as unmatched for a human.
 */
export function applyDeposit(d: {
  amountKobo: number;
  txId?: string;
  eventId?: string;
  via: NonNullable<Invoice["paidVia"]>;
}) {
  return update((db) => {
    const dedupeKey = d.eventId ?? d.txId;
    if (dedupeKey && db.processedEvents.includes(dedupeKey)) {
      return { matched: false, duplicate: true as const };
    }
    if (dedupeKey) db.processedEvents.push(dedupeKey);
    if (d.txId && d.txId !== dedupeKey) db.processedEvents.push(d.txId);
    db.processedEvents = db.processedEvents.slice(-2000);

    // A real deposit also raises the wallet balance. Advance the baseline so the
    // balance-check fallback does not count the same money a second time.
    // (Simulated payments move no money, and balance-path deposits set it themselves.)
    if (d.via === "webhook" && db.merchant.lastBalanceKobo !== undefined) {
      db.merchant.lastBalanceKobo += d.amountKobo;
    }

    const t = now();
    const matches = db.invoices.filter((i) => isOpen(i, t) && i.amountKobo === d.amountKobo);
    if (matches.length !== 1) {
      db.unmatchedDeposits.push({
        at: iso(t),
        amountKobo: d.amountKobo,
        txId: d.txId,
        eventId: d.eventId,
        note: matches.length === 0 ? "No open invoice with this exact amount." : "More than one open invoice matches.",
      });
      return { matched: false, duplicate: false as const };
    }
    markPaid(db, matches[0], d.via, d.txId);
    return { matched: true, duplicate: false as const, invoiceId: matches[0].id };
  });
}

// ---------- daily job ----------

export function runDailyJob(at = now()) {
  return update((db) => {
    const out = { invoicesExpired: 0, subscriptionsExpired: 0, remindersSent: 0, renewalInvoices: 0 };

    for (const i of db.invoices) {
      if (i.status === "pending" && new Date(i.expiresAt) <= at) {
        i.status = "expired";
        out.invoicesExpired++;
      }
    }

    for (const s of db.subscriptions) {
      if (s.planId === "scan") continue; // free forever
      const end = s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null;

      if (s.status === "active" && end && end <= at) {
        s.status = "expired";
        out.subscriptionsExpired++;
        db.notifications.push({
          id: newId("ntf"),
          at: iso(at),
          customerId: s.customerId,
          kind: "subscription_expired",
          message: `Your ${getPlan(s.planId)?.name} subscription expired because the last invoice was not paid.`,
        });
        continue;
      }

      // Reminder + renewal invoice shortly before the period ends.
      if (s.status === "active" && end && !s.reminderSentAt) {
        const left = end.getTime() - at.getTime();
        if (left <= BILLING.reminderDaysBeforeEnd * 24 * hours(1)) {
          const plan = getPlan(s.planId)!;
          const open = db.invoices.find(
            (i) => i.customerId === s.customerId && i.planId === s.planId && isOpen(i, at),
          );
          let inv = open;
          if (!inv) {
            const base = periodTotalKobo(plan, s.interval);
            const used = new Set(db.invoices.filter((x) => isOpen(x, at)).map((x) => x.amountKobo));
            let tag = 0;
            for (let k = 1; k <= 99 && !tag; k++) if (!used.has(base + k)) tag = k;
            if (tag) {
              inv = {
                id: newId("inv"),
                customerId: s.customerId,
                planId: s.planId,
                interval: s.interval,
                baseKobo: base,
                amountKobo: base + tag,
                status: "pending",
                createdAt: iso(at),
                // stays payable until the period actually ends (+ the usual window)
                expiresAt: iso(new Date(Math.max(end.getTime(), at.getTime() + hours(BILLING.invoiceTtlHours)))),
                renewal: true,
              };
              db.invoices.push(inv);
              out.renewalInvoices++;
            }
          }
          s.reminderSentAt = iso(at);
          out.remindersSent++;
          db.notifications.push({
            id: newId("ntf"),
            at: iso(at),
            customerId: s.customerId,
            kind: "renewal_reminder",
            message: `Your ${plan.name} plan ends on ${end.toDateString()}. Pay invoice ${inv?.id ?? ""} to keep it. (Not paying = it simply lapses.)`,
          });
        }
      }
    }
    return out;
  });
}
