"use client";

/**
 * Checkout — the 3-screen bank-transfer payment flow for a paid plan (default
 * Growth). The plan comes from the `tier` prop (app/pay/page.tsx reads it off
 * ?tier=); all display copy and prices derive from lib/billing/plans.config.ts.
 *
 * Ported pixel-for-pixel from the Claude Design export (docs/payment-reference.html,
 * decoded bundle module). The reference is a static preview with a floating state
 * switcher and hardcoded values; here the same layout is wired to the real backend:
 *
 *   details  →  POST /api/subscribe            (create invoice, get bank + exact amount)
 *   transfer →  GET  /api/invoices/{id} (poll) (waiting for the transfer to land)
 *   confirming (poll continues after Simulate) → verified | expired
 *
 * HONESTY BOUNDARY: this DRAFTS and CONFIRMS a bank transfer only. There are no card
 * fields, nothing charges automatically, and the sandbox "Simulate payment" control is
 * clearly labelled. The required copy from the design is preserved verbatim.
 *
 * The page assumes an authenticated user; name/email/business are read from the single
 * useUser() resolver (lib/use-user.ts) — the real Supabase user when auth is configured,
 * otherwise the mock demo user. Route gating for /pay lives in proxy.ts, not here.
 *
 * Class names are payment-scoped (gvpay-*) to avoid colliding with the landing CSS in
 * globals.css (e.g. gv-pulse there is a different keyframe). Tokens and keyframes are
 * injected once via a scoped <style> block, mirroring DashboardShell's canvas pattern.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Icons, Wordmark } from "@/components/ds";
import { useUser } from "@/lib/use-user";
import { getPlan, priceAll } from "@/lib/billing/pricing";
import type { PlanId } from "@/lib/billing/plans.config";
import { hasCompletedOnboarding } from "@/lib/onboarding";

// Product surface tokens — Signal Blue dashboard values, flip under data-theme="light".
const C = {
  bg: "var(--bg)",
  s1: "var(--surface-1)",
  s2: "var(--surface-2)",
  border: "var(--border)",
  text: "var(--text)",
  secondary: "var(--text-secondary)",
  muted: "var(--text-muted)",
  blue: "var(--primary)",
  blueText: "var(--accent-text)",
  good: "var(--success)",
  bad: "var(--error)",
} as const;
const DISPLAY = "var(--font-display)";
const BODY = "var(--font-body)";
const SERIF: CSSProperties = { fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400 };
const NUM: CSSProperties = { fontFamily: DISPLAY, fontVariantNumeric: "tabular-nums" };

type Currency = "NGN" | "USD";

/** Display-only formatted prices for one currency. The amount the customer
 *  actually transfers is amountNgn from the API, never a price sent from the
 *  browser. */
type PriceSet = { sym: string; monthly: string; annualTotal: string; annualPerMo: string };

/**
 * Formatted display prices for a plan, in both currencies, derived from the
 * single source of truth (lib/billing/plans.config.ts via priceAll) so no price
 * is ever hardcoded here. USD is display-only; when a plan has no USD price the
 * fields read "—".
 */
function pricesFor(id: PlanId): Record<Currency, PriceSet> {
  const m = priceAll("monthly").find((p) => p.id === id);
  const a = priceAll("annual").find((p) => p.id === id);
  const grp = (n: number) => n.toLocaleString("en-US");
  const usd = (n: number | null | undefined) => (n != null ? grp(n) : "—");
  return {
    NGN: {
      sym: "₦",
      monthly: grp(m?.billedNgn ?? 0),
      annualTotal: grp(a?.billedNgn ?? 0),
      annualPerMo: grp(a?.perMonthNgn ?? 0),
    },
    USD: {
      sym: "$",
      monthly: usd(m?.perMonthUsd),
      annualTotal: usd(a?.perMonthUsd != null ? a.perMonthUsd * 12 : null),
      annualPerMo: usd(a?.perMonthUsd),
    },
  };
}
type Cycle = "Monthly" | "Annual";
type Bank = { accountNumber: string; bankName: string; accountName: string };
type Invoice = {
  invoiceId: string;
  amountNgn: number;
  expiresAt: string;
  demo: boolean;
  bank: Bank;
};
type FlowState = "details" | "transfer" | "confirming" | "verified" | "expired";

