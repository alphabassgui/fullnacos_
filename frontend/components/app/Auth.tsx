"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wordmark, Icons } from "@/components/ds";
import { useMediaQuery } from "./use-media-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFlaskConfigured, login as flaskLogin, register as flaskRegister } from "@/lib/api";
import { getStoredDemoUser, saveDemoUser } from "@/lib/demo-user";

/**
 * Auth — the Sign up / Log in split screen, the entry point of the demo loop
 * (SIGN UP → welcome → onboarding → analysing → opportunities). Ported pixel-for-pixel from
 * the Claude Design export in docs/auth-reference.html (decoded from its bundler manifest,
 * asset 1eca192e), NOT from the rendered HTML.
 *
 * Design notes:
 *   1. FULL-SCREEN split flow — it does NOT render inside DashboardShell (no rail/top bar),
 *      the same deliberate exception as Onboarding.
 *   2. Dark is the default. The RIGHT form panel follows the app theme (dark tokens re-pinned
 *      under .groville-auth, warm-cream LIGHT values under html[data-theme="light"] .groville-auth);
 *      the LEFT photo panel stays pinned dark in both themes, like Onboarding's PhotoPanel. All
 *      values come from app/globals.css — nothing is invented.
 *   3. The left photo panel has a subtle Ken Burns drift (no glow/bloom, no testimonial) —
 *      logo + headline + subtitle + one gap card only.
 *
 * Honesty boundary: Groville reads and drafts. The sign-up trust line is kept verbatim and
 * nothing here publishes or sends on its own.
 *
 * Navigation: the export used static .html hrefs + an in-place view toggle; here the two
 * screens are real routes and we use the Next router — Sign up → /welcome (name passed
 * forward as ?name=), Log in → /opportunities, and the footer link toggles /signup ↔ /login.
 *
 * Auth: real Flask email/password when NEXT_PUBLIC_API_BASE is set (register then login on sign
 * up — register does not log in — and login on log in), surfacing Flask's exact error messages
 * inline. When Flask is not configured we fall back to Supabase (the demo-mode auth from PR #16),
 * and when neither is configured to the mock demo push so the demo loop still runs.
 * "Continue with Google" is intentionally inert here (a later task) — shown but disabled.
 */

/** The left photo panel is pinned dark in both themes; these two literals are its fixed colours. */
const AUTH_PHOTO_BG = "#06070C";
const AUTH_INK = "#F3F7FE";

/** Scoped styles: theme-aware token pinning, canvas glow suppression, Ken Burns drift, input +
 *  button focus/hover rings. The export referenced hooks (groville-input, groville-focus,
 *  gv-auth-*, the Ken Burns keyframe) that are not global, so their rules live here, scoped to
 *  .groville-auth so they never bleed into other screens. */
