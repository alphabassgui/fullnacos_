"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Logomark, Wordmark } from "@/components/ds";
import { welcomeGreeting } from "@/lib/demo-user";
import { useUser } from "@/lib/use-user";

/**
 * Welcome — the full-screen moment between sign up and onboarding in the demo loop
 * (scan → sign up → WELCOME → onboarding → ...). Ported pixel-for-pixel from the Claude
 * Design export in docs/welcome-reference.html, decoded from its bundler manifest
 * (ui_kits/app/Welcome.jsx), NOT hand-drawn.
 *
 * Design notes:
 *   1. This is a FULL-SCREEN centered moment — it does NOT render inside DashboardShell
 *      (no rail/top bar).
 *   2. Both themes, dark default. The screen follows the app theme (?theme / localStorage /
 *      prefers-color-scheme boot in app/layout.tsx). The reference's --welcome-* vars are
 *      scoped to the .gv-welcome root: dark uses the near-black onboarding-panel canvas
 *      (#04060F); light maps --welcome-base to the app's warm-cream surface (var(--bg)).
 *   3. Motion (all gated behind prefers-reduced-motion):
 *        - logo GLOW: .groville-glow / @keyframes groville-breathe (verbatim from reference).
 *        - ambient PARTICLES: 18 rising blue motes, .groville-mote / @keyframes groville-rise
 *          (verbatim). Rendered in the DOM unconditionally; CSS hides them under
 *          reduced-motion (SSR-safe, unlike the reference's module-load matchMedia check).
 *        - ENTRANCE: groville-welcome-in, a small staggered fade-up on the content. The
 *          reference's own motion is only glow + motes; this entrance is an additive port in
 *          the same motion language (requested by the task), started after mount to avoid an
 *          SSR flash and fully disabled under reduced-motion.
 *
 * Copy is the reference's verbatim, except the H1: per the personalized-greeting requirement
 * the heading is welcomeGreeting(useUser()) — the real signed-in user when Supabase auth is
 * configured, otherwise the mock "Ada" ("Welcome, Ada" / "Welcome to Groville"). The
 * agent-voice paragraph and honesty boundary ("I never publish or send on my own") are kept.
 *
 * Navigation: the export linked to a static onboarding.html; here the CTA is the DS Button
 * rendered as an anchor to /onboarding (the welcome → ONBOARDING hop).
 */

/** Slow rise of faint blue motes behind the mark. One ambient effect, nothing else. */
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 37) % 100,
  size: 2 + (i % 3),
  delay: -(i * 1.3),
  duration: 13 + (i % 5) * 2.5,
  drift: ((i % 4) - 1.5) * 18,
}));

/** Scoped styles: dark-only --welcome-* tokens (+ light overrides), the reference keyframes,
 *  the added entrance, canvas repaint / landing-glow suppression, and reduced-motion. */
const WELCOME_CSS = `
.gv-welcome{
  --welcome-base:#04060F;
  --welcome-glow-core:rgba(24,93,241,0.42);
  --welcome-glow-mid:rgba(11,42,107,0.30);
  --welcome-mote:rgba(90,146,255,0.95);
}
html[data-theme="light"] .gv-welcome{
  --welcome-base:var(--bg);
  --welcome-glow-core:rgba(24,93,241,0.14);
  --welcome-glow-mid:rgba(24,93,241,0.05);
  --welcome-mote:rgba(11,42,107,0.55);
}
/* Repaint the canvas and kill the landing's ambient dark glows for this full-screen route. */
html[data-theme="dark"] body::before,
html[data-theme="dark"] body::after,
html[data-theme="dark"]::before,
html[data-theme="dark"] #root::after,
body:has(.gv-welcome)::before,
body:has(.gv-welcome)::after{content:none!important;display:none!important}
body:has(.gv-welcome){background:#04060F!important}
html[data-theme="light"] body:has(.gv-welcome){background:var(--bg)!important}

.groville-focus:focus-visible{outline:2px solid var(--link);outline-offset:3px}

@keyframes groville-breathe{0%,100%{opacity:.68;transform:scale(.97)}50%{opacity:1;transform:scale(1.03)}}
.groville-glow{animation:groville-breathe 4.5s ease-in-out infinite}

@keyframes groville-rise{0%{transform:translate3d(0,0,0);opacity:0}12%{opacity:.5}80%{opacity:.35}100%{transform:translate3d(var(--drift),-92vh,0);opacity:0}}
.groville-mote{animation-name:groville-rise;animation-timing-function:linear;animation-iteration-count:infinite;opacity:0}
@media (max-width:600px){.groville-mote{transform:scale(.7)}}

/* Additive entrance: a small staggered fade-up, only after the .is-in mount flag is set. */
@keyframes groville-welcome-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.gv-welcome .gv-welcome-rise{opacity:0}
.gv-welcome.is-in .gv-welcome-rise{
  animation:groville-welcome-in var(--dur-slow,320ms) var(--ease,cubic-bezier(0.4,0,0.2,1)) both;
  animation-delay:var(--gv-in-delay,0ms);
}

@media (prefers-reduced-motion:reduce){
  *{animation:none!important;transition:none!important}
  .groville-mote{display:none}
  /* Never leave entrance content stuck at opacity:0 when motion is off. */
  .gv-welcome .gv-welcome-rise{opacity:1!important;transform:none!important}
}
`;

