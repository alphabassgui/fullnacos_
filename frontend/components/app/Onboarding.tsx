"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/ds";
import { useMediaQuery } from "./use-media-query";
import { createBusiness, isFlaskConfigured } from "@/lib/api";
import { setCurrentBusinessId } from "@/lib/current-business";
import { markOnboarded } from "@/lib/onboarding";

/**
 * Onboarding — the 6-step split-screen intake in the demo loop
 * (welcome → ONBOARDING → analysing → opportunities). Ported pixel-for-pixel from the
 * Claude Design export in docs/onboarding-reference.html (decoded from its bundler manifest),
 * NOT from any Onboarding.jsx in the reference bundle.
 *
 * Design notes:
 *   1. This is a FULL-SCREEN split flow — it does NOT render inside DashboardShell (no rail/top bar).
 *   2. Both themes, dark default. The screen follows the app theme (?theme / localStorage /
 *      prefers-color-scheme boot in app/layout.tsx). Colors are scoped to the .gv-ob root as local
 *      --gv-* vars — dark values are the base, redefined under html[data-theme="light"] .gv-ob to the
 *      project's warm-cream LIGHT tokens. The LEFT photo panel is pinned dark in both themes (fixed
 *      imagery; its wordmark + headline stay white via PHOTO_INK so they read over the dark photo).
 *
 * Honesty boundary: Groville reads and drafts. The website step is explicitly read-only and the
 * final action only kicks off analysis. Nothing here publishes or sends on its own.
 *
 * Navigation: the export used static .html hrefs; here the last step routes with the Next router —
 * "Analyze my site" → /analysing (which auto-advances to /opportunities), and
 * "Skip to my dashboard" → /opportunities directly.
 */

const TOTAL = 6;
/** Step indices that hold a required field (see the `body` array order). */
const NAME_STEP = 0;
const WEBSITE_STEP = 4;
const STEP_NAMES = ["Business", "Offer", "Customers", "Goal", "Website", "Analyze"];
const PHOTO_BG = "#06070C";
const INK = "var(--gv-ink)";
/** The photo panel is pinned dark in both themes; its text stays white so it reads over the image. */
const PHOTO_INK = "#F3F7FE";

const ANALYSE_HREF = "/analysing";
const SKIP_HREF = "/opportunities";

/** Scoped styles: dark-only tokens, canvas glow suppression, Ken Burns drift, input + focus rings.
 *  The export referenced design-system classes (gv-ob-kenburns, groville-input, groville-focus)
 *  that do not exist in globals.css, so their rules live here. */
const ONBOARDING_CSS = `
.gv-ob{
  --gv-ink:#F3F7FE;
  --gv-secondary:#AEBBD4;
  --gv-muted:#7C8BA8;
  --gv-primary:#185DF1;
  --gv-link:#5B8CF0;
  --gv-on-primary:#F3F7FE;
  --gv-canvas:#04060F;
  --gv-field-bg:rgba(243,247,254,.04);
  --gv-field-border:rgba(243,247,254,.13);
  --gv-placeholder:rgba(243,247,254,.34);
  --gv-option-bg:rgba(243,247,254,.035);
  --gv-option-bg-sel:rgba(24,93,241,.16);
  --gv-option-ring:0 0 0 3px rgba(24,93,241,.18);
  --gv-ghost-border:rgba(243,247,254,.14);
  --gv-track:rgba(243,247,254,.10);
  --gv-dot-idle:rgba(243,247,254,.22);
}
/* Light: map to the project's warm-cream LIGHT tokens. Photo panel stays pinned dark. */
html[data-theme="light"] .gv-ob{
  --gv-ink:#1B1A17;
  --gv-secondary:#4A5568;
  --gv-muted:#6B6456;
  --gv-primary:#185DF1;
  --gv-link:#1747C7;
  --gv-on-primary:#FFFFFF;
  --gv-canvas:#F6F1E8;
  --gv-field-bg:#FFFFFF;
  --gv-field-border:#D8CFBD;
  --gv-placeholder:#948E83;
  --gv-option-bg:#FFFFFF;
  --gv-option-bg-sel:#F0E9DC;
  --gv-option-ring:none;
  --gv-ghost-border:#D8CFBD;
  --gv-track:rgba(27,26,23,.10);
  --gv-dot-idle:rgba(27,26,23,.20);
}
/* Repaint the canvas and kill the landing's ambient dark glows for this full-screen route. */
html[data-theme="dark"] body::before,
html[data-theme="dark"] body::after,
html[data-theme="dark"]::before,
html[data-theme="dark"] #root::after,
body:has(.gv-ob)::before,
body:has(.gv-ob)::after{content:none!important;display:none!important}
body:has(.gv-ob){background:#04060F!important}
html[data-theme="light"] body:has(.gv-ob){background:#F6F1E8!important}
.gv-ob-kenburns{
  animation:gv-ob-kenburns 20s ease-in-out infinite alternate;
  transform-origin:center;
  will-change:transform;
}
@keyframes gv-ob-kenburns{
  from{transform:scale(1.06) translate(0,0)}
  to{transform:scale(1.12) translate(-1.5%,-1%)}
}
.groville-input::placeholder{color:var(--gv-placeholder)}
.groville-input:focus{
  outline:none;
  border-color:var(--gv-primary)!important;
  box-shadow:0 0 0 3px rgba(24,93,241,.20);
}
.groville-focus:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(24,93,241,.35)}
@media (prefers-reduced-motion:reduce){
  .gv-ob-kenburns{animation:none;transform:none}
}
`;

