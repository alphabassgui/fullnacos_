"use client";

import { useEffect, useRef, useState } from "react";
import { Icons } from "@/components/ds";

const P_STEPS: [string, string, string, string, string][] = [
  ["01", "Segment finder", "Lapsed, near-miss and high-value groups, named in plain language.", "logic", "Segments named"],
  ["02", "Draft studio", "Copy, offer and timing per segment. Edit inline or send as written.", "builder", "Drafts written"],
  ["03", "Channel routing", "Each customer gets the channel they actually answer.", "routing", "Channel picked"],
  ["04", "Guardrails", "Send limits, quiet hours and approval rules you set once.", "shield", "Rules enforced"],
  ["05", "Live telemetry", "Opens, replies and revenue tracked per campaign.", "telemetry", "Results tracked"],
  ["06", "Weekly digest", "One message a week: what I found, what I drafted, what it earned.", "chat-alerts", "Digest sent"],
];

export function Pipeline() {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = steps.current.filter(Boolean) as HTMLDivElement[];
    if (!els.length || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="gv-pipe">
      <div className="gv-pipe-col">
        <div className="gv-pipe-visual" aria-hidden="true">
          <span className="gv-pipe-amb" />
          <span className="gv-pipe-bloom" />
          {P_STEPS.map((s, i) => (
            <div key={s[0]} className={"gv-pipe-stage" + (i === active ? " is-on" : "")}>
              <span className="gv-pipe-glyph">
                <Icons name={s[3]} size={104} />
              </span>
              <span className="gv-pipe-cap">{s[4]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="gv-pipe-steps">
        <span className="gv-pipe-rail" aria-hidden="true" />
        <span className="gv-pipe-fill" aria-hidden="true" style={{ height: ((active + 1) / P_STEPS.length) * 100 + "%" }} />
        {P_STEPS.map((s, i) => (
          <div
            key={s[0]}
            data-i={i}
            ref={(el) => {
              steps.current[i] = el;
            }}
            className={"gv-pipe-step" + (i === active ? " is-active" : "")}
          >
            <span className="gv-pipe-dot" aria-hidden="true" />
            <div className="gv-pipe-head">
              <span className="gv-pipe-pill">Step {s[0]}</span>
              <span className="gv-pipe-mini" aria-hidden="true">
                <Icons name={s[3]} size={18} />
              </span>
            </div>
            <h3 className="gv-pipe-title">{s[1]}</h3>
            <p className="gv-pipe-copy">{s[2]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
