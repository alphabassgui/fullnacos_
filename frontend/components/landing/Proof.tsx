"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

function PfIcon({ name, size = 14 }: { name: "search" | "check"; size?: number }) {
  const p: Record<string, ReactNode> = {
    search: (
      <g>
        <circle cx="7" cy="7" r="4.6" />
        <path d="M10.4 10.4l3 3" />
      </g>
    ),
    check: <path d="M3.2 8.4l3.1 3.1 6.5-6.9" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
}

function PfKeywordPill({ children }: { children: ReactNode }) {
  return (
    <span className="gv-pf-kw">
      <span className="gv-pf-kw-ic">
        <PfIcon name="search" />
      </span>
      {children}
    </span>
  );
}

function PfGhostRow({ zone, top }: { zone: string; top: number }) {
  return (
    <div className={"gv-pf-ghost gv-pf-ghost-" + zone} style={{ top: top + "%" }} aria-hidden="true">
      <span className="gv-pf-ghost-fav" />
      <span className="gv-pf-ghost-lines">
        <span className="gv-pf-ghost-l1" />
        <span className="gv-pf-ghost-l2" />
      </span>
    </div>
  );
}

function usePfCount(target: number, run: boolean, ms = 1300) {
  const [n, setN] = useState(run ? target : 0);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced motion: show final value immediately
      setN(target);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, target, ms]);
  return n;
}

export function Proof() {
  const stage = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced motion: reveal without waiting for scroll
      setLive(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            setLive(true);
            io.disconnect();
          }
        }),
      { rootMargin: "-12% 0px -18% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const rank = 18 - usePfCount(9, live, 1300);
  const clicks = usePfCount(410, live, 1300);

  return (
    <div className="gv-pf">
      <span className="gv-pf-glow" aria-hidden="true" />
      <div className="gv-pf-head">
        <span className="gv-pf-chip-eyebrow">Real result</span>
        <h2 className="gv-pf-h2">
          Watch one gap turn into <em className="gv-pf-accent">page one</em>.
        </h2>
        <p className="gv-pf-lede">Here is one opportunity Groville found for a Lagos bakery, and what happened in the month after the owner approved the campaign.</p>
      </div>

      <div className={"gv-pf-stage" + (live ? " is-in" : "")} ref={stage}>
        <div className="gv-pf-rail">
          <span className="gv-pf-step">THE GAP I FOUND</span>
          <PfKeywordPill>cake delivery lagos</PfKeywordPill>
          <div className="gv-pf-gap">
            <span className="gv-pf-big">320</span>
            <p className="gv-pf-gap-copy">people a month searched this in your city, and none of them were being sent to you.</p>
          </div>
          <span className="gv-pf-div" />
          <p className="gv-pf-honest">
            <span className="gv-pf-honest-ic">
              <PfIcon name="check" />
            </span>
            I drafted the campaign, an SEO article plus social posts. You approved it, and it shipped. I never publish anything on my own.
          </p>
          <div className="gv-pf-payoff">
            <span className="gv-pf-payoff-n">+{clicks}</span>
            <span className="gv-pf-payoff-c">more clicks every month, and still climbing.</span>
          </div>
        </div>

        <div className="gv-pf-ladder">
          <span className="gv-pf-ladder-glow" aria-hidden="true" />
          <div className="gv-pf-ladder-head">
            <PfKeywordPill>cake delivery lagos</PfKeywordPill>
            <span className="gv-pf-results">search results</span>
          </div>
          <div className="gv-pf-track">
            <PfGhostRow zone="p1" top={4} />
            <PfGhostRow zone="p1" top={20} />
            <div className="gv-pf-page1">
              <span className="gv-pf-page1-line" />
              <span className="gv-pf-page1-label">Page 1 · where the clicks are</span>
            </div>
            <div className="gv-pf-p2zone" aria-hidden="true">
              <span className="gv-pf-p2label">PAGE 2</span>
            </div>
            <PfGhostRow zone="p2" top={56} />
            <PfGhostRow zone="p2" top={88} />
            <div className="gv-pf-shop">
              <span className="gv-pf-rank">{rank}</span>
              <span className="gv-pf-shop-txt">
                <span className="gv-pf-shop-t">Ada&apos;s Bakery — cake delivery across Lagos</span>
                <span className="gv-pf-shop-u">adasbakery.com/cake-delivery</span>
              </span>
              <span className="gv-pf-here">You&apos;re here now</span>
            </div>
          </div>
        </div>
      </div>

      <div className="gv-pf-chips">
        {(
          [
            ["Yaba location page", "+182 clicks"],
            ["Search clicks this month", "1,284 (+12%)"],
            ["Clicks you were losing", "down 38%"],
          ] as [string, string][]
        ).map(([label, val]) => (
          <span key={label} className="gv-pf-chip">
            <span className="gv-pf-dot" />
            {label}
            <strong className="gv-pf-chip-v">{val}</strong>
          </span>
        ))}
      </div>

      <p className="gv-pf-next">
        <span className="gv-pf-ping" aria-hidden="true">
          <span />
        </span>
        And I already found your next one: <strong>bakery near me, 880 searches a month.</strong>
      </p>
    </div>
  );
}