// ── formatting ──────────────────────────────────────────────────────────────
/** ₦30,000.37 — exact, always with kobo, so the customer sends the matching amount. */
function formatNgn(amount: number): string {
  return (
    "₦" +
    amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** "47h 59m left" from an ISO expiry; empty once it has passed. */
function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "0h 0m left";
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

// ── shared bits ───────────────────────────────────────────────────────────────
function Label({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.muted }}>{children}</span>;
}

function SegToggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        borderRadius: 8,
        background: C.bg,
        border: "1px solid " + C.border,
      }}
    >
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o)}
            className="gvpay-focus"
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: on ? C.s2 : "transparent",
              boxShadow: on ? "inset 0 0 0 1px " + C.border : "none",
              fontFamily: BODY,
              fontWeight: on ? 500 : 400,
              fontSize: 13,
              lineHeight: "18px",
              color: on ? C.text : C.muted,
              whiteSpace: "nowrap",
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: BODY,
          fontWeight: strong ? 500 : 400,
          fontSize: strong ? 15 : 14,
          lineHeight: "22px",
          color: strong ? C.text : C.secondary,
        }}
      >
        {label}
      </span>
      <span
        style={{
          ...NUM,
          fontWeight: strong ? 600 : 500,
          fontSize: strong ? 17 : 14,
          lineHeight: "22px",
          color: strong ? C.text : C.secondary,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PlanSummary({
  cycle,
  setCycle,
  currency,
  setCurrency,
  planName,
  prices,
}: {
  cycle: Cycle;
  setCycle: (c: Cycle) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  planName: string;
  prices: Record<Currency, PriceSet>;
}) {
  const p = prices[currency];
  const annual = cycle === "Annual";
  const total = p.sym + (annual ? p.annualTotal : p.monthly);
  return (
    <section
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: "clamp(20px, 2.4vw, 32px)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div className="gvpay-toggles" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SegToggle label="Billing period" options={["Monthly", "Annual"] as const} value={cycle} onChange={setCycle} />
        <SegToggle label="Currency" options={["NGN", "USD"] as const} value={currency} onChange={setCurrency} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: "clamp(26px, 3vw, 34px)",
            lineHeight: 1.16,
            letterSpacing: "-0.8px",
            color: C.text,
          }}
        >
          Start <em style={SERIF}>{planName}</em>
        </h2>
        <span style={{ fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary }}>{planName} plan</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {annual ? (
          <SumRow label={planName + " annual (" + p.sym + p.annualPerMo + "/mo)"} value={p.sym + p.annualTotal} />
        ) : (
          <SumRow label={planName + " monthly"} value={p.sym + p.monthly} />
        )}
        {annual && (
          <div style={{ display: "flex" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid var(--gv-badge-line)",
                background: "var(--gv-badge-fill)",
                fontFamily: BODY,
                fontSize: 12,
                lineHeight: "16px",
                color: C.blueText,
              }}
            >
              Billed yearly · save 20%
            </span>
          </div>
        )}
        <SumRow label="Subtotal" value={total} />
        <div style={{ height: 1, background: C.border }} />
        <SumRow label="Total due today" value={total} strong />
        {currency === "USD" && (
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 12, lineHeight: "18px", color: C.muted, textWrap: "pretty" }}>
            USD shown for reference. You pay by bank transfer in Naira.
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: 16,
          borderRadius: 12,
          background: C.bg,
          border: "1px solid " + C.border,
        }}
      >
        <Icons name="timelapse" size={16} style={{ color: C.muted, flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 13, lineHeight: "19px", color: C.secondary, textWrap: "pretty" }}>
          Your plan renews each period. Groville never charges you automatically. You approve each renewal by transfer.
        </p>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  type = "text",
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: BODY, fontWeight: 500, fontSize: 13, lineHeight: "18px", color: C.text }}>{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="gvpay-focus"
        style={{
          width: "100%",
          minHeight: 44,
          padding: "11px 14px",
          borderRadius: 8,
          background: C.bg,
          border: "1px solid " + C.border,
          color: C.text,
          fontFamily: BODY,
          fontSize: 15,
          lineHeight: "22px",
        }}
      />
      {hint && <Label>{hint}</Label>}
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="gvpay-btn gvpay-focus"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 48,
        padding: "13px 24px",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        textDecoration: "none",
        background: C.blue,
        color: "var(--text-on-primary)",
        fontFamily: BODY,
        fontWeight: 500,
        fontSize: 15,
        lineHeight: "22px",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="gvpay-btn gvpay-focus"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 44,
        padding: "11px 18px",
        cursor: disabled ? "not-allowed" : "pointer",
        background: "transparent",
        border: "1px solid " + C.border,
        fontFamily: BODY,
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "20px",
        color: C.text,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function TrustLine() {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <Icons name="shield" size={16} style={{ color: C.muted, flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "19px", color: C.muted, textWrap: "pretty" }}>
        Bank transfer only. Groville never sees your card and never charges you automatically.
      </span>
    </div>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: 16,
        borderRadius: 12,
        background: "var(--gv-warn-fill)",
        border: "1px solid " + C.bad,
      }}
    >
      <Icons name="alert-triangle" size={16} style={{ color: C.bad, flexShrink: 0, marginTop: 2 }} />
      <p style={{ margin: 0, fontFamily: BODY, fontWeight: 500, fontSize: 13, lineHeight: "19px", color: C.bad, textWrap: "pretty" }}>
        {children}
      </p>
    </div>
  );
}

