"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ds";

type Currency = "NGN" | "USD";

const PR_CUR: Record<Currency, { sym: string; code: string; group: boolean; line: string }> = {
  NGN: { sym: "₦", code: "NGN", group: true, line: "Billed in Naira. No dollar card, no FX surprise." },
  USD: { sym: "$", code: "USD", group: true, line: "Billed in USD. Cards and invoices welcome." },
};

type Tier = {
  name: string;
  blurb: string;
  price: Record<Currency, number>;
  annual?: Record<Currency, number>;
  saves?: Record<Currency, string>;
  perDay?: { monthly: string; annual: string };
  cta: string;
  ctaHref: string;
  popular?: boolean;
  filled?: boolean;
  micro?: string;
  features: string[];
  excluded?: string[];
  bold?: string;
};

const PR_TIERS: Tier[] = [
  {
    name: "Scan",
    blurb: "For shops trying Groville out.",
    price: { NGN: 0, USD: 0 },
    cta: "Start free",
    ctaHref: "/signup",
    features: ["1 website connected", "1 campaign a month", "Weekly digest", "Email support"],
    excluded: ["Email, SMS & call routing", "Full telemetry & learning"],
  },
  {
    name: "Growth",
    blurb: "For one shop growing on purpose.",
    popular: true,
    price: { NGN: 30000, USD: 59 },
    annual: { NGN: 24000, USD: 47 },
    saves: { NGN: "Save ₦72,000 a year", USD: "Save $144 a year" },
    perDay: { monthly: "≈ ₦1,000 a day", annual: "≈ ₦800 a day" },
    cta: "Start free",
    ctaHref: "/signup",
    filled: true,
    micro: "No card required. Cancel anytime.",
    features: ["Everything in Scan", "10 campaigns a month", "Email, SMS & call routing", "Full telemetry & learning", "Guardrails & approval rules", "Priority support"],
    bold: "10 campaigns a month",
  },
  {
    name: "Studio",
    blurb: "For multi-location shops & agencies.",
    price: { NGN: 90000, USD: 149 },
    annual: { NGN: 72000, USD: 119 },
    saves: { NGN: "Save ₦216,000 a year", USD: "Save $360 a year" },
    perDay: { monthly: "≈ ₦3,000 a day", annual: "≈ ₦2,400 a day" },
    cta: "Talk to us",
    ctaHref: "/signup",
    features: ["Everything in Growth", "Unlimited campaigns", "Multiple websites", "Team seats", "Dedicated success manager"],
    bold: "Unlimited campaigns",
  },
];

const prFmt = (n: number, cur: Currency) => PR_CUR[cur].sym + n.toLocaleString("en-US");

function PrIcon({ name }: { name: "check" | "cross" | "shield" }) {
  const p: Record<string, ReactNode> = {
    check: <path d="M3.2 8.4l3.1 3.1 6.5-6.9" />,
    cross: (
      <g>
        <path d="M4 4l8 8" />
        <path d="M12 4l-8 8" />
      </g>
    ),
    shield: <path d="M8 1.9l4.6 1.8v4c0 2.7-1.8 5-4.6 6.4C5.2 12.7 3.4 10.4 3.4 7.7v-4z" />,
  };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
}

function PrSwap({ children, k }: { children: ReactNode; k: string }) {
  const [shown, setShown] = useState<ReactNode>(children);
  const [swap, setSwap] = useState(false);
  const key = useRef(k);
  useEffect(() => {
    if (k === key.current) {
      setShown(children);
      return;
    }
    key.current = k;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced motion: swap instantly, no transition
      setShown(children);
      return;
    }
    setSwap(true);
    const t = setTimeout(() => {
      setShown(children);
      setSwap(false);
    }, 150);
    return () => clearTimeout(t);
  }, [k, children]);
  return <span className={"gv-pr-swap" + (swap ? " is-swap" : "")}>{shown}</span>;
}

