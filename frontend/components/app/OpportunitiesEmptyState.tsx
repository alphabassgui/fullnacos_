"use client";

/**
 * OpportunitiesEmptyState — the dual-recovery card shown on the Opportunities
 * dashboard when a signed-in Flask user has no audit to show: either no business
 * at all, or a business created during onboarding whose website step was skipped
 * (so no analyze run ever ran). It lets them recover WITHOUT wiping their session:
 *
 *  - PRIMARY: "Add website & run audit" opens a small modal with a single domain
 *    field. On submit it creates the business (or attaches the website to the
 *    existing one) and triggers the real analyze run — no onboarding questionnaire
 *    required. The parent then flips to the analyzing/polling view.
 *  - SECONDARY: "Restart guided onboarding" quietly routes back to /onboarding.
 *
 * Styling reuses the existing dashboard tokens (C.*, DISPLAY, BODY) and ds Button —
 * flat surfaces, no glass, no new design-system styles. Honesty boundary kept:
 * Groville reads and drafts; nothing goes live without approval.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons, Button } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW } from "./shell";
import { useIsMobile } from "./use-media-query";
import { createBusiness, updateBusiness, analyzeBusiness } from "@/lib/api";
import { setCurrentBusinessId } from "@/lib/current-business";

const SERIF = "var(--font-serif)";

/* ── Domain handling ──────────────────────────────────────────────────────── */

/** Strip scheme, leading www, and any path/query/hash; l-case. "store.com.ng" stays. */
function normalizeDomain(raw: string): string {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/^www\./, "");
  v = v.replace(/[/?#].*$/, "");
  v = v.replace(/\.$/, "");
  return v;
}

// Labels of 1-63 [a-z0-9-] (no leading/trailing hyphen), 2+ of them, alpha TLD.
// Accepts multi-part TLDs like store.com.ng.
const DOMAIN_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function isValidDomain(host: string): boolean {
  return DOMAIN_RE.test(host);
}

/** A sensible business name from the domain's first label ("store.com.ng" → "Store"). */
function nameFromDomain(host: string): string {
  const first = host.split(".")[0] || host;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function OpportunitiesEmptyState({
  businessId,
  onAuditStarted,
}: {
  /** Existing business to attach the website to, or null when there is none yet. */
  businessId: string | null;
  /** Called once the analyze run is triggered, with the business id to poll. */
  onAuditStarted: (businessId: string) => void;
}) {
  const m = useIsMobile();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const restart = useCallback(() => {
    router.replace("/onboarding");
  }, [router]);

  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg, display: "flex" }}>
      <div
        style={{
          margin: "auto",
          width: "100%",
          maxWidth: 560,
          boxSizing: "border-box",
          padding: m ? "40px 16px" : "48px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 24,
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: C.s2,
            border: "1px solid " + C.border,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icons name="globe" size={20} style={{ color: C.blueText }} />
        </span>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={MONO_EYEBROW}>Groville</span>
          <h1
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: m ? "clamp(26px, 8vw, 32px)" : 34,
              lineHeight: m ? 1.15 : "42px",
              letterSpacing: "-0.8px",
              color: C.text,
              textWrap: "pretty",
            }}
          >
            Add your website and I&apos;ll find the customers you&apos;re{" "}
            <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>
              missing
            </em>
            .
          </h1>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 15, lineHeight: "22px", color: C.secondary, maxWidth: 460 }}>
            Looks like we never audited a site for you. Drop your domain and I&apos;ll read your public pages
            to spot the searches you can win — then draft a campaign for each. Nothing goes live until you
            approve it.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: m ? "column" : "row",
            alignItems: m ? "stretch" : "center",
            gap: 12,
            width: m ? "100%" : undefined,
          }}
        >
          <Button
            hierarchy="primary"
            size="xl"
            icon="trailing"
            iconName="arrow-right"
            onClick={() => setOpen(true)}
            style={{
              borderRadius: m ? 999 : 10,
              width: m ? "100%" : undefined,
              justifyContent: "center",
            }}
          >
            Add website &amp; run audit
          </Button>
          <Button
            hierarchy="secondary gray"
            size="xl"
            onClick={restart}
            style={{
              borderRadius: m ? 999 : 10,
              width: m ? "100%" : undefined,
              justifyContent: "center",
            }}
          >
            Restart guided onboarding
          </Button>
        </div>
      </div>

      {open && (
        <AddWebsiteModal
          businessId={businessId}
          onClose={() => setOpen(false)}
          onAuditStarted={onAuditStarted}
        />
      )}
    </main>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────────── */

/**
 * Minimal accessible modal in the dashboard idiom — mirrors the shell's mobile
 * drawer pattern (fixed backdrop, role="dialog" + aria-modal, Esc + backdrop
 * close, body-scroll lock). No new design-system styles: surfaces and borders are
 * the existing C.* tokens.
 */