// ── details ────────────────────────────────────────────────────────────────
function DetailsPanel({
  form,
  setForm,
  onContinue,
  busy,
  error,
}: {
  form: { name: string; businessName: string; email: string; phone: string };
  setForm: (patch: Partial<typeof form>) => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onContinue();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 24 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h3 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, fontSize: 20, lineHeight: "26px", color: C.text }}>
          Who is this for
        </h3>
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
          I use these details to match your transfer and send your receipt.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Full name" placeholder="Ada Obi" value={form.name} onChange={(v) => setForm({ name: v })} autoComplete="name" />
        <Field
          label="Business name"
          placeholder="Ada's Bakery"
          value={form.businessName}
          onChange={(v) => setForm({ businessName: v })}
          autoComplete="organization"
        />
        <Field
          label="Work email"
          type="email"
          placeholder="ada@adasbakery.com"
          value={form.email}
          onChange={(v) => setForm({ email: v })}
          autoComplete="email"
        />
        <Field
          label="Phone number"
          type="tel"
          placeholder="+234 801 234 5678"
          hint="For payment confirmation only"
          value={form.phone}
          onChange={(v) => setForm({ phone: v })}
          autoComplete="tel"
        />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "Setting up your transfer…" : "Continue to payment"}
      </PrimaryButton>
      <TrustLine />
    </form>
  );
}

// ── transfer ───────────────────────────────────────────────────────────────
function CopyRow({
  label,
  value,
  copyText,
  big,
  caption,
}: {
  label: string;
  value: string;
  copyText: string;
  big?: boolean;
  caption?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the value is on
      // screen to copy by hand, so we still show the acknowledgement.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [copyText]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: big ? 10 : 6,
        padding: big ? 20 : 16,
        borderRadius: 12,
        background: C.bg,
        border: "1px solid " + C.border,
      }}
    >
      <Label>{label}</Label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            ...NUM,
            flex: 1,
            minWidth: 0,
            fontWeight: 600,
            fontSize: big ? "clamp(28px, 4vw, 38px)" : 17,
            lineHeight: big ? 1.1 : "24px",
            letterSpacing: big ? "-0.8px" : 0,
            color: C.text,
            wordBreak: "break-word",
          }}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={"Copy " + label.toLowerCase()}
          className="gvpay-focus"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minHeight: 36,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid " + C.border,
            background: C.s2,
            cursor: "pointer",
            fontFamily: BODY,
            fontSize: 13,
            lineHeight: "20px",
            color: copied ? C.good : C.blueText,
            flexShrink: 0,
          }}
        >
          <Icons name={copied ? "tick" : "api"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {caption && (
        <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "18px", color: C.muted, textWrap: "pretty" }}>{caption}</span>
      )}
    </div>
  );
}

function PlainRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16, borderRadius: 12, background: C.bg, border: "1px solid " + C.border }}>
      <Label>{label}</Label>
      <span style={{ fontFamily: BODY, fontWeight: 500, fontSize: 15, lineHeight: "22px", color: C.text }}>{value}</span>
    </div>
  );
}