function PhotoPanel() {
  return (
    <aside className="gv-ob-photo" style={{ position: "relative", overflow: "hidden", background: PHOTO_BG }}>
      <div className="gv-ob-kenburns" style={{ position: "absolute", inset: 0 }}>
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
        <Wordmark size={22} style={{ color: PHOTO_INK }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 40,
              lineHeight: "48px",
              letterSpacing: "-1px",
              color: PHOTO_INK,
              textWrap: "pretty",
            }}
          >
            The customers you are missing, found.
          </h2>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              lineHeight: "20px",
              color: "rgba(243,247,254,.62)",
            }}
          >
            Trusted by local businesses like yours
          </p>
        </div>
      </div>
    </aside>
  );
}

function Tracker({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)" }}>
        {STEP_NAMES.map((name, i) => {
          const done = i <= step;
          const active = i === step;
          return (
            <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: active ? 10 : 7,
                  height: active ? 10 : 7,
                  borderRadius: 999,
                  background: done ? "var(--gv-primary)" : "var(--gv-dot-idle)",
                  boxShadow: active ? "0 0 0 4px rgba(24,93,241,.22)" : "none",
                  transition: "background var(--dur) var(--ease)",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontWeight: active ? 500 : 400,
                  fontSize: 13,
                  lineHeight: "18px",
                  color: active ? INK : done ? "var(--gv-primary)" : "var(--gv-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "relative", height: 2, borderRadius: 2, background: "var(--gv-track)" }}>
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            height: 2,
            borderRadius: 2,
            width: ((step + 1) / TOTAL) * 100 + "%",
            background: "var(--gv-primary)",
            transition: "width var(--dur) var(--ease)",
          }}
        />
      </div>
      <span
        style={{
          alignSelf: "flex-end",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          lineHeight: "16px",
          color: "var(--gv-muted)",
        }}
      >
        step {step + 1} of {TOTAL}
      </span>
    </div>
  );
}

function MobileTracker({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      <div style={{ position: "relative", height: 3, borderRadius: 3, background: "var(--gv-track)" }}>
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            height: 3,
            borderRadius: 3,
            width: ((step + 1) / TOTAL) * 100 + "%",
            background: "var(--gv-primary)",
          }}
        />
      </div>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", color: "var(--gv-muted)" }}>
        <b style={{ fontWeight: 500, color: "var(--gv-primary)" }}>{STEP_NAMES[step]}</b> · {step + 1} of {TOTAL}
      </span>
    </div>
  );
}

function StepHeading({ mobile, children }: { mobile: boolean; children: ReactNode }) {
  return (
    <h1
      style={{
        margin: 0,
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: mobile ? 26 : 32,
        lineHeight: mobile ? "34px" : "40px",
        letterSpacing: "-0.7px",
        color: INK,
        textWrap: "pretty",
      }}
    >
      {children}
    </h1>
  );
}

function OnbField({
  id,
  label,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  type?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", color: "var(--gv-secondary)" }}>
        {label}
      </span>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="groville-input"
        style={{
          height: 52,
          padding: "0 18px",
          borderRadius: 10,
          background: "var(--gv-field-bg)",
          border: "1px solid var(--gv-field-border)",
          color: INK,
          fontFamily: "var(--font-body)",
          fontSize: 15,
          lineHeight: "20px",
          transition: "border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
        }}
      />
    </label>
  );
}

const GOALS = [
  "Get more customers",
  "Increase sales",
  "Get more website traffic",
  "Generate leads",
  "Grow my online presence",
  "I'm not sure",
];

