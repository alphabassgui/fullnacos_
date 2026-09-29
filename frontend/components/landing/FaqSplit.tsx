"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Logomark } from "@/components/ds";

const FAQ_ITEMS: [string, string][] = [
  ["What does Groville actually do?", "It reads your website and Google Search Console, finds the biggest search opportunity you're missing, and drafts an SEO article and social posts to win it. You approve before anything is published."],
  ["What data do you need?", "Read-only access to your website and Google Search Console. That's all. I can't edit your site, change your settings, or spend your money."],
  ["Can it publish on its own?", "Never. Every draft waits for you, and publishing stays with you."],
  ["How long is setup?", "About nine minutes, from connecting a data source to your first campaign ready to approve."],
  ["What does it cost?", "Start free. Paid plans scale with how many campaigns you run each month."],
];

function FaqRow({ question, answer, open, onToggle, id }: { question: string; answer: string; open: boolean; onToggle: () => void; id: string }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const measure = () => setH(panel.current ? panel.current.scrollHeight : 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [answer]);
  return (
    <div className={"gv-faq-row" + (open ? " is-open" : "")}>
      <button type="button" className="gv-faq-q" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="gv-faq-qt">{question}</span>
        <span className="gv-faq-toggle" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M7 1.6v10.8" className="gv-faq-bar" />
            <path d="M1.6 7h10.8" />
          </svg>
        </span>
      </button>
      <div className="gv-faq-panel" id={id} role="region" style={{ height: open ? h : 0 }}>
        <div className="gv-faq-inner" ref={panel}>
          <p className="gv-faq-a">{answer}</p>
        </div>
      </div>
    </div>
  );
}

export function FaqSplit() {
  const [open, setOpen] = useState(0);
  return (
    <div className="gv-faq">
      <div className="gv-faq-aside">
        <div className="gv-faq-sticky">
          <Badge dot={false} style={{ alignSelf: "flex-start" }}>
            FAQ
          </Badge>
          <h2 className="gv-faq-h2">
            Questions, answered <em className="gv-faq-accent">plainly.</em>
          </h2>
          <p className="gv-faq-lede">Everything you might ask, in plain language.</p>
          <div className="gv-faq-card">
            <Logomark size={32} />
            <h3 className="gv-faq-card-t">Still have questions?</h3>
            <p className="gv-faq-card-p">Talk to us, no slides, no sales pitch.</p>
            <Link href="/signup" style={{ textDecoration: "none", alignSelf: "flex-start" }}>
              <Button hierarchy="primary" size="lg">
                Talk to us
              </Button>
            </Link>
          </div>
        </div>
      </div>
      <div className="gv-faq-list">
        {FAQ_ITEMS.map(([q, a], k) => (
          <FaqRow key={q} id={"gv-faq-p" + k} question={q} answer={a} open={open === k} onToggle={() => setOpen(open === k ? -1 : k)} />
        ))}
      </div>
    </div>
  );
}
