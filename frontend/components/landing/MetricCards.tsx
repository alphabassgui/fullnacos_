"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const BLUE_M = "#185DF1";
const GREEN_M = "var(--success, #2BB673)";
const RM = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useInView(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < (window.innerHeight || 0) * 0.92 && r.bottom > 0) {
        setSeen(true);
        return true;
      }
      return false;
    };
    if (check()) return;
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const t = setInterval(check, 400);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      clearInterval(t);
    };
  }, [seen]);
  return [ref, seen];
}

function useCountUp(target: number, seen: boolean, decimals?: number) {
  const [v, setV] = useState(RM ? target : 0);
  useEffect(() => {
    if (RM || !seen) return;
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min((Date.now() - start) / 1400, 1);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p >= 1) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [seen, target]);
  return decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-US");
}

const M_EYEBROW: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" };
const M_DESC: CSSProperties = { fontSize: 14, lineHeight: "20px", color: "var(--text-secondary)", margin: 0, textWrap: "pretty" };

function DotGrid() {
  const dots = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6 }}>
      {dots.map((i) => (
        <span
          key={i}
          style={{
            aspectRatio: "1",
            borderRadius: "50%",
            background: i < 41 ? BLUE_M : "var(--surface-2)",
            opacity: i < 41 ? 0.55 + (i % 7) * 0.065 : 1,
            boxShadow: i < 41 && i % 11 === 0 ? "0 0 10px rgba(24,93,241,.5)" : "none",
          }}
        />
      ))}
    </div>
  );
}

function Sparkline() {
  const pts = "0,44 26,38 52,40 78,30 104,32 130,21 156,17 182,8";
  return (
    <svg viewBox="0 0 182 52" width="100%" height="64" preserveAspectRatio="none" aria-hidden="true" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="gvSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE_M} stopOpacity="0.34" />
          <stop offset="100%" stopColor={BLUE_M} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={pts + " 182,52 0,52"} fill="url(#gvSparkFill)" />
      <polyline points={pts} fill="none" stroke={BLUE_M} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx="182" cy="8" r="3.4" fill={BLUE_M} stroke="var(--bg)" strokeWidth="1.6" />
    </svg>
  );
}

function StepTimeline() {
  const steps: [string, boolean][] = [
    ["Connect", true],
    ["Scan", false],
    ["First draft · 9 min", false],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {steps.map(([label, active], i) => (
          <Fragment key={label}>
            {i > 0 && <span style={{ flex: 1, height: 1, background: "var(--border)" }} />}
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                flexShrink: 0,
                background: active ? BLUE_M : "var(--surface-2)",
                border: "1px solid " + (active ? BLUE_M : "var(--border)"),
                boxShadow: active ? "0 0 12px rgba(24,93,241,.6)" : "none",
              }}
            />
          </Fragment>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
        {steps.map(([label], i) => (
          <span
            key={label}
            style={{
              color: i === 2 ? "var(--accent-text)" : "var(--text-muted)",
              textAlign: i === 0 ? "left" : i === 1 ? "center" : "right",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  index,
  label,
  target,
  decimals,
  unit,
  badge,
  visual,
  description,
}: {
  index: number;
  label: string;
  target: number;
  decimals?: number;
  unit: string;
  badge?: boolean;
  visual: ReactNode;
  description: string;
}) {
  const [ref, seen] = useInView();
  const value = useCountUp(target, seen, decimals);
  const track = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    e.currentTarget.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
  };
  return (
    <div ref={ref} onPointerMove={track} className={"gv-bento gv-metric" + (seen ? " is-in" : "")} style={{ minHeight: 280, gap: 16, animationDelay: index * 130 + "ms" }}>
      <span style={M_EYEBROW}>
        / <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
      </span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "clamp(32px, 3.2vw, 44px)",
            lineHeight: 1.1,
            letterSpacing: "var(--track-h2)",
            color: "var(--text)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 18, marginLeft: unit === "%" ? -6 : 0, color: "var(--text-secondary)" }}>{unit}</span>
        {badge && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: GREEN_M,
              background: "color-mix(in srgb, #2BB673 14%, transparent)",
              border: "1px solid color-mix(in srgb, #2BB673 34%, transparent)",
              borderRadius: 8,
              padding: "4px 8px",
              whiteSpace: "nowrap",
            }}
          >
            ▲ trending up
          </span>
        )}
      </span>
      <div style={{ marginTop: 4 }}>{visual}</div>
      <p style={{ ...M_DESC, marginTop: "auto" }}>{description}</p>
    </div>
  );
}

export function MetricCards() {
  return (
    <div className="gv-metric-grid">
      <MetricCard index={0} label="Reach" target={1284} unit="search clicks" visual={<DotGrid />} description="Counted on the first scan, straight from your search data, with no set-up from you." />
      <MetricCard index={1} label="Lift" target={18.4} decimals={1} unit="%" badge visual={<Sparkline />} description="Median reply rate across drafted campaigns in the last 90 days." />
      <MetricCard index={2} label="Time" target={9} unit="min" visual={<StepTimeline />} description="From connecting a data source to the first campaign ready to approve." />
    </div>
  );
}