/** Inline error on the finish step, mirroring Auth.tsx's ErrorNote (--error token, in-flow). */
function ErrorNote({ children }: { children: ReactNode }) {
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

/**
 * Normalize the website step into a URL to send, or null to omit it. Flask validates
 * website_url server-side, so we only send something that looks valid (prepending
 * https:// when the scheme is missing) and omit anything empty/invalid rather than
 * forcing a guaranteed 400. A URL that passes here but Flask still rejects surfaces inline.
 */
function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Combine the Offer, Customers, and Goal steps into a description for the business record. */
function buildDescription(offer: string, audience: string, goal: string | null): string {
  const parts: string[] = [];
  const o = offer.trim();
  const a = audience.trim();
  const g = goal?.trim();
  if (o) parts.push(`We offer ${o}.`);
  if (a) parts.push(`Our ideal customers are ${a}.`);
  if (g) parts.push(`Our main growth goal is ${g.toLowerCase()}.`);
  return parts.join(" ");
}

/** Map a failed createBusiness() result to a friendly inline message. */
function createErrorMessage(status: number, data: unknown): string {
  const serverMsg =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : null;
  if (status === 401) return "Your session has expired. Please log in again.";
  if (serverMsg) return serverMsg;
  if (status === 400) return "Please check your details and try again.";
  return "Something went wrong creating your business. Please try again.";
}

function GoalOption({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="groville-focus gv-ob-option"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        minHeight: 48,
        textAlign: "left",
        cursor: "pointer",
        padding: "12px 18px",
        borderRadius: 10,
        background: selected ? "var(--gv-option-bg-sel)" : "var(--gv-option-bg)",
        border: "1px solid " + (selected ? "var(--gv-primary)" : "var(--gv-field-border)"),
        boxShadow: selected ? "var(--gv-option-ring)" : "none",
        fontFamily: "var(--font-body)",
        fontSize: 15,
        lineHeight: "20px",
        color: selected ? INK : "var(--gv-secondary)",
        transition:
          "border-color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
      }}
    >
      {label}
    </button>
  );
}