function WaitingPill({ remaining }: { remaining: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid var(--gv-badge-line)",
          background: "var(--gv-badge-fill)",
          fontFamily: BODY,
          fontSize: 13,
          lineHeight: "18px",
          color: C.blueText,
        }}
      >
        <span
          className="gvpay-spin"
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            borderRadius: 100,
            flexShrink: 0,
            border: "2px solid var(--gv-badge-line)",
            borderTopColor: C.blue,
          }}
        />
        Waiting for payment
      </span>
      <span style={{ ...NUM, fontSize: 13, lineHeight: "18px", color: C.muted }}>{remaining}</span>
    </div>
  );
}

function TransferPanel({
  invoice,
  remaining,
  onSimulate,
  simulating,
  error,
}: {
  invoice: Invoice;
  remaining: string;
  onSimulate: () => void;
  simulating: boolean;
  error: string | null;
}) {
  const amount = formatNgn(invoice.amountNgn);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, fontSize: 20, lineHeight: "26px", color: C.text }}>
          Transfer exactly
        </h3>
        <WaitingPill remaining={remaining} />
      </div>

      {invoice.demo && (
        <ErrorNote>Demo account — not a real account. Do not transfer real money.</ErrorNote>
      )}

      <CopyRow
        big
        label="Amount to transfer"
        value={amount}
        copyText={invoice.amountNgn.toFixed(2)}
        caption="Send this exact amount, including the kobo. That is how we match your payment."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CopyRow
          label="Account number"
          value={invoice.bank.accountNumber}
          copyText={invoice.bank.accountNumber.replace(/\s/g, "")}
        />
        <PlainRow label="Bank name" value={invoice.bank.bankName} />
        <PlainRow label="Account name" value={invoice.bank.accountName} />
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 20,
          borderRadius: 12,
          background: C.bg,
          border: "1px dashed " + C.border,
        }}
      >
        <span
          style={{
            alignSelf: "flex-start",
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px solid " + C.border,
            fontFamily: BODY,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: C.muted,
          }}
        >
          Sandbox
        </span>
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 13, lineHeight: "19px", color: C.secondary, textWrap: "pretty" }}>
          Sandbox demo only. This marks the invoice paid the same way a real transfer would. No money moves.
        </p>
        <div style={{ display: "flex" }}>
          <SecondaryButton onClick={onSimulate} disabled={simulating}>
            {simulating ? "Simulating…" : "Simulate payment"}
          </SecondaryButton>
        </div>
      </div>

      <TrustLine />
    </div>
  );
}

// ── confirming ───────────────────────────────────────────────────────────────
function Confirming() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "clamp(24px, 6vw, 64px) 24px",
        textAlign: "center",
      }}
    >
      <div style={{ position: "relative", width: 96, height: 96, display: "grid", placeItems: "center" }}>
        <span
          className="gvpay-pulse"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, borderRadius: 999, border: "1px solid var(--gv-badge-line)" }}
        />
        <span
          className="gvpay-pulse gvpay-pulse-b"
          aria-hidden="true"
          style={{ position: "absolute", inset: 14, borderRadius: 999, border: "1px solid var(--gv-badge-line)" }}
        />
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            background: C.s2,
            border: "1px solid " + C.border,
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icons name="bolt" size={20} style={{ color: C.blueText }} />
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 440 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: "clamp(26px, 3.4vw, 34px)",
            lineHeight: 1.18,
            letterSpacing: "-0.8px",
            color: C.text,
            textWrap: "pretty",
          }}
        >
          Confirming your <em style={SERIF}>transfer</em>
        </h2>
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 15, lineHeight: "23px", color: C.secondary, textWrap: "pretty" }}>
          I&apos;m checking for your payment. This usually takes a few moments.
        </p>
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="gvpay-dot"
            style={{ width: 8, height: 8, borderRadius: 999, background: C.blue, animationDelay: i * 0.18 + "s" }}
          />
        ))}
      </div>
      <p style={{ margin: 0, maxWidth: 400, fontFamily: BODY, fontSize: 13, lineHeight: "19px", color: C.muted, textWrap: "pretty" }}>
        I only confirm what I can see. Nothing activates until your transfer lands.
      </p>
    </div>
  );
}