function AddWebsiteModal({
  businessId,
  onClose,
  onAuditStarted,
}: {
  businessId: string | null;
  onClose: () => void;
  onAuditStarted: (businessId: string) => void;
}) {
  const m = useIsMobile();
  const titleId = useId();
  const [domain, setDomain] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  // Open: remember focus, move it into the dialog, lock scroll. Close restores.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      const el = restoreFocusRef.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, []);

  // Esc to close; Tab trapped within the dialog.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const startAudit = useCallback(async () => {
    const host = normalizeDomain(domain);
    if (!isValidDomain(host)) {
      setError("Enter a valid domain, like store.com.ng");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const websiteUrl = `https://${host}`;
    try {
      let id = businessId;
      if (id == null) {
        const created = await createBusiness({ name: nameFromDomain(host), website_url: websiteUrl });
        if (!created.ok) {
          setError(created.status === 400 ? "I couldn't read that domain. Check it and try again." : "Something went wrong saving your site. Give it another try.");
          setBusy(false);
          return;
        }
        const biz =
          created.data && typeof created.data === "object"
            ? (created.data as { business?: { id?: string } }).business
            : null;
        id = biz?.id ?? null;
        if (!id) {
          setError("Something went wrong setting up your site. Give it another try.");
          setBusy(false);
          return;
        }
      } else {
        const updated = await updateBusiness(id, { website_url: websiteUrl });
        if (!updated.ok) {
          setError(updated.status === 400 ? "I couldn't read that domain. Check it and try again." : "Something went wrong saving your site. Give it another try.");
          setBusy(false);
          return;
        }
      }

      const started = await analyzeBusiness(id);
      if (!started.ok) {
        setError("I saved your site, but couldn't start the audit. Give it another try.");
        setBusy(false);
        return;
      }

      // Remember the business so the dashboard resolves to it after the run.
      setCurrentBusinessId(id);
      onClose();
      onAuditStarted(id);
    } catch {
      setError("I couldn't reach the server. Give it another try.");
      setBusy(false);
    }
  }, [domain, businessId, onClose, onAuditStarted]);

  const inputTone = error ? C.bad : focused ? C.blue : C.border;

  return (
    <div
      onClick={onClose}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: m ? "flex-end" : "center",
        justifyContent: "center",
        padding: m ? 0 : 24,
        background: "rgba(1,4,12,0.6)",
        boxSizing: "border-box",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: m ? "100%" : "min(440px, calc(100vw - 48px))",
          maxHeight: m ? "90dvh" : "calc(100dvh - 48px)",
          overflowY: "auto",
          boxSizing: "border-box",
          background: C.s1,
          border: "1px solid " + C.border,
          borderRadius: m ? "16px 16px 0 0" : 16,
          padding: m ? "24px 16px calc(24px + env(safe-area-inset-bottom))" : 28,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxShadow: "0 24px 64px rgba(1,4,12,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
            <span style={MONO_EYEBROW}>Groville</span>
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 20,
                lineHeight: "26px",
                letterSpacing: "-0.3px",
                color: C.text,
              }}
            >
              Add Website &amp; Run Audit
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: C.muted,
            }}
          >
            <Icons name="x" size={18} />
          </button>
        </div>

        <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "20px", color: C.secondary }}>
          I&apos;ll read your public pages and find the gaps worth fixing. This can take a few seconds.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            htmlFor={titleId + "-domain"}
            style={{ fontFamily: BODY, fontWeight: 500, fontSize: 14, lineHeight: "20px", color: C.secondary }}
          >
            Your website
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 44,
              padding: "10px 14px",
              boxSizing: "border-box",
              borderRadius: 8,
              background: C.bg,
              boxShadow: "inset 0 0 0 1px " + inputTone,
            }}
          >
            <Icons name="globe" size={18} style={{ color: C.muted }} />
            <input
              ref={inputRef}
              id={titleId + "-domain"}
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                if (error) setError(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) {
                  e.preventDefault();
                  void startAudit();
                }
              }}
              placeholder="store.com.ng"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? titleId + "-err" : undefined}
              style={{
                flexGrow: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: BODY,
                fontWeight: 400,
                fontSize: 16,
                lineHeight: "24px",
                color: C.text,
              }}
            />
          </div>
          {error && (
            <span
              id={titleId + "-err"}
              style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.bad }}
            >
              <Icons name="alert-circle" size={14} />
              {error}
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: m ? "column-reverse" : "row",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 2,
          }}
        >
          <Button
            hierarchy="tertiary gray"
            size="lg"
            onClick={onClose}
            disabled={busy}
            style={{ borderRadius: m ? 999 : 10, width: m ? "100%" : undefined, justifyContent: "center" }}
          >
            Cancel
          </Button>
          <Button
            hierarchy="primary"
            size="lg"
            onClick={() => void startAudit()}
            disabled={busy}
            state={busy ? "disabled" : "default"}
            style={{ borderRadius: m ? 999 : 10, width: m ? "100%" : undefined, justifyContent: "center" }}
          >
            {busy ? "Starting…" : "Analyze"}
          </Button>
        </div>
      </div>
    </div>
  );
}
