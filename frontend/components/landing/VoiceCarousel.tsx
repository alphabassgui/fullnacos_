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
  stars: number;
  date: string;
};

const T_VOICES: Voice[] = [
  { name: "Ada Osei", role: "Owner", company: "Ada's Bakery", initials: "AO", pre: "Groville wrote the campaigns and two of them ", accent: "closed by Friday.", post: "", support: "I found 3 gaps this week.", stars: 5, date: "12 Aug 2026" },
  { name: "Mira Vance", role: "Director", company: "Helix Fitness", initials: "MV", pre: "It reactivated ", accent: "212 lapsed members", post: " in one month.", support: "I approved every draft in about ten minutes.", stars: 5, date: "28 Jul 2026" },
  { name: "Tom Ibrahim", role: "Founder", company: "Northside Coffee", initials: "TI", pre: "The weekly digest is ", accent: "the only report I read.", post: "", support: "It tells me who to talk to and what to say.", stars: 4, date: "03 Sep 2026" },
  { name: "Grace Aduba", role: "Owner", company: "Bloom Florals", initials: "GA", pre: "Two campaigns, ", accent: "41 new orders", post: " before the weekend.", support: "I just approved what it drafted and watched.", stars: 5, date: "19 Aug 2026" },
  { name: "Emeka Obi", role: "Founder", company: "Swift Errands", initials: "EO", pre: "It found ", accent: "a gap I never would have.", post: "", support: "Ranked page two in three weeks on that keyword.", stars: 5, date: "07 Sep 2026" },
];

function Stars({ value }: { value: number }) {
  return (
    <span style={{ display: "flex", gap: 3, color: "var(--star)" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Icons key={i} name="star-full" size={13} style={value - i >= 1 ? undefined : { opacity: 0.28 }} />
      ))}
    </span>
  );
}

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
      <div className="gv-voice-foot">
        <Stars value={v.stars} />
        <span className="gv-voice-date">{v.date}</span>
      </div>
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
        <SectionHeader eyebrow="Customers" line1="Operators who" accent="stopped guessing." eyebrowStyle={{ background: "var(--tint)", color: "var(--primary)", boxShadow: "none" }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 56 }}>
          <Button className="icon-btn" hierarchy="secondary gray" icon="only" iconName="chevron-left" aria-label="Previous testimonial" onClick={() => step(-1)} />
          <Button className="icon-btn" hierarchy="secondary gray" icon="only" iconName="chevron-right" aria-label="Next testimonial" onClick={() => step(1)} />
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