// ── verified ───────────────────────────────────────────────────────────────
function DetailLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16, padding: "14px 0", borderTop: "1px solid " + C.border }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          fontFamily: BODY,
          fontWeight: strong ? 500 : 400,
          fontSize: 14,
          lineHeight: "21px",
          color: strong ? C.text : C.secondary,
        }}
      >
        {label}
      </span>
      <span
        style={{
          ...NUM,
          fontWeight: strong ? 600 : 500,
          fontSize: strong ? 17 : 14,
          lineHeight: "22px",
          color: C.text,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Verified({
  invoice,
  cycle,
  paidAt,
  planName,
}: {
  invoice: Invoice;
  cycle: Cycle;
  paidAt: string | null;
  planName: string;
}) {
  // Post-payment routing: a user who has finished onboarding goes straight to
  // the dashboard; a new / not-yet-onboarded user is sent into the setup flow
  // (welcome → onboarding → analysing → opportunities+tour). Verified only ever
  // renders on the client (gated by client flow state), so reading the flag here
  // is safe. See lib/onboarding.ts.
  const onboarded = hasCompletedOnboarding();
  const destination = onboarded ? "/opportunities" : "/welcome";
  const ctaLabel = onboarded ? "Go to my dashboard" : "Continue setup";
  const when = paidAt ? new Date(paidAt) : new Date();
  const dateStr = when.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(24px, 5vw, 56px) clamp(16px, 4vw, 32px)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          background: C.s1,
          border: "1px solid " + C.border,
          borderRadius: 16,
          padding: "clamp(24px, 3.4vw, 40px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: "var(--gv-good-fill)",
            border: "1px solid var(--gv-good-line)",
          }}
        >
          <Icons name="tick" size={26} style={{ color: C.good }} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "center" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: "clamp(26px, 3.4vw, 32px)",
              lineHeight: 1.18,
              letterSpacing: "-0.8px",
              color: C.text,
              textWrap: "pretty",
            }}
          >
            Payment <em style={SERIF}>verified</em>
          </h2>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 15, lineHeight: "23px", color: C.secondary, textWrap: "pretty" }}>
            {planName} is active. I&apos;ll get to work on your first campaign.
          </p>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
          <DetailLine label="Reference" value={invoice.invoiceId} />
          <DetailLine label="Method" value="Bank transfer" />
          <DetailLine label="Date & time" value={dateStr} />
          <DetailLine label="Plan" value={planName + (cycle === "Annual" ? " annual" : " monthly")} />
          <DetailLine label="Total" value={formatNgn(invoice.amountNgn)} strong />
        </div>
        <div style={{ width: "100%", display: "flex" }}>
          <Link
            href={destination}
            className="gvpay-btn gvpay-focus"
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 48,
              padding: "13px 24px",
              textDecoration: "none",
              background: C.blue,
              color: "var(--text-on-primary)",
              fontFamily: BODY,
              fontWeight: 500,
              fontSize: 15,
              lineHeight: "22px",
            }}
          >
            {ctaLabel}
          </Link>
        </div>
      </section>
    </div>
  );
}

// ── expired (not in the reference; honest addition for the expired invoice path) ──
function Expired({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(24px, 5vw, 56px) clamp(16px, 4vw, 32px)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          background: C.s1,
          border: "1px solid " + C.border,
          borderRadius: 16,
          padding: "clamp(24px, 3.4vw, 40px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: "var(--gv-warn-fill)",
            border: "1px solid " + C.bad,
          }}
        >
          <Icons name="alert-triangle" size={26} style={{ color: C.bad }} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "center" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: "clamp(26px, 3.4vw, 32px)",
              lineHeight: 1.18,
              letterSpacing: "-0.8px",
              color: C.text,
              textWrap: "pretty",
            }}
          >
            This payment link <em style={SERIF}>expired</em>
          </h2>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 15, lineHeight: "23px", color: C.secondary, textWrap: "pretty" }}>
            No transfer landed in time and nothing was charged. Start again to get a fresh amount and account.
          </p>
        </div>
        <div style={{ width: "100%", display: "flex" }}>
          <PrimaryButton onClick={onRetry}>
            <span style={{ flex: 1, textAlign: "center" }}>Start again</span>
          </PrimaryButton>
        </div>
      </section>
    </div>
  );
}

function PaymentHeader() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px clamp(16px, 3vw, 32px)",
        borderBottom: "1px solid " + C.border,
        flexShrink: 0,
      }}
    >
      <Link href="/opportunities" aria-label="Back to Opportunities" className="gvpay-focus" style={{ display: "flex", padding: 4 }}>
        <Icons name="chevron-left" size={18} style={{ color: C.secondary }} />
      </Link>
      <Wordmark size={20} style={{ color: C.text }} />
      <span style={{ marginLeft: "auto", fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.muted }}>
        Secure bank transfer
      </span>
    </header>
  );
}

