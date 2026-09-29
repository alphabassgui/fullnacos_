"use client";

import type { ReactNode } from "react";
import { AppIcon, Badge, Button, ButtonContainer, ButtonGroup, Icons, InputField, Navlink, Wordmark } from "@/components/ds";
import { Section, SectionHeader } from "./section";
import { HeroVisual } from "./HeroVisual";
import { CapabilityBento } from "./CapabilityBento";
import { MetricCards } from "./MetricCards";
import { Pipeline } from "./Pipeline";
import { VoiceCarousel } from "./VoiceCarousel";
import { Proof } from "./Proof";
import { Pricing } from "./Pricing";
import { FaqSplit } from "./FaqSplit";

export function Hero() {
  return (
    <div className="gv-hero" style={{ position: "relative", padding: "96px 24px 120px", display: "flex", flexDirection: "column", alignItems: "center", gap: 72, overflow: "hidden" }}>
      <div className="gv-hero-copy" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 40, maxWidth: 800, textAlign: "center" }}>
        <Badge>AI growth agent for small business</Badge>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "calc(var(--text-h1) * 1.08)",
            lineHeight: "var(--lh-h1)",
            letterSpacing: "-0.03em",
            color: "var(--text)",
          }}
        >
          The customers you are{" "}
          <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, color: "var(--accent-text)" }}>missing</em>, found.
        </h1>
        <p
          className="gv-hero-sub"
          style={{ margin: 0, maxWidth: 640, fontSize: "var(--text-body-md)", lineHeight: "var(--lh-body-md)", letterSpacing: "var(--track-body)", color: "var(--text-secondary)" }}
        >
          Groville reads your site and Google Search Console, finds the customers you&apos;re missing, and drafts the campaign to win them. You approve every move.
        </p>
        <div className="gv-hero-cta" style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
          <ButtonGroup className="gv-hero-cta-1" href="/signup">
            Start free
          </ButtonGroup>
          <ButtonContainer className="gv-hero-cta-2">Watch the 90-second demo</ButtonContainer>
        </div>
      </div>
      <HeroVisual />
    </div>
  );
}

const PARTNER_MARKS: Record<string, ReactNode> = {
  BMONI: (
    <g>
      <path d="M9 2 15.4 6.2 9 10.4 2.6 6.2z" />
      <path d="M9 9.6 15.4 13.8 9 18 2.6 13.8z" opacity=".55" />
    </g>
  ),
  NACOS: (
    <g>
      <circle cx="9" cy="9" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M11.4 11.6 15 15.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </g>
  ),
  "BUILD X": <path d="M10.4 1.8 3.6 10.2h4.1L7 16.2l7-8.8H9.7z" />,
  "Helix AI": <path d="M4 2.4h10v2.2L10 9l4 4.4v2.2H4v-2.2L8 9 4 4.6z" />,
  Oracle: (
    <g fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="7" cy="9" r="5.1" />
      <circle cx="11.6" cy="9" r="5.1" opacity=".6" />
    </g>
  ),
  "Command+R": (
    <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.6 2.6 2.8 9l3.8 6.4" />
      <path d="M11.4 2.6 15.2 9l-3.8 6.4" />
    </g>
  ),
  Catalog: <path d="M15 5.2A6.8 6.8 0 1 0 15 12.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />,
};

function PartnerLogo({ name }: { name: string }) {
  return (
    <span className="gv-logo" tabIndex={0} style={{ display: "inline-flex", alignItems: "center", gap: 9, flexShrink: 0, color: "var(--text-muted)" }}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
        {PARTNER_MARKS[name]}
      </svg>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 17, letterSpacing: "-0.2px", whiteSpace: "nowrap" }}>{name}</span>
    </span>
  );
}

const PARTNERS = ["BMONI", "NACOS", "BUILD X", "Helix AI", "Oracle", "Command+R", "Catalog"];

