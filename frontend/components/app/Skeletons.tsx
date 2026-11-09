"use client";

/**
 * Skeletons — per-page loading placeholders shown while a screen's data resolves.
 *
 * These render as the scrollable `<main>` that slots into `DashboardShell`
 * (the shell already paints the real sidebar + top bar), so each skeleton only
 * mirrors the *content* layout of its page — the bento board, the GTM run panel,
 * the campaigns stack, the results metrics, the connections form, the draft card.
 *
 * Design parity: the "bone" fills + shimmer come straight from the Groville
 * skeleton spec. Colours are theme-scoped CSS variables (dark = default / warm
 * cream for light), so a bone is never grey or blue-in-light. The shimmer sweep
 * is replaced by a gentle opacity pulse under prefers-reduced-motion. Nothing is
 * invented: tints match the dashboard surface tokens.
 */

import type { CSSProperties, ReactNode } from "react";
import { C } from "./shell";
import { useIsMobile } from "./use-media-query";

/* ------------------------------------------------------------------ styles */

const SKELETON_CSS = `
:root, :root[data-theme="dark"], .dark{
  --gv-bone:#0F2145; --gv-bone-strong:#16305C;
  --gv-bone-btn:rgba(24,93,241,0.30); --gv-bone-shimmer:rgba(91,140,240,0.10);
}
:root[data-theme="light"], .light{
  --gv-bone:#F0E9DC; --gv-bone-strong:#E8DFCE;
  --gv-bone-btn:rgba(24,93,241,0.16); --gv-bone-shimmer:rgba(255,252,247,0.65);
}
.gv-bone{position:relative;overflow:hidden;background:var(--gv-bone);border-radius:6px;flex:none}
.gv-bone::after{content:"";position:absolute;inset:0;
  background:linear-gradient(100deg,transparent 30%,var(--gv-bone-shimmer) 50%,transparent 70%);
  transform:translateX(-200%);animation:gv-bone-sweep 1.8s ease-in-out infinite}
@keyframes gv-bone-sweep{to{transform:translateX(200%)}}
.gv-bone--strong{background:var(--gv-bone-strong)}
.gv-bone--btn{background:var(--gv-bone-btn);border-radius:10px}
.gv-sk-bento{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(118px,auto);gap:16px}
.gv-sk-bento .gv-sk-hero{grid-column:span 2;grid-row:span 2}
.gv-sk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:860px){
  .gv-sk-bento{grid-template-columns:1fr;grid-auto-rows:auto}
  .gv-sk-bento .gv-sk-hero{grid-column:auto;grid-row:auto;min-height:280px}
  .gv-sk-grid2{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .gv-bone::after{display:none}
  .gv-bone{animation:gv-bone-pulse 2s ease-in-out infinite}
  @keyframes gv-bone-pulse{0%,100%{opacity:.5}50%{opacity:.8}}
}
`;

function SkeletonStyles() {
  return (
    <style href="gv-skeletons" precedence="high">
      {SKELETON_CSS}
    </style>
  );
}

/* ----------------------------------------------------------------- bone */

type BoneVariant = "default" | "strong" | "btn";

function Bone({
  w,
  h,
  r,
  variant = "default",
  style,
}: {
  w: number | string;
  h: number | string;
  /** border-radius override (number px) */
  r?: number;
  variant?: BoneVariant;
  style?: CSSProperties;
}) {
  const cls =
    "gv-bone" +
    (variant === "strong" ? " gv-bone--strong" : variant === "btn" ? " gv-bone--btn" : "");
  return (
    <div
      className={cls}
      aria-hidden="true"
      style={{ width: w, height: h, ...(r !== undefined ? { borderRadius: r } : null), ...style }}
    />
  );
}

/* Small shape helpers */
function Pill({ w, h }: { w: number | string; h: number }) {
  return <Bone w={w} h={h} r={999} />;
}
function Circle({ d }: { d: number }) {
  return <Bone w={d} h={d} r={d / 2} />;
}

/** Card chrome matching the real dashboard cards (flat surface, 1px border, 16 radius). */
const cardStyle: CSSProperties = {
  position: "relative",
  background: C.s1,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: "20px 20px 20px 24px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const dividerStyle: CSSProperties = { height: 1, background: C.border, margin: "2px 0" };

const ghostNumeral: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 18,
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: 38,
  color: C.muted,
  opacity: 0.15,
  lineHeight: 1,
  pointerEvents: "none",
};

/* ----------------------------------------------------------------- main wrapper */