const AUTH_CSS = `
/* Dark is the base. The theme-variant tokens this screen reads are pinned here to their
   globals.css dark values (rather than inherited) so the RIGHT panel is self-consistent, plus
   local surface vars for the right panel. The LEFT photo panel stays pinned dark in both themes
   (see BrandPanel) — only the right form panel follows the theme. */
.groville-auth{
  --primary:#185DF1;
  --primary-hover:#3B76F3;
  --primary-active:#1149C7;
  --text-on-primary:#FFFFFF;
  --text-secondary:#C3CFE8;
  --text-muted:#93A2C6;
  --link:#5B8CF0;
  --focus:#6FA0FF;
  --shadow-hover:0 6px 20px rgba(0,0,0,.45);
  --shadow-press:0 2px 6px rgba(0,0,0,.35);
  /* right-panel surfaces (dark base) */
  --auth-canvas:#04060F;
  --auth-ink:#F3F7FE;
  --auth-field-bg:rgba(243,247,254,.04);
  --auth-field-border:rgba(243,247,254,.13);
  --auth-hairline:rgba(243,247,254,.12);
}
/* Light theme: the globals.css warm-cream LIGHT tokens, applied to the right form panel only. */
html[data-theme="light"] .groville-auth{
  --text-secondary:#64748B;
  --text-muted:#948E83;
  --link:#1747C7;
  --focus:#185DF1;
  --shadow-hover:0 6px 18px rgba(60,48,28,.12);
  --shadow-press:0 2px 6px rgba(60,48,28,.10);
  --auth-canvas:#F6F1E8;
  --auth-ink:#1B1A17;
  --auth-field-bg:#FFFFFF;
  --auth-field-border:#D8CFBD;
  --auth-hairline:#D8CFBD;
}
/* Repaint the canvas and kill the landing's ambient dark glows (globals.css) for this full-screen
   route. Every selector is gated on :has(.groville-auth) so the suppression applies only while an
   auth screen is mounted: React keeps this <style precedence> block in <head> across client-side
   navigation, so gating (not the block's presence) is what stops it leaking to other screens. */
html[data-theme="dark"]:has(.groville-auth) body::before,
html[data-theme="dark"]:has(.groville-auth) body::after,
html[data-theme="dark"]:has(.groville-auth)::before,
html[data-theme="dark"]:has(.groville-auth) #root::after{content:none!important;display:none!important}
body:has(.groville-auth){background:#04060F!important}
html[data-theme="light"] body:has(.groville-auth){background:#F6F1E8!important}
.groville-auth .groville-input::placeholder{color:var(--text-muted)}
.groville-auth .groville-input:focus{border-color:var(--primary);outline:2px solid var(--focus);outline-offset:2px}
.groville-auth .gv-auth-primary{transition:background var(--dur-color) var(--ease-state),transform var(--dur-move) var(--ease-state),box-shadow var(--dur-color) var(--ease-state)}
.groville-auth .gv-auth-primary:hover{background:var(--primary-hover)!important;transform:translateY(-1px);box-shadow:var(--shadow-hover)}
.groville-auth .gv-auth-primary:active{background:var(--primary-active)!important;transform:translateY(0) scale(.99);box-shadow:var(--shadow-press)}
.groville-auth .gv-auth-google{transition:transform var(--dur-move) var(--ease-state),box-shadow var(--dur-color) var(--ease-state)}
.groville-auth .gv-auth-google:hover{transform:translateY(-1px);box-shadow:var(--shadow-hover)}
.groville-auth .gv-auth-google:active{transform:translateY(0) scale(.99);box-shadow:var(--shadow-press)}
.groville-auth .gv-auth-link{transition:color var(--dur-color) var(--ease-state)}
.groville-auth .gv-auth-link:hover{color:var(--primary-hover)!important;text-decoration:underline}
.groville-auth .gv-auth-link:active{color:var(--primary-active)!important}
.groville-auth .groville-focus:focus-visible,.groville-auth a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.gv-auth-kenburns{animation:gv-auth-kb 20s ease-in-out infinite alternate;transform-origin:center;will-change:transform}
@keyframes gv-auth-kb{0%{transform:scale(1.05) translate3d(0,0,0)}100%{transform:scale(1.15) translate3d(-2%,-2.5%,0)}}
@media (prefers-reduced-motion:reduce){.gv-auth-kenburns{animation:none;transform:none}}
`;

/** Google "G", from the Google identity guidelines' four-colour mark (ported verbatim — the DS
 *  Icons mask tints with currentColor and cannot render the four brand colours). */
function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

