"use client";

import { Fragment, useState } from "react";
import { Button, Icons } from "@/components/ds";
import { SectionHeader } from "./section";

type Voice = {
  name: string;
  role: string;
  company: string;
  initials: string;
  pre: string;
  accent: string;
  post: string;
  support: string;
};

const T_VOICES: Voice[] = [
  { name: "Neighbourhood bakery", role: "Yaba, Lagos", company: "Illustrative example", initials: "BK", pre: "Groville spots that ", accent: "'bakery near me' is going to a competitor", post: ", and drafts an SEO article plus social posts to win it.", support: "You review every draft and approve what goes out." },
  { name: "Fitness studio", role: "Lekki, Lagos", company: "Illustrative example", initials: "FT", pre: "It groups ", accent: "lapsed members", post: " and drafts a win-back campaign for each.", support: "Nothing sends until you approve it." },
  { name: "Coffee shop", role: "Abuja", company: "Illustrative example", initials: "CF", pre: "The weekly digest names ", accent: "who to talk to and what to say", post: ", in plain language.", support: "You decide what gets sent." },
  { name: "Florist", role: "Ikoyi, Lagos", company: "Illustrative example", initials: "FL", pre: "Two drafted campaigns aimed at ", accent: "weekend gift shoppers", post: ", ready for a weekend push.", support: "You approve the drafts, then watch the results." },
  { name: "Logistics SME", role: "Ikeja, Lagos", company: "Illustrative example", initials: "LG", pre: "Groville spots that ", accent: "'same-day delivery Ikeja'", post: " is where competitors rank, and drafts an article plus three posts.", support: "You review and approve before anything goes out." },
];

function VoiceCard({ v, pos }: { v: Voice; pos: string }) {
  return (
    <article className={"gv-voice card--interactive gv-voice-" + pos} aria-hidden={pos === "on" ? undefined : "true"}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <span className="gv-voice-av">{v.initials}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.1px" }}>{v.name}</span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {v.role} · {v.company}
          </span>
        </div>
        <span className="gv-voice-x" aria-hidden="true">
          <Icons name="x" size={14} />
        </span>
      </header>
      <blockquote className="gv-voice-quote">
        {v.pre}
        <em className="gv-voice-accent">{v.accent}</em>
        {v.post}
      </blockquote>
      <p className="gv-voice-support">{v.support}</p>
    </article>
  );
}

export function VoiceCarousel() {
  const n = T_VOICES.length;
  const [active, setActive] = useState(0);
  const step = (d: number) => setActive((a) => (a + d + n) % n);
  const slot = (i: number) => {
    let d = i - active;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d === 0 ? "on" : d === -1 ? "prev" : d === 1 ? "next" : "off";
  };
  return (
    <Fragment>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 40, flexWrap: "wrap" }}>
        <SectionHeader eyebrow="Illustrative examples" line1="What a Groville" accent="draft looks like." eyebrowStyle={{ background: "var(--tint)", color: "var(--primary)", boxShadow: "none" }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 56 }}>
          <Button className="icon-btn" hierarchy="secondary gray" icon="only" iconName="chevron-left" aria-label="Previous example" onClick={() => step(-1)} />
          <Button className="icon-btn" hierarchy="secondary gray" icon="only" iconName="chevron-right" aria-label="Next example" onClick={() => step(1)} />
        </div>
      </div>
      <div className="gv-voice-stage">
        {T_VOICES.map((v, i) => (
          <VoiceCard key={v.name} v={v} pos={slot(i)} />
        ))}
      </div>
      <div className="gv-voice-dots">
        {T_VOICES.map((v, i) => (
          <button key={v.name} type="button" aria-label={"Show " + v.name} className={"gv-voice-dot" + (i === active ? " is-on" : "")} onClick={() => setActive(i)} />
        ))}
      </div>
    </Fragment>
  );
}
