"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icons, Logomark } from "@/components/ds";

const REDUCED =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The device screen always shows the dark app, in both page themes, so its
// colours are literal Signal Blue values rather than theme-reactive tokens.
const SC = {
  bg: "#060B18",
  s1: "#0A1A3A",
  s2: "#0F2145",
  border: "#1B2C50",
  text: "#F3F7FE",
  secondary: "#AEBBD4",
  muted: "#7C8BA8",
  blue: "#185DF1",
  blueText: "#5B8CF0",
};

// Measured from assets/images/iphone-frame.png (660x1350). The screen is a real
// transparent hole; our UI sits behind the PNG and fills exactly this rect.
const IMG = { w: 660, h: 1350 };
const HOLE = { l: 36, t: 33, w: 588, h: 1283, r: 76 };
const STATUS = 76; // baked status-bar strip, measured from the hole's top edge

const PHONE_H = 460;
const S = PHONE_H / IMG.h;
const PHONE_W = Math.round(IMG.w * S);
const SCREEN = { l: HOLE.l * S, t: HOLE.t * S, w: HOLE.w * S, h: HOLE.h * S, r: HOLE.r * S };

const DW = 270;
const K = SCREEN.w / DW;
const DH = SCREEN.h / K;
const DSTATUS = (STATUS * S) / K;

function PhoneTabBar() {
  const tabs: [string, string, boolean?][] = [
    ["telemetry", "Opportunities", true],
    ["work-flow", "Campaigns"],
    ["vital-sign", "Results"],
    ["link", "Connections"],
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 3,
        padding: "9px 6px 16px",
        borderTop: "1px solid " + SC.border,
        background: SC.s1,
      }}
    >
      {tabs.map(([icon, label, active]) => (
        <span key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: active ? SC.blue : SC.muted }}>
          <Icons name={icon} size={15} />
          <span style={{ fontSize: 8, lineHeight: "10px", letterSpacing: "0.1px" }}>{label}</span>
        </span>
      ))}
    </div>
  );
}

function GapPeek({ keyword, meta, width }: { keyword: string; meta: string; width: string }) {
  return (
    <div style={{ padding: "9px 11px", borderRadius: 12, background: SC.s1, border: "1px solid " + SC.border, display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 10, lineHeight: "13px", color: SC.text }}>{keyword}</span>
      <span style={{ fontSize: 9, lineHeight: "11px", color: SC.secondary }}>{meta}</span>
      <span style={{ height: 4, borderRadius: 8, background: SC.border }}>
        <span style={{ display: "block", width, height: "100%", borderRadius: 8, background: SC.blue }} />
      </span>
    </div>
  );
}

function PhoneScreen() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: SC.bg, fontFamily: "var(--font-body)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: DSTATUS + "px 16px 10px" }}>
        <Logomark size={15} style={{ color: SC.text }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 17,
              height: 17,
              borderRadius: 100,
              background: SC.s2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontSize: 8,
              fontWeight: 600,
              color: SC.text,
            }}
          >
            AB
          </span>
          <span style={{ fontSize: 11, color: SC.text }}>Ada&apos;s Bakery</span>
        </span>
        <Icons name="bell" size={14} style={{ color: SC.secondary }} />
      </div>

      <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.8px", color: SC.muted }}>THIS WEEK</span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16, color: SC.text }}>I found 3 gaps.</span>
      </div>

      <div
        style={{
          margin: "12px 16px 0",
          padding: 13,
          borderRadius: 14,
          background: SC.s2,
          border: "1px solid " + SC.border,
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 9, lineHeight: "12px", color: SC.blueText }}>Biggest customer you&apos;re missing</span>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, lineHeight: "21px", letterSpacing: "-0.3px", color: SC.text }}>
              bakery near me
            </span>
            <span style={{ fontSize: 9, lineHeight: "12px", color: SC.secondary }}>880 a month · you rank 34th</span>
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, lineHeight: "17px", color: SC.text }}>+265</span>
            <span style={{ fontSize: 8, lineHeight: "10px", color: SC.secondary, textAlign: "right" }}>clicks you could win</span>
          </span>
        </div>
        <button
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: SC.blue,
            color: "#FFFFFF",
            fontFamily: "var(--font-body)",
            fontWeight: 500,
            fontSize: 11,
          }}
        >
          Draft the campaign
        </button>
      </div>

      <div style={{ margin: "10px 16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <GapPeek keyword="cake delivery lagos" meta="320 a month · rank 18th" width="46%" />
        <GapPeek keyword="wedding cake tasting" meta="140 a month · unranked" width="22%" />
      </div>

      <div style={{ marginTop: "auto" }}>
        <PhoneTabBar />
      </div>
    </div>
  );
}