function Particles() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="groville-mote"
          style={
            {
              position: "absolute",
              left: p.left + "%",
              bottom: -20,
              width: p.size,
              height: p.size,
              borderRadius: 100,
              background: "var(--welcome-mote, var(--primary))",
              animationDelay: p.delay + "s",
              animationDuration: p.duration + "s",
              "--drift": p.drift + "px",
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Welcome() {
  // Start the entrance only after mount, so the server-rendered HTML is not stuck at
  // opacity:0 for no-JS / pre-hydration paints.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // rAF (not a synchronous setState) flips the flag one paint frame after mount,
    // so the entrance animates from the initial opacity:0 rather than being skipped.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const greeting = welcomeGreeting(useUser());

  return (
    <>
      <style href="gv-welcome" precedence="high">
        {WELCOME_CSS}
      </style>
      <div
        className={"gv-welcome" + (mounted ? " is-in" : "")}
        style={{
          position: "relative",
          minHeight: "100dvh",
          overflow: "hidden",
          background: "var(--welcome-base, var(--bg))",
          color: "var(--text)",
          fontFamily: "var(--font-body)",
          display: "flex",
          flexDirection: "column",
          padding: "28px 24px 72px",
        }}
      >
        <Particles />

        <Wordmark
          size={20}
          className="gv-welcome-rise"
          style={{ position: "relative", color: "var(--text)", alignSelf: "flex-start", opacity: 0.85 }}
        />

        <div
          style={{
            position: "relative",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 32,
            textAlign: "center",
            paddingTop: 24,
          }}
        >
          <div
            className="gv-welcome-rise"
            style={
              {
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 160,
                height: 160,
                "--gv-in-delay": "60ms",
              } as CSSProperties
            }
          >
            <span
              aria-hidden="true"
              className="groville-glow"
              style={{
                position: "absolute",
                inset: -60,
                borderRadius: "50%",
                background:
                  "radial-gradient(closest-side, var(--welcome-glow-core, var(--hero-glow-core)), var(--welcome-glow-mid, var(--hero-glow-mid)) 48%, transparent 74%)",
              }}
            />
            <Logomark size={132} style={{ position: "relative", color: "var(--text)" }} />
          </div>

          <div
            className="gv-welcome-rise"
            style={
              {
                display: "flex",
                flexDirection: "column",
                gap: 16,
                alignItems: "center",
                maxWidth: 520,
                "--gv-in-delay": "120ms",
              } as CSSProperties
            }
          >
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 30,
                lineHeight: "38px",
                letterSpacing: "-0.7px",
                color: "var(--text)",
              }}
            >
              {greeting}
            </h1>
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: "26px",
                color: "var(--text-secondary)",
                textWrap: "pretty",
              }}
            >
              I&apos;ll find the customers you&apos;re missing and draft the campaigns to win them. You approve every
              move. I never publish or send on my own.
            </p>
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 12,
                lineHeight: "18px",
                color: "var(--text-muted)",
              }}
            >
              Reads your site · Read-only access · Setup takes about ten minutes
            </span>
          </div>

          <Button
            as="a"
            href="/onboarding"
            hierarchy="primary"
            className="groville-focus gv-welcome-rise"
            style={
              {
                padding: "13px 24px",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 15,
                lineHeight: "20px",
                boxShadow: "0 0 22px rgba(24,93,241,0.32)",
                "--gv-in-delay": "180ms",
              } as CSSProperties
            }
          >
            Let&apos;s set you up
          </Button>
        </div>
      </div>
    </>
  );
}
