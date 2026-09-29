"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icons } from "@/components/ds";

const BLUE = "#185DF1";
const BLUE_TEXT = "var(--accent-text)";
const GREEN = "var(--success, #2BB673)";

const EYEBROW: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.96px", textTransform: "uppercase", color: "var(--text-muted)" };
const TITLE: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, lineHeight: "28px", letterSpacing: "-0.4px", color: "var(--text)", margin: 0 };
const DESC: CSSProperties = { fontSize: 14, lineHeight: "21px", color: "var(--text-secondary)", margin: 0, textWrap: "pretty" };
const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 11px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  fontSize: 12,
  color: "var(--text-secondary)",
};

function IconTile({ name }: { name: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 11,
        color: BLUE_TEXT,
        flexShrink: 0,
        background: "color-mix(in srgb, " + BLUE + " 16%, transparent)",
        border: "1px solid color-mix(in srgb, " + BLUE + " 32%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <Icons name={name} size={17} />
    </span>
  );
}

function BentoCard({
  className,
  index,
  num,
  eyebrow,
  icon,
  title,
  description,
  children,
}: {
  className?: string;
  index: number;
  num: string;
  eyebrow: string;
  icon: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const track = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    e.currentTarget.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
  };
  return (
    <div className={"gv-bento " + (className || "")} onPointerMove={track} style={{ animationDelay: index * 110 + "ms" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <span style={EYEBROW}>
          {num} — {eyebrow}
        </span>
        <IconTile name={icon} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <h3 style={TITLE}>{title}</h3>
        <p style={DESC}>{description}</p>
      </div>
      {children}
    </div>
  );
}

function SearchVisual() {
  const bar = (h: number, fill: string, glow?: boolean) => (
    <span style={{ width: 30, height: h, borderRadius: 8, background: fill, boxShadow: glow ? "0 0 20px rgba(24,93,241,.45)" : "none" }} />
  );
  return (
    <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 28, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          {bar(34, "var(--surface-2)")}
          <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Now · 34th</span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          {bar(84, BLUE, true)}
          <span style={{ fontSize: 11, color: BLUE_TEXT, whiteSpace: "nowrap" }}>Page one</span>
        </span>
      </div>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 22 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 26, lineHeight: "28px", letterSpacing: "-0.6px", color: "var(--text)" }}>+265</span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>clicks you could win</span>
      </span>
      <span style={{ ...CHIP, marginLeft: "auto", marginBottom: 22, whiteSpace: "nowrap" }}>bakery near me · 880/mo · rank 34th</span>
    </div>
  );
}

function DraftVisual() {
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ padding: 15, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ ...EYEBROW, fontSize: 9 }}>SEO article · draft</span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14, lineHeight: "19px", color: "var(--text)" }}>
          Where to find fresh bread near you in Lagos
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {["100%", "92%", "68%"].map((w) => (
            <span key={w} style={{ width: w, height: 5, borderRadius: 6, background: "var(--border)" }} />
          ))}
        </span>
      </div>
      <div style={{ ...CHIP, alignItems: "flex-start", borderRadius: 12, padding: "11px 12px" }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 6, border: "1.5px solid currentColor", position: "relative", opacity: 0.85 }}>
          <span style={{ position: "absolute", inset: 4, borderRadius: "50%", border: "1.5px solid currentColor" }} />
        </span>
        <span style={{ lineHeight: "17px" }}>
          Trays out at 7am. Tag a friend who needs one. <span style={{ color: BLUE_TEXT }}>#lagosbakery</span>
        </span>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, flexShrink: 0 }} />
        Draft · you approve, nothing auto-sends
      </span>
    </div>
  );
}

function RoutingVisual() {
  const chans: [string, boolean][] = [
    ["Email", true],
    ["SMS", false],
    ["Call", false],
  ];
  return (
    <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ ...CHIP, flexShrink: 0 }}>Customer</span>
      <span aria-hidden="true" style={{ width: 22, height: 54, flexShrink: 0, position: "relative" }}>
        <span style={{ position: "absolute", left: 0, top: "50%", width: 10, height: 1, background: "var(--border)" }} />
        <span style={{ position: "absolute", left: 10, top: 6, bottom: 6, width: 1, background: "var(--border)" }} />
        {([6, "50%", "calc(100% - 7px)"] as (number | string)[]).map((t, i) => (
          <span key={i} style={{ position: "absolute", left: 10, top: t, width: 12, height: 1, background: i === 0 ? BLUE : "var(--border)" }} />
        ))}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {chans.map(([c, on]) => (
          <span
            key={c}
            style={{
              ...CHIP,
              padding: "5px 10px",
              fontSize: 11,
              color: on ? "#FFFFFF" : "var(--text-secondary)",
              background: on ? BLUE : "var(--surface-2)",
              borderColor: on ? BLUE : "var(--border)",
            }}
          >
            {c}
          </span>
        ))}
      </span>
    </div>
  );
}

function TelemetryVisual() {
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 66 }}>
        {[32, 44, 38, 56, 62, 51, 76, 84, 100].map((h, i) => (
          <span key={i} style={{ flex: 1, height: h + "%", borderRadius: 5, background: i > 5 ? BLUE : "var(--surface-2)" }} />
        ))}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-0.4px", color: "var(--text)" }}>+410 clicks</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
          <span className="gv-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />
          learning
        </span>
      </span>
    </div>
  );
}

export function CapabilityBento() {
  return (
    <div className="gv-bento-grid">
      <BentoCard
        className="gv-bento-a"
        index={0}
        num="01"
        eyebrow="Search data"
        icon="telemetry"
        title="It finds the gap in your search"
        description="Groville reads your site and Google Search Console, then names the single biggest query you're missing. Right now for Ada's Bakery: 'bakery near me', 880 searches a month, ranked 34th."
      >
        <SearchVisual />
      </BentoCard>
      <BentoCard
        className="gv-bento-b"
        index={1}
        num="02"
        eyebrow="Drafting"
        icon="work-flow"
        title="Campaigns drafted in your voice"
        description="An SEO article and matching social posts, ready for you to review. Nothing goes live without your approval."
      >
        <DraftVisual />
      </BentoCard>
      <BentoCard index={2} num="03" eyebrow="Routing" icon="link" title="The right channel, per person" description="Email, SMS or a call list, chosen by what that customer actually answers.">
        <RoutingVisual />
      </BentoCard>
      <BentoCard index={3} num="04" eyebrow="Telemetry" icon="vital-sign" title="Every result, measured" description="Clicks and rankings per campaign. Groville learns what worked before it drafts the next one.">
        <TelemetryVisual />
      </BentoCard>
    </div>
  );
}