/** Left panel — pinned dark, neutral photo with subtle Ken Burns, no glow/bloom, no testimonial. */
function BrandPanel() {
  return (
    <aside className="groville-auth-brand" style={{ position: "relative", overflow: "hidden", background: AUTH_PHOTO_BG }}>
      <div className="gv-auth-kenburns" style={{ position: "absolute", inset: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/onboarding-left.webp"
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "64% 50%", display: "block" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(118% 88% at 64% 50%,rgba(6,7,12,0) 42%,rgba(6,7,12,.34) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg,rgba(4,6,15,.10) 0%,rgba(4,6,15,0) 32%,rgba(4,6,15,.50) 68%,rgba(4,6,15,.92) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 48px 56px",
        }}
      >
        <Wordmark size={22} style={{ color: AUTH_INK }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 480 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 40,
                lineHeight: "48px",
                letterSpacing: "-1px",
                color: AUTH_INK,
                textWrap: "pretty",
              }}
            >
              The customers you are missing, found.
            </h2>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "20px", color: "rgba(243,247,254,.62)" }}>
              Connect your site and see the first gaps in under ten minutes.
            </p>
          </div>
          <div
            className="groville-auth-proof"
            style={{
              width: 300,
              padding: 20,
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: "rgba(6,9,20,.72)",
              border: "1px solid rgba(243,247,254,.13)",
              boxShadow: "0 20px 48px rgba(2,8,26,.45)",
            }}
          >
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, lineHeight: "16px", color: "#7FA6F7" }}>
              Biggest customer you&apos;re missing
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, lineHeight: "28px", letterSpacing: "-0.4px", color: AUTH_INK }}>
              bakery near me
            </span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, lineHeight: "16px", color: "rgba(243,247,254,.72)" }}>
              880 a month · rank 34th
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, lineHeight: "20px", color: AUTH_INK }}>
              +265 clicks you could win
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

type FieldProps = {
  id: string;
  label: string;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
};

/** Eye / eye-off glyph for the password reveal toggle (inline, tints with currentColor). */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function Field({ id, label, type = "text", placeholder, value, onChange }: FieldProps) {
  const isPassword = type === "password";
  const [revealed, setRevealed] = useState(false);
  const effectiveType = isPassword && revealed ? "text" : type;
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", color: "var(--text-secondary)" }}>{label}</span>
      <div style={{ position: "relative", display: "flex" }}>
        <input
          id={id}
          type={effectiveType}
          placeholder={placeholder}
          className="groville-input"
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          style={{
            width: "100%",
            height: 52,
            padding: isPassword ? "0 48px 0 18px" : "0 18px",
            borderRadius: 10,
            background: "var(--auth-field-bg)",
            border: "1px solid var(--auth-field-border)",
            color: "var(--auth-ink)",
            fontFamily: "var(--font-body)",
            fontSize: 15,
            lineHeight: "20px",
            outline: "none",
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            title={revealed ? "Hide password" : "Show password"}
            className="groville-focus"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              padding: 0,
              border: "none",
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            <EyeIcon off={revealed} />
          </button>
        )}
      </div>
    </label>
  );
}

/** Google sign-in is a later task: the button stays visually present but inert (disabled), with
 *  a small "Soon" tag so it reads as coming, not broken. No OAuth is wired here. */
function GoogleButton({ mobile }: { mobile: boolean }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Google sign-in is coming soon"
      className="groville-focus"
      style={{
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: "100%",
        padding: "12px 16px",
        borderRadius: mobile ? 999 : 8,
        cursor: "not-allowed",
        opacity: 0.55,
        background: "#FFFFFF",
        border: "1px solid rgba(243,247,254,.13)",
        color: "#031130",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 15,
        lineHeight: "20px",
      }}
    >
      <GoogleGlyph />
      Continue with Google
      <span
        style={{
          marginLeft: 2,
          padding: "2px 8px",
          borderRadius: 999,
          background: "rgba(3,17,48,.08)",
          fontFamily: "var(--font-body)",
          fontWeight: 500,
          fontSize: 11,
          lineHeight: "14px",
          color: "#5B6B86",
        }}
      >
        Soon
      </span>
    </button>
  );
}

/** Inline neutral notice (e.g. "confirm your email"), in the screen's own type. */
function NoticeNote({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="status"
      style={{
        marginTop: -8,
        fontFamily: "var(--font-body)",
        fontSize: 13,
        lineHeight: "18px",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

/** Inline auth error, in the screen's own type + the --error token. Sits in the form's flow. */
function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="alert"
      style={{
        marginTop: -8,
        fontFamily: "var(--font-body)",
        fontSize: 13,
        lineHeight: "18px",
        color: "var(--error, #E5484D)",
      }}
    >
      {children}
    </span>
  );
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <span style={{ flex: 1, height: 1, background: "var(--auth-hairline)" }} />
      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)" }}>or</span>
      <span style={{ flex: 1, height: 1, background: "var(--auth-hairline)" }} />
    </div>
  );
}