function SkeletonMain({
  children,
  padding,
  maxWidth,
  gap,
}: {
  children: ReactNode;
  padding: string;
  maxWidth?: number;
  gap?: number;
}) {
  return (
    <main
      style={{ flex: 1, overflowY: "auto", background: C.bg, minWidth: 0 }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <SkeletonStyles />
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        Loading…
      </span>
      <div
        style={{
          maxWidth,
          margin: maxWidth ? "0 auto" : undefined,
          padding,
          display: "flex",
          flexDirection: "column",
          gap: gap ?? 28,
        }}
      >
        {children}
      </div>
    </main>
  );
}

/** Page headline block: a tall 2-line heading + a subline. */
function HeadBlock({ w1 = "70%", w2 = "44%", sub = "56%" }: { w1?: string; w2?: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Bone w={w1} h={26} />
      <Bone w={w2} h={26} />
      <Bone w={sub} h={14} style={{ marginTop: 4 }} />
    </div>
  );
}

/* ================================================================= pages */

/** Opportunities — bento board: one hero card (01) + five smaller cards. */
export function OpportunitiesSkeleton() {
  const m = useIsMobile();
  return (
    <SkeletonMain padding={m ? "24px 16px 40px" : "clamp(20px, 3vw, 32px)"} maxWidth={1180} gap={28}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <HeadBlock />
        <Bone w={124} h={40} r={999} />
      </div>
      <div className="gv-sk-bento">
        <OppHeroCard />
        {["02", "03", "04", "05", "06"].map((n) => (
          <OppSmallCard key={n} n={n} />
        ))}
      </div>
    </SkeletonMain>
  );
}

function OppHeroCard() {
  return (
    <div className="gv-sk-hero" style={{ ...cardStyle, padding: 26 }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: C.blue }} />
      <span style={{ ...ghostNumeral, fontSize: 54 }}>01</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Pill w={84} h={24} />
        <Pill w={94} h={24} />
        <span style={{ marginLeft: "auto" }}>
          <Pill w={70} h={22} />
        </span>
      </div>
      <Bone w="66%" h={22} style={{ marginTop: 2 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Bone w="100%" h={12} />
        <Bone w="82%" h={12} />
      </div>
      <Bone w={60} h={11} style={{ marginTop: 2 }} />
      <Bone w="50%" h={12} />
      <Bone w={76} h={11} style={{ marginTop: 2 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {["72%", "62%", "80%"].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Circle d={8} />
            <Bone w={w} h={11} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: "auto" }}>
        <Bone w={110} h={16} />
      </div>
    </div>
  );
}

function OppSmallCard({ n }: { n: string }) {
  return (
    <div style={cardStyle}>
      <span style={ghostNumeral}>{n}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Pill w={84} h={22} />
        <Pill w={94} h={22} />
      </div>
      <Bone w="74%" h={18} style={{ marginTop: 2 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Bone w="100%" h={11} />
        <Bone w="68%" h={11} />
      </div>
      <Pill w={70} h={22} />
      <div style={{ marginTop: "auto" }}>
        <Bone w={100} h={14} />
      </div>
    </div>
  );
}

/** GTM — headline, full-width run button, one past-run row. */
export function GtmSkeleton() {
  const m = useIsMobile();
  return (
    <SkeletonMain padding={m ? "24px 16px 40px" : "32px 40px 48px"} maxWidth={920} gap={0}>
      <Bone w={40} h={10} style={{ marginBottom: 14 }} />
      <Bone w="74%" h={26} style={{ marginBottom: 8 }} />
      <Bone w="54%" h={26} style={{ marginBottom: 14 }} />
      <Bone w="90%" h={13} style={{ marginBottom: 6 }} />
      <Bone w="68%" h={13} style={{ marginBottom: 24 }} />
      <Bone w="100%" h={52} variant="btn" style={{ marginBottom: 24 }} />
      <Bone w={70} h={13} style={{ marginBottom: 12 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          background: C.s1,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: "16px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill w={96} h={24} />
          <Bone w={120} h={14} />
        </div>
        <Bone w={68} h={16} />
      </div>
    </SkeletonMain>
  );
}

/** Campaigns — eyebrow, headline, "waiting for you" + 3 draft cards. */
export function CampaignsSkeleton() {
  const m = useIsMobile();
  return (
    <SkeletonMain padding={m ? "24px 16px 40px" : "32px 40px 48px"} maxWidth={920} gap={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: C.good, flex: "none" }} />
        <Bone w={158} h={11} />
      </div>
      <Bone w="80%" h={28} style={{ margin: "12px 0 8px" }} />
      <Bone w="58%" h={28} style={{ marginBottom: 12 }} />
      <Bone w="56%" h={13} style={{ marginBottom: 24 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <Bone w={120} h={16} />
        <Bone w={92} h={13} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Pill w={88} h={22} />
              <Pill w={122} h={22} />
            </div>
            <Bone w="54%" h={20} style={{ marginTop: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Bone w="100%" h={12} />
              <Bone w="86%" h={12} />
            </div>
            <Bone w={132} h={40} variant="btn" style={{ marginTop: 2 }} />
          </div>
        ))}
      </div>
    </SkeletonMain>
  );
}

/** Results — headline, 2 metric cards, "what I learned" + 3 learning cards. */
export function ResultsSkeleton() {
  const m = useIsMobile();
  return (
    <SkeletonMain padding={m ? "24px 16px 40px" : "clamp(20px, 3vw, 32px)"} maxWidth={920} gap={0}>
      <Bone w="70%" h={26} style={{ marginBottom: 8 }} />
      <Bone w="46%" h={26} style={{ marginBottom: 12 }} />
      <Bone w="70%" h={13} style={{ marginBottom: 24 }} />
      <Bone w={110} h={11} style={{ marginBottom: 14 }} />
      <div className="gv-sk-grid2">
        {[0, 1].map((i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <Bone w={128} h={12} />
              <Pill w={72} h={22} />
            </div>
            <Bone w={54} h={40} style={{ margin: "4px 0" }} />
            <Bone w={118} h={11} />
            <div style={dividerStyle} />
            <Bone w="70%" h={10} />
          </div>
        ))}
      </div>
      <Bone w={120} h={11} style={{ margin: "28px 0 14px" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Circle d={18} />
                <Bone w={118} h={11} />
              </div>
              <Bone w={140} h={11} />
            </div>
            <Bone w="58%" h={16} style={{ marginTop: 2 }} />
            <Bone w={74} h={10} style={{ marginTop: 2 }} />
            <Bone w="88%" h={11} />
          </div>
        ))}
      </div>
    </SkeletonMain>
  );
}

/** Connections — headline + business form card + a connected-tool card. */
export function ConnectionsSkeleton() {
  const m = useIsMobile();
  return (
    <SkeletonMain padding={m ? "24px 16px 40px" : "clamp(20px, 3vw, 32px)"} maxWidth={720} gap={0}>
      <Bone w={104} h={11} style={{ marginBottom: 14 }} />
      <Bone w="68%" h={26} style={{ marginBottom: 8 }} />
      <Bone w="40%" h={26} style={{ marginBottom: 14 }} />
      <Bone w="90%" h={13} style={{ marginBottom: 6 }} />
      <Bone w="70%" h={13} style={{ marginBottom: 24 }} />

      <div style={{ ...cardStyle, padding: 26 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <Bone w={40} h={40} r={10} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Bone w={120} h={16} />
            <Bone w={240} h={11} style={{ marginTop: 8 }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
          {[
            { label: 96, tall: false },
            { label: 70, tall: false },
            { label: 64, tall: false },
            { label: 88, tall: true },
          ].map((f, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Bone w={f.label} h={11} />
              <Bone w="100%" h={f.tall ? 90 : 44} r={10} />
            </div>
          ))}
        </div>
        <Bone w={130} h={42} variant="btn" style={{ marginTop: 2 }} />
        <div style={{ ...dividerStyle, margin: "6px 0" }} />
        <div
          style={{
            height: 44,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Bone w={110} h={12} />
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 26, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <Bone w={40} h={40} r={10} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Bone w={150} h={15} />
              <Bone w={220} h={11} style={{ marginTop: 8 }} />
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              padding: "6px 12px",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: C.good, flex: "none" }} />
            <Bone w={58} h={10} />
          </span>
        </div>
      </div>
    </SkeletonMain>
  );
}

/** Campaign draft — one large draft card. */
export function CampaignDraftSkeleton() {
  const m = useIsMobile();
  return (
    <SkeletonMain padding={m ? "20px 16px 32px" : "clamp(20px, 3vw, 32px)"} gap={32}>
      <div style={{ ...cardStyle, padding: 26, maxWidth: 820 }}>
        <Bone w="50%" h={22} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          <Bone w="100%" h={12} />
          <Bone w="100%" h={12} />
          <Bone w="96%" h={12} />
          <Bone w="68%" h={12} />
        </div>
        <div style={{ ...dividerStyle, margin: "6px 0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Bone w={150} h={44} variant="btn" />
          <span
            style={{
              width: 120,
              height: 44,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Bone w={70} h={12} />
          </span>
        </div>
      </div>
    </SkeletonMain>
  );
}