export function LogoStrip() {
  const set = (half: number) => (
    <span style={{ display: "flex", alignItems: "center", gap: 56, paddingRight: 56, flexShrink: 0 }} aria-hidden={half === 1 ? "true" : undefined}>
      {PARTNERS.map((n) => (
        <PartnerLogo key={n} name={n} />
      ))}
    </span>
  );
  return (
    <div style={{ position: "relative", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "36px var(--gutter)" }}>
      <span
        aria-hidden="true"
        className="gv-bloom"
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 880,
          maxWidth: "110%",
          height: 120,
          transform: "translate(-50%,-50%)",
          pointerEvents: "none",
          background: "radial-gradient(closest-side, rgba(24,93,241,.16), transparent 72%)",
        }}
      />
      <div className="gv-strip-static">
        <span className="gv-strip-label">Trusted by operators at</span>
        <div className="gv-strip-grid">
          {PARTNERS.map((n) => (
            <PartnerLogo key={n} name={n} />
          ))}
        </div>
      </div>
      <div className="gv-strip-row" style={{ position: "relative", maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 40 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.96px", color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
          TRUSTED BY OPERATORS AT
        </span>
        <div
          className="gv-marquee"
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)",
            maskImage: "linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent)",
          }}
        >
          <div className="gv-marquee-track" style={{ display: "flex", width: "max-content" }}>
            {set(0)}
            {set(1)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Capabilities() {
  return (
    <Section id="platform">
      <SectionHeader
        eyebrow="Capabilities"
        line1="Four primitives,"
        accent="combined"
        line2="into one agent."
        description="Every Groville campaign is built from the same four blocks. Set them once and the agent keeps working in the background."
      />
      <CapabilityBento />
    </Section>
  );
}

export function Benchmarks() {
  return (
    <Section className="section--cards" style={{ position: "relative", overflow: "hidden" }}>
      <div className="gv-bloom" style={{ position: "absolute", left: -300, top: -56, width: 800, height: 800, opacity: 0.15, background: "var(--gradient-mesh)", pointerEvents: "none" }} />
      <SectionHeader eyebrow="Built for real shops" line1="Numbers from" accent="live accounts." description="No marketing math. These are medians across live Groville accounts, refreshed weekly." />
      <MetricCards />
    </Section>
  );
}

export function Features() {
  return (
    <Section id="how-it-works">
      <SectionHeader eyebrow="Inside the agent" line1="Everything it does" accent="while you work." description="Six working parts. You see the output as a weekly digest and approve what goes out." />
      <Pipeline />
    </Section>
  );
}

export function Testimonials() {
  return (
    <Section className="section--cards" style={{ position: "relative" }}>
      <div className="gv-mesh" aria-hidden="true">
        <span className="gv-mesh-a" />
        <span className="gv-mesh-b" />
        <span className="gv-mesh-c" />
        <span className="gv-mesh-d" />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <VoiceCarousel />
      </div>
    </Section>
  );
}

export function ProofSection() {
  return (
    <Section className="gv-pf-section" style={{ position: "relative", overflow: "hidden" }}>
      <Proof />
    </Section>
  );
}

export function PricingSection() {
  return (
    <Section id="pricing" className="gv-pr-section section--cards" style={{ position: "relative", overflow: "hidden" }}>
      <Pricing />
    </Section>
  );
}

export function Faq() {
  return (
    <Section className="section--cards">
      <FaqSplit />
    </Section>
  );
}

export function CtaBand() {
  return (
    <Section style={{ position: "relative", overflow: "hidden", textAlign: "center" }}>
      <div className="gv-bloom" style={{ position: "absolute", left: "50%", top: "10%", width: 900, height: 900, transform: "translateX(-50%)", background: "var(--gradient-peak)", pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
        <AppIcon size={64} />
        <h2 style={{ margin: 0, maxWidth: 720, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-h2)", lineHeight: "var(--lh-h2)", letterSpacing: "var(--track-h2)", color: "var(--text)" }}>
          Find this week&apos;s <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, color: "var(--accent-text)" }}>three</em> customers.
        </h2>
        <p style={{ margin: 0, maxWidth: 520, fontSize: "var(--text-body-md)", lineHeight: "var(--lh-body-md)", color: "var(--text-secondary)" }}>
          Connect one data source and see the first segments in under ten minutes.
        </p>
        <div className="gv-close-cta" style={{ display: "flex", justifyContent: "center" }}>
          <ButtonGroup className="gv-close-cta-1" size="large" href="/signup" style={{ borderRadius: 10 }}>
            Start free
          </ButtonGroup>
        </div>
      </div>
    </Section>
  );
}

export function Footer() {
  const cols: [string, string[]][] = [
    ["Product", ["Segments", "Drafts", "Routing", "Telemetry", "Pricing"]],
    ["Company", ["About", "Customers", "Careers", "Contact"]],
    ["Resources", ["Docs", "Playbooks", "Status", "Changelog"]],
  ];
  return (
    <footer style={{ borderTop: "1px solid var(--border)", padding: "72px var(--gutter) 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 80, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 300 }}>
          <Wordmark size={24} />
          <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: "var(--text-secondary)" }}>
            The AI growth agent for small business. I find the customers you are missing.
          </p>
          <div style={{ display: "flex", gap: 12, color: "var(--text-muted)" }}>
            {["github", "instagram", "facebook", "linkedin"].map((n) => (
              <Icons key={n} name={n} size={18} title={n} />
            ))}
          </div>
        </div>
        {cols.map(([t, links]) => (
          <div key={t} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.96px", color: "var(--text-muted)" }}>{t.toUpperCase()}</span>
            {links.map((l) => (
              <Navlink key={l}>{l}</Navlink>
            ))}
          </div>
        ))}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 260 }}>
          <InputField label="Weekly digest, no noise" placeholder="you@yourshop.com" hint="One email a week. Unsubscribe anytime." style={{ width: 260 }} />
          <Button hierarchy="primary" size="md">
            Subscribe
          </Button>
        </div>
      </div>
      <div style={{ maxWidth: 1200, margin: "48px auto 0", paddingTop: 24, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>© 2026 Groville. All rights reserved.</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {["Paystack", "Flutterwave"].map((m) => (
            <span
              key={m}
              title={m}
              className="gv-pay"
              style={{
                height: 20,
                borderRadius: 8,
                padding: "0 8px",
                background: "#0A1A3A",
                boxShadow: "inset 0 0 0 1px #1B2C50",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                lineHeight: 1,
                color: "var(--text-muted)",
                letterSpacing: "-0.2px",
                flexShrink: 0,
              }}
            >
              {m}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <Navlink>Terms</Navlink>
          <Navlink>Privacy</Navlink>
        </div>
      </div>
    </footer>
  );
}