function StepActions({
  step,
  mobile,
  onBack,
  label = "Continue",
  disabled = false,
}: {
  step: number;
  mobile: boolean;
  onBack: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const radius = mobile ? 999 : 10;
  return (
    <div
      style={{
        display: mobile ? "grid" : "flex",
        gap: 12,
        gridTemplateColumns: "1fr",
        paddingTop: 8,
      }}
    >
      <button
        type="submit"
        disabled={disabled}
        className="groville-focus gv-ob-primary"
        style={{
          order: mobile ? 1 : 2,
          flex: 1,
          minHeight: 52,
          padding: "14px 24px",
          borderRadius: radius,
          border: "none",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.7 : 1,
          background: "var(--gv-primary)",
          color: "var(--gv-on-primary)",
          fontFamily: "var(--font-body)",
          fontWeight: 500,
          fontSize: 15,
          lineHeight: "20px",
        }}
      >
        {label}
      </button>
      {step > 0 && (
        <button
          type="button"
          onClick={onBack}
          className="groville-focus gv-ob-ghost"
          style={{
            order: mobile ? 2 : 1,
            minHeight: 52,
            padding: "14px 26px",
            borderRadius: radius,
            cursor: "pointer",
            border: "1px solid var(--gv-ghost-border)",
            background: "transparent",
            fontFamily: "var(--font-body)",
            fontSize: 15,
            lineHeight: "20px",
            color: "var(--gv-link)",
          }}
        >
          Back
        </button>
      )}
    </div>
  );
}

export function Onboarding({ initialStep = 0 }: { initialStep?: number }) {
  // The reference switches from split to stacked at 860px; keep that breakpoint (not the app's 767px).
  const mobile = useMediaQuery("(max-width: 860px)");
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [name, setName] = useState("");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [website, setWebsite] = useState("");
  const [goal, setGoal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create the real business record, then continue into the (still mock) analysis flow.
  const finish = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter your business name.");
      return;
    }
    setError(null);
    setSubmitting(true);

    const payload: { name: string; website_url?: string; description?: string } = { name: trimmedName };
    const websiteUrl = normalizeWebsite(website);
    if (websiteUrl) payload.website_url = websiteUrl;
    const description = buildDescription(offer, audience, goal);
    if (description) payload.description = description;

    try {
      const { ok, status, data } = await createBusiness(payload);
      if (ok) {
        const business =
          data && typeof data === "object" ? (data as { business?: { id?: string } }).business : null;
        if (business?.id) setCurrentBusinessId(business.id);
        markOnboarded();
        router.push(ANALYSE_HREF);
        return;
      }
      setError(createErrorMessage(status, data));
    } catch {
      setError("I couldn't reach the server. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (step !== TOTAL - 1) {
      // Required-field gates so nothing essential is left blank until the end.
      // The website is required because the real analyze pipeline needs it (a
      // business with no website_url makes POST /analyze return 400).
      if (step === NAME_STEP && !name.trim()) {
        setError("Please enter your business name.");
        return;
      }
      if (step === WEBSITE_STEP && !normalizeWebsite(website)) {
        setError("Please enter your website address, like adasbakery.com, so I can read your pages.");
        return;
      }
      setError(null);
      setStep((s) => s + 1);
      return;
    }
    // Demo mode (no backend): unchanged — just kick off the simulated analysis.
    if (!isFlaskConfigured()) {
      markOnboarded();
      router.push(ANALYSE_HREF);
      return;
    }
    void finish();
  };
  const back = () => {
    if (submitting) return;
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const body = [
    <div key="1" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeading mobile={mobile}>First, what&apos;s your business called?</StepHeading>
      <OnbField
        id="ob-name"
        label="Business or brand name"
        placeholder="Ada's Bakery"
        value={name}
        onChange={setName}
      />
    </div>,
    <div key="2" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeading mobile={mobile}>What do you sell or offer?</StepHeading>
      <OnbField
        id="ob-offer"
        label="Products or services"
        placeholder="Custom cakes and pastries"
        value={offer}
        onChange={setOffer}
      />
    </div>,
    <div key="3" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeading mobile={mobile}>Who are your ideal customers?</StepHeading>
      <OnbField
        id="ob-audience"
        label="Ideal customers"
        placeholder="Young professionals and event planners in Lagos"
        value={audience}
        onChange={setAudience}
      />
    </div>,
    <div key="4" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeading mobile={mobile}>What&apos;s your main growth goal?</StepHeading>
      <div role="group" aria-label="Main growth goal" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {GOALS.map((g) => (
          <GoalOption key={g} label={g} selected={goal === g} onSelect={() => setGoal(g)} />
        ))}
      </div>
    </div>,
    <div key="5" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeading mobile={mobile}>What&apos;s your website?</StepHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <OnbField
          id="ob-site"
          label="Website address"
          type="url"
          placeholder="https://adasbakery.com"
          value={website}
          onChange={setWebsite}
        />
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, lineHeight: "18px", color: "var(--gv-muted)" }}>
          I&apos;ll read your public pages to understand what you offer. Read-only.
        </span>
      </div>
    </div>,
    <div key="6" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeading mobile={mobile}>I&apos;m ready to analyze your site.</StepHeading>
    </div>,
  ][step];

  return (
    <>
      <style href="gv-onboarding" precedence="high">
        {ONBOARDING_CSS}
      </style>
      <div
        className="gv-ob"
        style={{
          minHeight: "100dvh",
          display: "grid",
          gridTemplateColumns: mobile ? "1fr" : "45fr 55fr",
          background: "var(--gv-canvas)",
          color: INK,
          fontFamily: "var(--font-body)",
        }}
      >
        {!mobile && <PhotoPanel />}
        <main
          style={{
            display: "flex",
            alignItems: mobile ? "flex-start" : "center",
            justifyContent: "center",
            background: "var(--gv-canvas)",
            padding: mobile ? "28px 22px 44px" : "72px 64px",
          }}
        >
          <form
            onSubmit={next}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: mobile ? 28 : 44,
              width: "100%",
              maxWidth: mobile ? 420 : 460,
            }}
          >
            {mobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <Wordmark size={19} style={{ color: INK }} />
                <MobileTracker step={step} />
              </div>
            ) : (
              <Tracker step={step} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>{body}</div>
            {error && <ErrorNote>{error}</ErrorNote>}
            <StepActions
              step={step}
              mobile={mobile}
              onBack={back}
              disabled={submitting}
              label={
                step === TOTAL - 1 ? (submitting ? "Creating…" : "Analyze my site") : "Continue"
              }
            />
            {/* Demo mode only: in Flask mode, skipping here leaves the user with no
                business and bounces them straight back to the Opportunities recovery
                card (a loop), so we require finishing the short setup instead. */}
            {step === TOTAL - 1 && !isFlaskConfigured() && (
              <button
                type="button"
                onClick={() => {
                  markOnboarded();
                  router.push(SKIP_HREF);
                }}
                disabled={submitting}
                className="groville-focus gv-ob-skip"
                style={
                  {
                    alignSelf: mobile ? "stretch" : "flex-start",
                    marginTop: -8,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                    padding: "0 4px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    lineHeight: "20px",
                    color: "var(--gv-link)",
                  } as CSSProperties
                }
              >
                Skip to my dashboard
              </button>
            )}
          </form>
        </main>
      </div>
    </>
  );
}