function Phone({ style }: { style?: CSSProperties }) {
  return (
    <div style={{ position: "relative", width: PHONE_W, height: PHONE_H, ...style }}>
      <span
        aria-hidden="true"
        className="gv-bloom"
        style={{
          position: "absolute",
          left: "50%",
          top: "52%",
          width: PHONE_W * 1.5,
          height: PHONE_H * 0.82,
          transform: "translate(-50%,-50%)",
          borderRadius: "50%",
          pointerEvents: "none",
          background: "radial-gradient(closest-side, rgba(24,93,241,.2), rgba(24,93,241,.06) 44%, transparent 68%)",
          filter: "blur(26px)",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          bottom: -34,
          width: PHONE_W * 1.35,
          height: 72,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          pointerEvents: "none",
          background: "radial-gradient(closest-side, rgba(0,0,0,.72), rgba(0,0,0,.28) 55%, transparent 80%)",
          filter: "blur(22px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: SCREEN.l,
          top: SCREEN.t,
          width: SCREEN.w,
          height: SCREEN.h,
          borderRadius: SCREEN.r,
          overflow: "hidden",
          background: SC.bg,
        }}
      >
        <div style={{ width: DW, height: DH, transform: "scale(" + K + ")", transformOrigin: "top left" }}>
          <PhoneScreen />
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/iphone-frame.png"
        alt=""
        aria-hidden="true"
        style={{
          position: "relative",
          display: "block",
          width: PHONE_W,
          height: PHONE_H,
          pointerEvents: "none",
          filter: "drop-shadow(0 26px 44px rgba(0,0,0,.55))",
        }}
      />
    </div>
  );
}

// Glass Effect (Dark) — marketing surfaces only, never the app UI.
function AccentCard({ children, className = "", style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={("gv-glass card-elevated " + className).trim()}
      style={{
        position: "relative",
        padding: 22,
        boxSizing: "border-box",
        borderRadius: 20,
        background: "rgba(10,26,58,0.92)",
        backdropFilter: "blur(22px) saturate(1.4) brightness(1.05)",
        WebkitBackdropFilter: "blur(22px) saturate(1.4) brightness(1.05)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: ["0 34px 74px -24px rgba(0,0,0,0.78)", "inset 0 1px 0 rgba(255,255,255,0.30)", "inset 0 -1px 0 rgba(255,255,255,0.07)"].join(", "),
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 20,
          padding: 1,
          pointerEvents: "none",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.22) 26%, rgba(255,255,255,0.05) 52%, rgba(91,140,240,0.28) 78%, rgba(91,140,240,0.55) 100%)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "40%",
          borderRadius: "20px 20px 0 0",
          pointerEvents: "none",
          background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.03) 55%, rgba(255,255,255,0) 100%)",
        }}
      />
      {children}
    </div>
  );
}

const OVERLINE: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.9px", color: "var(--text-muted)" };

export function HeroVisual() {
  const float = REDUCED ? "none" : "groville-float 9s ease-in-out infinite";
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 1200, display: "flex", justifyContent: "center" }}>
      <div
        aria-hidden="true"
        className="gv-bloom"
        style={{
          position: "absolute",
          left: "50%",
          top: "4%",
          width: 900,
          height: 900,
          maxWidth: "150%",
          transform: "translateX(-50%)",
          pointerEvents: "none",
          background: "radial-gradient(closest-side, var(--hero-glow-core), var(--hero-glow-mid) 46%, transparent 72%)",
        }}
      />

      <div className="groville-rig" style={{ position: "relative", width: PHONE_W, height: PHONE_H, zIndex: 1 }}>
        <div className="groville-rig-float" style={{ position: "relative", width: "100%", height: "100%", animation: float, willChange: "transform" }}>
          <Phone />

          <div className="groville-accent groville-accent-left" style={{ position: "absolute", left: -238, bottom: 34, zIndex: 3, transform: "rotate(-7deg)" }}>
            <AccentCard style={{ width: 280 }}>
              <span style={OVERLINE}>THIS WEEK</span>
              {(
                [
                  ["Gaps found", "3"],
                  ["Drafts ready", "7"],
                  ["Reply rate", "18.4%"],
                ] as [string, string][]
              ).map(([l, v]) => (
                <span key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontSize: 15, color: "var(--text-secondary)" }}>{l}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{v}</span>
                </span>
              ))}
            </AccentCard>
          </div>

          <div className="groville-accent groville-accent-right" style={{ position: "absolute", right: -214, top: 28, zIndex: 3, transform: "rotate(6deg)" }}>
            <AccentCard className="card-accent" style={{ width: 250 }}>
              <span style={OVERLINE}>SHIPPED THIS MONTH</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, lineHeight: "42px", letterSpacing: "-1.2px", color: "var(--primary)" }}>+410</span>
                <span style={{ fontSize: 15, color: "var(--text-secondary)" }}>clicks won</span>
              </span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>rank 18 → 9</span>
            </AccentCard>
          </div>
        </div>
      </div>
    </div>
  );
}
