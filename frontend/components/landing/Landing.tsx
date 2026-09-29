"use client";

import { useEffect, useState } from "react";
import { NavDark } from "@/components/ds";
import { MobileNav } from "./MobileNav";
import { Hero, LogoStrip, Capabilities, Benchmarks, Features, ProofSection, Testimonials, PricingSection, Faq, CtaBand, Footer } from "./Sections";

const NAV: [string, string][] = [
  ["Platform", "platform"],
  ["How it works", "how-it-works"],
  ["Pricing", "pricing"],
];
const NAV_LABELS = NAV.map((n) => n[0]);
const NAV_HREFS = NAV.map((n) => "#" + n[1]);

export function Landing() {
  const [active, setActive] = useState("Platform");

  useEffect(() => {
    const visible = new Set<string>();
    const pick = () => {
      const hit = NAV.find(([, id]) => visible.has(id));
      if (hit) setActive(hit[0]);
    };
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        });
        if (window.scrollY > 240) pick();
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    NAV.forEach(([, id]) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    const onScroll = () => {
      if (window.scrollY <= 240) setActive("Platform");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const go = (e: React.MouseEvent, label: string, href: string) => {
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    e.preventDefault();
    setActive(label);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div style={{ minHeight: "100vh", background: "transparent" }}>
      <div className="gv-desk-nav" style={{ position: "sticky", top: 0, zIndex: 50, padding: "0 24px", display: "flex", justifyContent: "center" }}>
        <NavDark links={NAV_LABELS} linkHrefs={NAV_HREFS} active={active} onLinkClick={go} cta="Start free" ctaHref="/signup" />
      </div>
      <MobileNav links={NAV.map(([l, id]) => [l, "#" + id])} onLinkClick={go} />
      <Hero />
      <LogoStrip />
      <Capabilities />
      <Benchmarks />
      <Features />
      <ProofSection />
      <Testimonials />
      <PricingSection />
      <Faq />
      <CtaBand />
      <Footer />
    </div>
  );
}