function SubmitButton({
  children,
  mobile,
  disabled,
}: {
  children: React.ReactNode;
  mobile: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-disabled={disabled}
      className="groville-focus gv-auth-primary"
      style={{
        width: "100%",
        padding: "12px 20px",
        borderRadius: mobile ? 999 : 8,
        border: "none",
        cursor: disabled ? "progress" : "pointer",
        opacity: disabled ? 0.7 : 1,
        background: "var(--primary)",
        color: "var(--text-on-primary)",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 15,
        lineHeight: "20px",
      }}
    >
      {children}
    </button>
  );
}

const LINK: CSSProperties = { color: "var(--link)", textDecoration: "none" };
const FOOTER: CSSProperties = { fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "20px", color: "var(--text-secondary)" };
const AUTH_H1: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 32,
  lineHeight: "40px",
  letterSpacing: "-0.7px",
  color: "var(--auth-ink)",
  textWrap: "pretty",
};
const AUTH_SUB: CSSProperties = { margin: 0, fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "21px", color: "var(--text-secondary)" };
const AUTH_FORM: CSSProperties = { display: "flex", flexDirection: "column", gap: 24, width: "100%", maxWidth: 400 };

export function AuthScreen({ mode, callbackUrl }: { mode: "signup" | "login"; callbackUrl?: string }) {
  const router = useRouter();
  const mobile = useMediaQuery("(max-width: 860px)");
  // Preserve the intended destination across the login ↔ signup toggle so a user
  // who came from a pricing CTA keeps it when switching forms.
  const withCallback = (base: "/login" | "/signup") =>
    callbackUrl ? `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}` : base;
  const [yourName, setYourName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Sign up → /welcome, carrying the typed name forward. (In demo mode Welcome greets from the
   *  mock in lib/demo-user.ts; with real auth it reads the signed-in user via useUser.) */
  const welcomeHref = () => {
    const trimmed = businessName.trim();
    return trimmed ? `/welcome?name=${encodeURIComponent(trimmed)}` : "/welcome";
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Real auth path: Flask. Register does NOT log in, so on 201 we immediately
    // log in to establish the session cookie, then route into the flow.
    if (isFlaskConfigured()) {
      const name = yourName.trim();
      if (!name) {
        setError("Please enter your name.");
        return;
      }
      setSubmitting(true);
      const reg = await flaskRegister({ username: name, email, password });
      if (!reg.ok) {
        setSubmitting(false);
        setError(reg.data?.error ?? "Could not create your account. Please try again.");
        return;
      }
      const li = await flaskLogin({ email, password });
      setSubmitting(false);
      if (!li.ok) {
        setError(li.data?.error ?? "Account created, but sign-in failed. Please log in.");
        return;
      }
      router.push(callbackUrl ?? welcomeHref());
      return;
    }

    const supabase = getSupabaseBrowserClient();
    // Demo mode (no Supabase env): keep the mock push so the demo loop still runs,
    // but first persist what was typed so the account card / avatar / greeting
    // reflect this business instead of the hardcoded "Ada" mock.
    if (!supabase) {
      saveDemoUser({
        name: yourName.trim() || null,
        email: email.trim() || null,
        businessName: businessName.trim() || null,
      });
      router.push(callbackUrl ?? welcomeHref());
      return;
    }
    const name = businessName.trim();
    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      // Capture the business name into user_metadata so useUser() can read it later.
      options: { data: name ? { business_name: name } : {} },
    });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // If the project requires email confirmation, signUp returns no session.
    // Don't push into the gated flow (they'd be bounced to /login) — ask them
    // to confirm first.
    if (!data.session) {
      setNotice("Check your email to confirm your account, then log in.");
      return;
    }
    router.push(welcomeHref());
  };

  const onLogIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Real auth path: Flask. Login sets the session cookie; surface Flask's exact
    // error (invalid / disabled / locked-out with the minutes message) inline.
    if (isFlaskConfigured()) {
      setSubmitting(true);
      const li = await flaskLogin({ email, password });
      setSubmitting(false);
      if (!li.ok) {
        setError(li.data?.error ?? "Could not log you in. Please try again.");
        return;
      }
      router.push(callbackUrl ?? "/opportunities");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    // Demo mode (no Supabase env): keep the mock push. Only the email is typed at
    // login, so merge it into any identity saved at sign-up (keeping name/business).
    if (!supabase) {
      const prior = getStoredDemoUser() ?? { name: null, businessName: null };
      saveDemoUser({ ...prior, email: email.trim() || null });
      router.push(callbackUrl ?? "/opportunities");
      return;
    }
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push("/opportunities");
  };

  const signUpForm = (
    <form onSubmit={onSignUp} style={AUTH_FORM}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={AUTH_H1}>Create your account</h1>
        <p style={AUTH_SUB}>Start free. No card needed.</p>
      </div>
      <GoogleButton mobile={mobile} />
      <Divider />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field id="su-name" label="Your name" placeholder="Ada Osei" value={yourName} onChange={setYourName} />
        <Field id="su-business" label="Business name" placeholder="Ada's Bakery" value={businessName} onChange={setBusinessName} />
        <Field id="su-email" label="Work email" type="email" placeholder="you@yourshop.com" value={email} onChange={setEmail} />
        <Field id="su-password" label="Password" type="password" value={password} onChange={setPassword} />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <NoticeNote>{notice}</NoticeNote>}
      <SubmitButton mobile={mobile} disabled={submitting}>
        {submitting ? "Creating account…" : "Create account"}
      </SubmitButton>
      <span
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginTop: -8,
          fontFamily: "var(--font-body)",
          fontSize: 12,
          lineHeight: "18px",
          color: "var(--text-muted)",
        }}
      >
        <Icons name="shield" size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        Read-only access. I can&apos;t edit your site or spend your money.
      </span>
      <span style={FOOTER}>
        Already have an account?{" "}
        <Link href={withCallback("/login")} className="gv-auth-link" style={LINK}>
          Log in
        </Link>
      </span>
    </form>
  );

  const logInForm = (
    <form onSubmit={onLogIn} style={AUTH_FORM}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={AUTH_H1}>Welcome back</h1>
        <p style={AUTH_SUB}>Pick up where you left off.</p>
      </div>
      <GoogleButton mobile={mobile} />
      <Divider />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field id="li-email" label="Work email" type="email" placeholder="you@yourshop.com" value={email} onChange={setEmail} />
        <Field id="li-password" label="Password" type="password" value={password} onChange={setPassword} />
        <a
          href="#"
          className="gv-auth-link"
          style={{ ...LINK, alignSelf: "flex-end", display: "inline-flex", alignItems: "center", minHeight: 44, fontFamily: "var(--font-body)", fontSize: 13 }}
        >
          Forgot password?
        </a>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <SubmitButton mobile={mobile} disabled={submitting}>
        {submitting ? "Logging in…" : "Log in"}
      </SubmitButton>
      <span style={FOOTER}>
        New to Groville?{" "}
        <Link href={withCallback("/signup")} className="gv-auth-link" style={LINK}>
          Start free
        </Link>
      </span>
    </form>
  );

  return (
    <>
      <style href="gv-auth" precedence="high">
        {AUTH_CSS}
      </style>
      <div
        className="groville-auth"
        style={{
          minHeight: "100dvh",
          display: "grid",
          gridTemplateColumns: mobile ? "1fr" : "45fr 55fr",
          background: "var(--auth-canvas)",
          color: "var(--auth-ink)",
          fontFamily: "var(--font-body)",
        }}
      >
        {!mobile && <BrandPanel />}
        <main
          style={{
            display: "flex",
            alignItems: mobile ? "flex-start" : "center",
            justifyContent: "center",
            background: "var(--auth-canvas)",
            padding: mobile ? "48px 22px" : "72px 64px",
          }}
        >
          {mode === "signup" ? signUpForm : logInForm}
        </main>
      </div>
    </>
  );
}