function PrCard({ tier, cur, annual, index }: { tier: Tier; cur: Currency; annual: boolean; index: number }) {
  const free = tier.price[cur] === 0;
  const now = free ? 0 : annual && tier.annual ? tier.annual[cur] : tier.price[cur];
  const was = annual && !free ? tier.price[cur] : null;
  const sub = free ? "free forever" : annual ? "billed annually" : "billed monthly";
  const perDay = cur === "NGN" && tier.perDay ? tier.perDay[annual ? "annual" : "monthly"] : null;
  const k = cur + (annual ? "a" : "m");
  return (
    <div className={"gv-pr-card card-elevated" + (tier.popular ? " is-hero card-accent" : "")} style={{ animationDelay: index * 120 + "ms" }}>
      {tier.popular && <span className="gv-pr-sheen" aria-hidden="true" />}
      <div className="gv-pr-body">
        <div className="gv-pr-name-row">
          <span className="gv-pr-name">{tier.name}</span>
          {tier.popular && <span className="gv-pr-pop">Most popular</span>}
        </div>
        <p className="gv-pr-blurb">{tier.blurb}</p>
        <div className="gv-pr-price">
          <PrSwap k={k}>
            <span className="gv-pr-num">{prFmt(now, cur)}</span>
          </PrSwap>
          {!free && <span className="gv-pr-per">/mo</span>}
        </div>
        <div className="gv-pr-meta">
          <span className="gv-pr-sub">{sub}</span>
          {was !== null && tier.saves && (
            <span className="gv-pr-wasrow">
              <s className="gv-pr-was">{prFmt(was, cur)}</s>
              <span className="gv-pr-chip">{tier.saves[cur]}</span>
            </span>
          )}
          {perDay && <span className="gv-pr-day">{perDay}</span>}
        </div>
        <div className="gv-pr-ctablock">
          <Link href={tier.ctaHref} className="gv-pr-cta-wrap">
            <Button hierarchy={tier.filled ? "primary" : "secondary gray"} size="lg" style={{ width: "100%" }}>
              {tier.cta}
            </Button>
          </Link>
          {tier.micro && <span className="gv-pr-micro">{tier.micro}</span>}
        </div>
        <ul className="gv-pr-list">
          {tier.features.map((f) => (
            <li key={f} className="gv-pr-item">
              <span className="gv-pr-ic">
                <PrIcon name="check" />
              </span>
              {f === tier.bold ? <strong className="gv-pr-hook">{f}</strong> : f}
            </li>
          ))}
          {(tier.excluded || []).map((f) => (
            <li key={f} className="gv-pr-item is-off">
              <span className="gv-pr-ic">
                <PrIcon name="cross" />
              </span>
              <s>{f}</s>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Pricing() {
  const [annual, setAnnual] = useState(false);
  const [cur, setCur] = useState<Currency>("NGN");
  const grid = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        }),
      { rootMargin: "-10% 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="gv-pr">
      <span className="gv-pr-glow-b" aria-hidden="true" />
      <span className="gv-pr-glow-t" aria-hidden="true" />
      <div className="gv-pr-head">
        <span className="gv-pr-chip-eyebrow">Pricing</span>
        <h2 className="gv-pr-h2">
          Pricing that <em className="gv-pr-accent">grows</em> with you.
        </h2>
        <p className="gv-pr-lede">Start free. Pay only when Groville is winning you customers, no per-seat math.</p>
        <div className="gv-pr-controls">
          <div className="gv-pr-seg" role="group" aria-label="Billing period">
            <button type="button" className={"gv-pr-opt tab" + (annual ? "" : " is-on is-selected")} aria-pressed={!annual} onClick={() => setAnnual(false)}>
              Monthly
            </button>
            <button type="button" className={"gv-pr-opt tab" + (annual ? " is-on is-selected" : "")} aria-pressed={annual} onClick={() => setAnnual(true)}>
              Annual<span className="gv-pr-save">Save 20%</span>
            </button>
          </div>
          <div className="gv-pr-seg" role="group" aria-label="Currency">
            {(["NGN", "USD"] as Currency[]).map((c) => (
              <button key={c} type="button" className={"gv-pr-opt tab" + (cur === c ? " is-on is-selected" : "")} aria-pressed={cur === c} onClick={() => setCur(c)}>
                {PR_CUR[c].sym} {c}
              </button>
            ))}
          </div>
        </div>
        <span className="gv-pr-curline">
          <span className="gv-pr-curcheck">
            <PrIcon name="check" />
          </span>
          <PrSwap k={cur}>{PR_CUR[cur].line}</PrSwap>
        </span>
      </div>
      <div className="gv-pr-grid" ref={grid}>
        {PR_TIERS.map((t, i) => (
          <PrCard key={t.name} tier={t} cur={cur} annual={annual} index={i} />
        ))}
      </div>
      <span className="gv-pr-trust">
        <span className="gv-pr-shield">
          <PrIcon name="shield" />
        </span>
        Read-only. Groville can&apos;t edit your site or spend your money.
      </span>
    </div>
  );
}