// ── scoped CSS: payment tokens, focus ring, button radius, keyframes ─────────
// This is a dashboard-context page: flat solid surfaces, no glass, no blue blooms.
// The landing's ambient dark glows (globals.css body::before/::after etc.) must be
// suppressed here (they also inflate page height on taller states), same as
// DashboardShell's canvas fix. Light has no such glows.
const PAY_CSS = `
html[data-theme="dark"] body::before,html[data-theme="dark"] body::after,html[data-theme="dark"]::before,html[data-theme="dark"] #root::after{content:none!important;display:none!important}
html[data-theme="dark"],html[data-theme="dark"] body{background:var(--bg)!important}
:root{--gv-badge-fill:rgba(24,93,241,.12);--gv-badge-line:rgba(24,93,241,.34);--gv-good-fill:rgba(47,191,113,.12);--gv-good-line:rgba(47,191,113,.34);--gv-warn-fill:rgba(229,72,77,.10)}
:root[data-theme="light"]{--gv-badge-fill:rgba(24,93,241,.08);--gv-badge-line:rgba(24,93,241,.26);--gv-good-fill:rgba(23,147,90,.10);--gv-good-line:rgba(23,147,90,.28);--gv-warn-fill:rgba(229,72,77,.07)}
.gvpay-focus:focus-visible{outline:2px solid var(--link);outline-offset:3px}
.gvpay-btn{border-radius:10px}
@media (max-width:720px){.gvpay-btn{border-radius:999px;width:100%}.gvpay-grid{grid-template-columns:minmax(0,1fr)!important}}
@keyframes gvpay-spin{to{transform:rotate(360deg)}}
@keyframes gvpay-pulse{0%{transform:scale(.86);opacity:.9}70%{transform:scale(1.12);opacity:0}100%{transform:scale(1.12);opacity:0}}
@keyframes gvpay-bounce{0%,100%{opacity:.28;transform:translateY(3px)}50%{opacity:1;transform:translateY(-3px)}}
.gvpay-spin{animation:gvpay-spin .9s linear infinite}
.gvpay-pulse{animation:gvpay-pulse 2.4s ease-out infinite}
.gvpay-pulse-b{animation-delay:1.2s}
.gvpay-dot{animation:gvpay-bounce 1.2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.gvpay-spin,.gvpay-pulse,.gvpay-dot{animation:none!important}.gvpay-dot{opacity:.6}}
`;

const POLL_MS = 4000;

/** Read `{ error }` from a failed response, falling back to a generic message. */
async function errorFrom(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* non-JSON body */
  }
  return "Something went wrong. Please try again.";
}

