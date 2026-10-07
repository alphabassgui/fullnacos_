"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/ds";
import { applyTheme, resolveTheme } from "@/components/ds/theme";

const MN_ICON: Record<string, ReactNode> = {
  sun: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </svg>
  ),
  moon: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.3 14.6A8.6 8.6 0 1 1 9.4 3.7a6.9 6.9 0 0 0 10.9 10.9Z" />
    </svg>
  ),
  shield: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  ),
  arrow: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13M12.5 6l6 6-6 6" />
    </svg>
  ),
  github: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.4 9.4 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  ),
  instagram: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  x: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.2 3h3.1l-6.8 7.8L21 21h-5.5l-4.3-5.7L6.2 21H3.1l7.2-8.3L3 3h5.6l4 5.4L17.2 3Zm-1.1 16.2h1.7L7.9 4.7H6.1l10 14.5Z" />
    </svg>
  ),
  linkedin: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM3 9.5h4v11H3v-11Zm6.5 0h3.8v1.5a4.2 4.2 0 0 1 3.7-1.8c2.6 0 4 1.7 4 4.9v6.4h-4v-5.9c0-1.5-.5-2.4-1.8-2.4-1.1 0-1.7.7-2 1.4-.1.3-.1.7-.1 1v5.9h-4v-11Z" />
    </svg>
  ),
};

const MN_SOCIAL: [string, string][] = [
  ["GitHub", "github"],
  ["Instagram", "instagram"],
  ["X", "x"],
  ["LinkedIn", "linkedin"],
];

export function MobileNav({
  links,
  onLinkClick,
}: {
  links: [string, string][];
  onLinkClick?: (e: React.MouseEvent, label: string, href: string) => void;
}) {
  // SSR-safe default; the real theme is adopted after mount to avoid a hydration mismatch.
  const [theme, setTheme] = useState<string>("dark");
  const [open, setOpen] = useState(false);
  const toLight = theme !== "light";

  useEffect(() => {
    const t = resolveTheme();
    applyTheme(t);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the resolved theme after mount
    setTheme(t);
  }, []);

  const flip = () => {
    const next = toLight ? "light" : "dark";
    setTheme(next);
    applyTheme(next, true);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("gv-mnav-lock", open);
    return () => document.documentElement.classList.remove("gv-mnav-lock");
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 900px)");
    const onWide = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, []);

  const tap = (e: React.MouseEvent, label: string, href: string) => {
    setOpen(false);
    if (onLinkClick) onLinkClick(e, label, href);
  };

  const modeBtn = (
    <button type="button" className="gv-msq" aria-pressed={theme === "light"} aria-label={toLight ? "Switch to light mode" : "Switch to dark mode"} onClick={flip}>
      {toLight ? MN_ICON.sun : MN_ICON.moon}
    </button>
  );

  return (
    <Fragment>
      <div className="gv-mnav">
        <div className="gv-mnav-bar">
          <Wordmark size={22} />
          <div className="gv-mnav-actions">
            {modeBtn}
            <button
              type="button"
              className={"gv-msq" + (open ? " is-open" : "")}
              aria-expanded={open}
              aria-controls="gv-mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="gv-mburger" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>
          </div>
        </div>
      </div>
      <div id="gv-mobile-menu" className={"gv-mov" + (open ? " is-open" : "")} role="dialog" aria-modal="true" aria-label="Menu" aria-hidden={!open}>
        <span className="gv-mov-streaks" aria-hidden="true" />
        <div className="gv-mov-inner">
          <div className="gv-mov-cta">
            <Link className="gv-mov-login" href="/login" tabIndex={open ? 0 : -1}>
              Log in
            </Link>
            <Link className="gv-mov-cta-btn" href="/signup" tabIndex={open ? 0 : -1}>
              Start free {MN_ICON.arrow}
            </Link>
          </div>
          <span className="gv-mov-label">Explore</span>
          <nav className="gv-mov-links" aria-label="Sections">
            {links.map(([label, href]) => (
              <a key={label} className="gv-mov-link" href={href} tabIndex={open ? 0 : -1} onClick={(e) => tap(e, label, href)}>
                {label}
              </a>
            ))}
          </nav>
          <div className="gv-mov-foot">
            <p className="gv-mov-trust">
              {MN_ICON.shield}
              <span>Read-only. I can&apos;t edit your site or spend your money.</span>
            </p>
            <div className="gv-mov-social">
              {MN_SOCIAL.map(([label, icon]) => (
                <a key={label} className="gv-msq gv-msq-sm" href="#root" aria-label={label} tabIndex={open ? 0 : -1}>
                  {MN_ICON[icon]}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  );
}