export function PaymentScreen({ tier = "growth" }: { tier?: PlanId }) {
  // The plan being purchased. Falls back to Growth for an unknown id so the page
  // never renders empty. All display copy and prices derive from this.
  const plan = getPlan(tier) ?? getPlan("growth")!;
  const planName = plan.name;
  const prices = pricesFor(plan.id);

  // The signed-in user (real Supabase user when configured, else the mock "Ada").
  const user = useUser();
  const [state, setState] = useState<FlowState>("details");
  const [cycle, setCycle] = useState<Cycle>("Monthly");
  const [currency, setCurrency] = useState<Currency>("NGN");
  const [form, setFormState] = useState({
    name: user.name ?? "",
    businessName: user.businessName ?? "",
    email: user.email ?? "",
    phone: "",
  });
  const setForm = (patch: Partial<typeof form>) => setFormState((f) => ({ ...f, ...patch }));

  // When the real user resolves after mount (Supabase auth), refresh the
  // prefilled fields — but only the ones the person has not edited themselves.
  // `phone` is never auto-sourced, so it is left untouched.
  const autoFilled = useRef({
    name: user.name ?? "",
    businessName: user.businessName ?? "",
    email: user.email ?? "",
  });
  useEffect(() => {
    const next = {
      name: user.name ?? "",
      businessName: user.businessName ?? "",
      email: user.email ?? "",
    };
    setFormState((f) => ({
      ...f,
      name: f.name === autoFilled.current.name ? next.name : f.name,
      businessName: f.businessName === autoFilled.current.businessName ? next.businessName : f.businessName,
      email: f.email === autoFilled.current.email ? next.email : f.email,
    }));
    autoFilled.current = next;
  }, [user.name, user.businessName, user.email]);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState("");
  const [busy, setBusy] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Create the invoice: the browser sends only { name, email, planId, interval }
  // (+ business/phone for our records); the server prices it and returns where to pay.
  const startTransfer = useCallback(async () => {
    setBusy(true);
    setDetailsError(null);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          businessName: form.businessName,
          phone: form.phone,
          planId: plan.id,
          interval: cycle === "Annual" ? "annual" : "monthly",
        }),
      });
      if (!res.ok) {
        setDetailsError(await errorFrom(res));
        return;
      }
      const data = (await res.json()) as Invoice;
      setInvoice({
        invoiceId: data.invoiceId,
        amountNgn: data.amountNgn,
        expiresAt: data.expiresAt,
        demo: !!data.demo,
        bank: data.bank,
      });
      setRemaining(timeLeft(data.expiresAt));
      setTransferError(null);
      setState("transfer");
    } catch {
      setDetailsError("I could not reach the payment service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [form, cycle, plan.id]);

  // Poll the invoice while waiting. paid -> verified, expired -> expired.
  useEffect(() => {
    if ((state !== "transfer" && state !== "confirming") || !invoice) return;
    let active = true;
    const tick = async () => {
      setRemaining(timeLeft(invoice.expiresAt));
      try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoice.invoiceId)}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!active || !res.ok) return;
        const data = await res.json();
        if (data.status === "paid") {
          setPaidAt(data.paidAt ?? null);
          setState("verified");
        } else if (data.status === "expired") {
          setState("expired");
        }
      } catch {
        // Transient network error — keep polling; the next tick may succeed.
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [state, invoice]);

  // Sandbox-only: mark the invoice paid through the same path a real deposit uses.
  const simulate = useCallback(async () => {
    if (!invoice) return;
    setSimulating(true);
    setTransferError(null);
    try {
      const res = await fetch("/api/sandbox/simulate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invoiceId: invoice.invoiceId }),
      });
      if (res.ok || res.status === 409) {
        // 409 = already paid; either way the confirming screen + poll resolves it.
        setState("confirming");
        return;
      }
      setTransferError(await errorFrom(res));
    } catch {
      setTransferError("I could not reach the payment service. Check your connection and try again.");
    } finally {
      setSimulating(false);
    }
  }, [invoice]);

  const reset = useCallback(() => {
    setInvoice(null);
    setPaidAt(null);
    setTransferError(null);
    setDetailsError(null);
    setState("details");
  }, []);

  const checkout = state === "details" || state === "transfer";

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: BODY }}>
      <style href="gvpay" precedence="high">
        {PAY_CSS}
      </style>
      <PaymentHeader />
      {checkout ? (
        <main
          className="gvpay-grid"
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
            padding: "clamp(24px, 4vw, 48px) clamp(16px, 3vw, 32px) 96px",
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.92fr) minmax(0, 1fr)",
            gap: "clamp(24px, 3vw, 40px)",
            alignItems: "start",
          }}
        >
          <PlanSummary cycle={cycle} setCycle={setCycle} currency={currency} setCurrency={setCurrency} planName={planName} prices={prices} />
          <div
            style={{
              background: C.s2,
              border: "1px solid " + C.border,
              borderRadius: 16,
              padding: "clamp(20px, 2.4vw, 32px)",
              minWidth: 0,
            }}
          >
            {state === "details" ? (
              <DetailsPanel form={form} setForm={setForm} onContinue={startTransfer} busy={busy} error={detailsError} />
            ) : (
              invoice && (
                <TransferPanel
                  invoice={invoice}
                  remaining={remaining}
                  onSimulate={simulate}
                  simulating={simulating}
                  error={transferError}
                />
              )
            )}
          </div>
        </main>
      ) : (
        <main style={{ flex: 1, display: "flex", flexDirection: "column", paddingBottom: 96 }}>
          {state === "confirming" && <Confirming />}
          {state === "verified" && invoice && <Verified invoice={invoice} cycle={cycle} paidAt={paidAt} planName={planName} />}
          {state === "expired" && <Expired onRetry={reset} />}
        </main>
      )}
    </div>
  );
}
