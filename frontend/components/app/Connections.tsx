"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icons } from "@/components/ds";
import { C, DISPLAY, BODY, MONO_EYEBROW, DashboardShell } from "./shell";
import { InfoTip } from "@/components/ui/tooltip";
import { useIsMobile } from "./use-media-query";
import { useBusiness } from "@/lib/use-business";
import {
  githubConnect,
  githubRepositories,
  githubSetRepository,
  githubDisconnect,
  searchConsoleConnect,
  searchConsoleProperties,
  searchConsoleSelectProperty,
  searchConsoleAnalytics,
  type FlaskGithubRepository,
  type FlaskSearchConsoleProperty,
  type FlaskSearchConsoleRow,
} from "@/lib/api";

/**
 * Connections — the GitHub + Google Search Console screen, wired to the real
 * Flask backend.
 *
 * SCOPE: GitHub and Google Search Console (GSC). For GitHub the owner connects
 * their account and picks the repository Groville may read. For GSC the owner
 * connects Search Console, picks the property Groville may read, and sees that
 * property's recent search analytics. GSC is CONNECT + DISPLAY only: no
 * Instagram, no other tools.
 *
 * Honesty boundary (never break): connecting GitHub only LINKS the account so I
 * can read the code and draft changes. Connecting Search Console only lets me
 * READ your search data to show it here — it does not make the audit smarter
 * yet. Nothing publishes, merges, sends or runs on its own; every change still
 * waits for the owner's approval elsewhere in the app.
 *
 * Data / env safety: every network call goes through lib/api.ts (which forces
 * credentials:'include' and reads NEXT_PUBLIC_API_BASE). When no backend is
 * configured (demo) we render sample preview cards, and when a signed-in user
 * has no business yet disabled cards; both make ZERO network calls — so the
 * build passes with no env set.
 *
 * Status: there is no /status route for either. On mount we call GET
 * /repositories (GitHub) and GET /properties (GSC):
 *   200 → connected (the list drives the picker)
 *   404 "... not found / not connected" → not connected
 *   401 → not authenticated, route to /login like the rest of the app.
 * GitHub's connected state offers a confirm-gated "Disconnect GitHub" control
 * (DELETE /connection); GSC has no disconnect endpoint yet. After a GSC property
 * is selected we read GET /analytics once and display it read-only; that panel
 * failing never breaks the card.
 *
 * Visual language matches the other dashboards: flat solid surfaces (no
 * glass/blur), dashboard tokens via `C`, both themes, mobile-pill / desktop
 * rounded-rect buttons, middle dots (never em dashes), 8px grid.
 */

const SERIF = "var(--font-serif)";
const LOGIN_HREF = "/login";
const ONBOARDING_HREF = "/onboarding";

/** Screen-scoped shadow + toast tokens/animation. Drop shadow + 1px ring, not glass. */
const CONN_CSS = `
:root{
  --conn-card-shadow:0 1px 2px rgba(2,8,26,.30);
}
:root[data-theme="light"]{
  --conn-card-shadow:0 1px 2px rgba(3,17,48,.05);
}
@keyframes gvConnToastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.gv-conn-toast{animation:gvConnToastIn .18s ease-out both}
@media (prefers-reduced-motion: reduce){
  .gv-conn-toast{animation:none}
}
`;

/* ── Small building blocks ─────────────────────────────────────────────── */

/** A small lock glyph for private repositories (there is no `lock` icon in ds). */
function LockGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type ConnState = "loading" | "connected" | "not_connected" | "error" | "disabled" | "preview";

/** Status pill mirroring the app's dashboard chip look. */
function StateChip({ state, service = "github" }: { state: ConnState; service?: "github" | "gsc" }) {
  const gsc = service === "gsc";
  const label =
    state === "connected"
      ? "Connected"
      : state === "loading"
        ? "Checking…"
        : state === "error"
          ? "Couldn't check"
          : state === "disabled"
            ? "Not available"
            : state === "preview"
              ? "Sample preview"
              : "Not connected";
  const color = state === "connected" ? C.secondary : state === "error" ? C.bad : C.muted;
  const tip = gsc
    ? state === "connected"
      ? "Your Search Console is linked so I can read your search data. I only read it · it doesn't change the audit yet."
      : state === "error"
        ? "I couldn't check this connection just now. Try again in a moment."
        : state === "disabled"
          ? "This connection isn't available in this environment yet."
          : state === "preview"
            ? "This is a preview with sample data. Sign up and add a business to connect your real Search Console."
            : state === "loading"
              ? "Checking whether your Search Console is linked."
              : "Not linked yet. Connect Search Console so I can read your search data."
    : state === "connected"
      ? "Your GitHub is linked so I can read your code. I never merge or publish on my own."
      : state === "error"
        ? "I couldn't check this connection just now. Try again in a moment."
        : state === "disabled"
          ? "This connection isn't available in this environment yet."
          : state === "preview"
            ? "This is a preview with sample data. Sign up and add a business to connect your real GitHub."
            : state === "loading"
              ? "Checking whether your GitHub is linked."
              : "Not linked yet. Connect GitHub so I can read your code and draft changes.";
  return (
    <InfoTip side="left" style={{ display: "inline-flex" }} tip={tip}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid " + C.border,
          fontFamily: BODY,
          fontSize: 13,
          lineHeight: "18px",
          color,
          whiteSpace: "nowrap",
        }}
      >
        {state === "connected" && (
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 100, background: C.good }} />
        )}
        {label}
      </span>
    </InfoTip>
  );
}

/** A primary/secondary button honoring the mobile-pill / desktop rounded-rect rule. */
function ActionButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  danger,
  m,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  /** Destructive emphasis for the secondary variant: error-token border + text. */
  danger?: boolean;
  m: boolean;
}) {
  const primary = variant === "primary";
  const dangerOutline = !primary && danger;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={"gv-btn " + (primary ? "gv-btn--primary" : "gv-btn--outline")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 44,
        padding: "12px 22px",
        width: m ? "100%" : undefined,
        borderRadius: m ? 999 : 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        background: primary ? C.blue : "transparent",
        border: primary ? "none" : "1px solid " + (dangerOutline ? C.bad : C.border),
        color: primary ? C.onPrimary : dangerOutline ? C.bad : C.text,
        fontFamily: BODY,
        fontWeight: 500,
        fontSize: 15,
        lineHeight: "20px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** The GitHub card shell: glyph + name + status chip, then a state-specific body. */
function GithubCard({ state, body, m }: { state: ConnState; body: ReactNode; m: boolean }) {
  return (
    <article
      className="gv-card"
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: m ? 20 : 24,
        boxShadow: "var(--conn-card-shadow)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: m ? "column" : "row",
          alignItems: m ? "stretch" : "flex-start",
          gap: m ? 12 : 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0, flex: 1 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              flexShrink: 0,
              background: C.s2,
              border: "1px solid " + C.border,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icons name="github" size={18} style={{ color: C.blueText }} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, lineHeight: "23px", color: C.text }}>
              GitHub
            </span>
            <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.muted, textWrap: "pretty" }}>
              I read your site&apos;s code and draft changes for your approval. I never merge or publish on my own.
            </span>
          </span>
        </div>
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: m ? 54 : 0 }}>
          <StateChip state={state} />
        </span>
      </div>
      {body}
    </article>
  );
}

/** The multicolor Google "G" mark (third-party brand logo, rendered at natural
 *  brand colors — the only place raw colors are allowed, like a brand glyph). */
function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/** The GSC card shell: Google glyph + name + status chip, then a state body. */
function GscCard({ state, body, m }: { state: ConnState; body: ReactNode; m: boolean }) {
  return (
    <article
      className="gv-card"
      style={{
        background: C.s1,
        border: "1px solid " + C.border,
        borderRadius: 16,
        padding: m ? 20 : 24,
        boxShadow: "var(--conn-card-shadow)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: m ? "column" : "row",
          alignItems: m ? "stretch" : "flex-start",
          gap: m ? 12 : 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0, flex: 1 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              flexShrink: 0,
              background: C.s2,
              border: "1px solid " + C.border,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GoogleGlyph size={18} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, lineHeight: "23px", color: C.text }}>
              Google Search Console
            </span>
            <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "18px", color: C.muted, textWrap: "pretty" }}>
              I read your Search Console data to see what people search for. Connecting only lets me read it · it
              doesn&apos;t change the audit yet.
            </span>
          </span>
        </div>
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: m ? 54 : 0 }}>
          <StateChip state={state} service="gsc" />
        </span>
      </div>
      {body}
    </article>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────────── */

type Toast = { id: number; kind: "success" | "error"; message: string };

/** A fixed, auto-dismissing banner. Flat surface, tinted accent, reduced-motion safe. */
function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const success = toast.kind === "success";
  return (
    <div
      role="status"
      aria-live="polite"
      className="gv-conn-toast"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "calc(100vw - 32px)",
        padding: "12px 16px",
        borderRadius: 12,
        background: C.s2,
        border: "1px solid " + (success ? C.good : C.bad),
        boxShadow: "0 12px 32px rgba(0,0,0,.28)",
        fontFamily: BODY,
        fontSize: 14,
        lineHeight: "20px",
        color: C.text,
      }}
    >
      <Icons name={success ? "check" : "alert-triangle"} size={16} style={{ color: success ? C.good : C.bad }} />
      <span style={{ textWrap: "pretty" }}>{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          marginLeft: 4,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: C.muted,
          display: "inline-flex",
          padding: 2,
        }}
      >
        <Icons name="cross" size={14} />
      </button>
    </div>
  );
}

/* ── Repo picker ───────────────────────────────────────────────────────── */

/** One selectable repository row. */
function RepoRow({
  repo,
  selected,
  saving,
  onSelect,
}: {
  repo: FlaskGithubRepository;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={saving}
      aria-pressed={selected}
      className="gv-nav-item"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 12,
        cursor: saving ? "progress" : "pointer",
        background: selected ? C.s2 : "transparent",
        border: "1px solid " + (selected ? C.blueText : C.border),
        fontFamily: BODY,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 500,
              fontSize: 15,
              lineHeight: "20px",
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {repo.name}
          </span>
          {repo.private && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid " + C.border,
                color: C.muted,
                fontSize: 11,
                lineHeight: "16px",
                flexShrink: 0,
              }}
            >
              <LockGlyph size={11} />
              Private
            </span>
          )}
        </span>
        <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>
          Default branch · {repo.default_branch}
        </span>
      </span>
      {selected && !saving && <Icons name="check" size={16} style={{ color: C.good, flexShrink: 0 }} />}
      {saving && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>Saving…</span>}
    </button>
  );
}

/* ── The real GitHub connection flow (Flask mode, current business present) ── */

type Phase =
  | { kind: "loading" }
  | { kind: "not_connected" }
  | { kind: "connected"; repositories: FlaskGithubRepository[] }
  | { kind: "error" };

function GithubConnection({ businessId, showToast }: { businessId: string; showToast: ShowToast }) {
  const m = useIsMobile();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selected, setSelected] = useState<{ repository: string; default_branch: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [savingRepo, setSavingRepo] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Ignore results from a superseded status fetch (business change / retry).
  const reqId = useRef(0);

  /** Status check: GET /repositories. 200 → connected, 404 → not connected, 401 → login. */
  const runStatus = useCallback(() => {
    const id = ++reqId.current;
    githubRepositories(businessId).then((result) => {
      if (id !== reqId.current) return;

      if (result.status === 401) {
        router.replace(LOGIN_HREF);
        return;
      }
      if (result.status === 404) {
        setPhase({ kind: "not_connected" });
        return;
      }
      const list =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { repositories?: FlaskGithubRepository[] }).repositories
          : null;
      if (!result.ok || !Array.isArray(list)) {
        setPhase({ kind: "error" });
        return;
      }
      setPhase({ kind: "connected", repositories: list });
    });
  }, [businessId, router]);

  // Status check on mount. The parent keys this component by businessId, so a
  // business change remounts it with fresh "loading" state — the effect only
  // kicks off the async request (no synchronous setState). reqId guards staleness.
  useEffect(() => {
    runStatus();
  }, [runStatus]);

  // Handle the OAuth return param (?github=connected | ?github=error), then strip
  // it so a refresh doesn't re-fire. Reads window.location directly rather than
  // useSearchParams (which forces a Suspense boundary during prerendering).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("github");
    if (flag !== "connected" && flag !== "error") return;

    if (flag === "connected") {
      showToast("success", "GitHub is connected. Pick the repository I should read.");
    } else {
      showToast("error", "I couldn't finish connecting GitHub. Give it another try.");
    }

    url.searchParams.delete("github");
    const cleaned = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (cleaned ? "?" + cleaned : "") + url.hash);
    // The mount status check (runStatus) already reflects the now-connected state.
  }, [showToast]);

  const connect = useCallback(() => {
    if (connecting) return;
    setConnecting(true);
    githubConnect(businessId).then((result) => {
      if (result.status === 401) {
        router.replace(LOGIN_HREF);
        return;
      }
      const authUrl =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { authorization_url?: string }).authorization_url
          : null;
      if (result.ok && typeof authUrl === "string" && authUrl) {
        // Full-page redirect to GitHub's OAuth screen (not a fetch-follow).
        window.location.href = authUrl;
        return;
      }
      setConnecting(false);
      showToast("error", "I couldn't start the GitHub connection. Give it another try.");
    });
  }, [businessId, connecting, router, showToast]);

  const selectRepo = useCallback(
    (repo: FlaskGithubRepository) => {
      if (savingRepo) return;
      setSavingRepo(repo.full_name);
      githubSetRepository(businessId, repo.full_name).then((result) => {
        if (result.status === 401) {
          router.replace(LOGIN_HREF);
          return;
        }
        const data = result.data && typeof result.data === "object" ? result.data : null;
        const repository = data ? (data as { repository?: string }).repository : undefined;
        const branch = data ? (data as { default_branch?: string }).default_branch : undefined;
        if (result.ok) {
          setSelected({
            repository: typeof repository === "string" ? repository : repo.full_name,
            default_branch: typeof branch === "string" ? branch : repo.default_branch,
          });
          showToast("success", `I'll read from ${typeof repository === "string" ? repository : repo.full_name}.`);
        } else {
          showToast("error", "I couldn't set that repository. Give it another try.");
        }
        setSavingRepo(null);
      });
    },
    [businessId, savingRepo, router, showToast],
  );

  const disconnect = useCallback(() => {
    if (disconnecting) return;
    setDisconnecting(true);
    githubDisconnect(businessId).then((result) => {
      if (result.status === 401) {
        router.replace(LOGIN_HREF);
        return;
      }
      // 200 removed, or 404 already gone — both leave GitHub unlinked.
      if (result.ok || result.status === 404) {
        setSelected(null);
        setConfirmingDisconnect(false);
        setPhase({ kind: "not_connected" });
        showToast("success", "GitHub disconnected. You can connect again anytime.");
      } else {
        showToast("error", "I couldn't disconnect GitHub. Give it another try.");
      }
      setDisconnecting(false);
    });
  }, [businessId, disconnecting, router, showToast]);

  const chipState: ConnState =
    phase.kind === "connected"
      ? "connected"
      : phase.kind === "loading"
        ? "loading"
        : phase.kind === "error"
          ? "error"
          : "not_connected";

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = <p style={NOTE_STYLE}>Checking your GitHub connection…</p>;
  } else if (phase.kind === "error") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={NOTE_STYLE}>Something went wrong reaching the server. Give it another try.</p>
        <ActionButton
          variant="secondary"
          onClick={() => {
            setPhase({ kind: "loading" });
            runStatus();
          }}
          m={m}
        >
          Try again
        </ActionButton>
      </div>
    );
  } else if (phase.kind === "not_connected") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ActionButton onClick={connect} disabled={connecting} m={m}>
          <Icons name="github" size={16} />
          {connecting ? "Opening GitHub…" : "Connect GitHub"}
        </ActionButton>
        <p style={NOTE_STYLE}>Connecting only links the account. Nothing publishes or runs without your approval.</p>
      </div>
    );
  } else {
    // connected: repo picker (+ selected summary when one has been chosen).
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {selected && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 12,
              background: C.s2,
              border: "1px solid " + C.border,
            }}
          >
            <Icons name="check" size={16} style={{ color: C.good, flexShrink: 0 }} />
            <span style={{ fontFamily: BODY, fontSize: 14, lineHeight: "20px", color: C.text, minWidth: 0 }}>
              I&apos;m reading from{" "}
              <span style={{ fontFamily: DISPLAY, fontWeight: 500 }}>{selected.repository}</span> · {selected.default_branch}
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={SUBHEAD_STYLE}>{selected ? "Change repository" : "Pick the repository I should read"}</span>
          {phase.repositories.length === 0 ? (
            <p style={NOTE_STYLE}>I don&apos;t see any repositories on this account yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {phase.repositories.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  selected={selected?.repository === repo.full_name}
                  saving={savingRepo === repo.full_name}
                  onSelect={() => selectRepo(repo)}
                />
              ))}
            </div>
          )}
        </div>
        <p style={NOTE_STYLE}>
          I only read the repository you pick. I never merge or publish · every change waits for your approval.
        </p>

        <div style={{ borderTop: "1px solid " + C.border, paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {!confirmingDisconnect ? (
            <ActionButton variant="secondary" onClick={() => setConfirmingDisconnect(true)} m={m}>
              Disconnect GitHub
            </ActionButton>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ ...NOTE_STYLE, color: C.bad }}>
                This unlinks GitHub · you&apos;ll re-authorize to reconnect.
              </p>
              <div style={{ display: "flex", flexDirection: m ? "column" : "row", gap: 10 }}>
                <ActionButton
                  variant="secondary"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                  m={m}
                >
                  Cancel
                </ActionButton>
                <ActionButton variant="secondary" danger onClick={disconnect} disabled={disconnecting} m={m}>
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </ActionButton>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <GithubCard state={chipState} body={body} m={m} />;
}

/* ── Google Search Console connection (Flask mode, current business present) ── */

/** Shared toast dispatcher, lifted to ConnectionsBody so both cards share one. */
type ShowToast = (kind: Toast["kind"], message: string) => void;

type GscPhase =
  | { kind: "loading" }
  | { kind: "not_connected" }
  | { kind: "connected"; properties: FlaskSearchConsoleProperty[]; selected: string | null }
  | { kind: "error" };

type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };

type GscAnalyticsPhase =
  | { kind: "loading" }
  | {
      kind: "ready";
      site_url: string;
      start_date: string;
      end_date: string;
      totals: GscTotals;
      top_queries: FlaskSearchConsoleRow[];
      top_pages: FlaskSearchConsoleRow[];
    }
  | { kind: "error" };

/** Integer counts with thousands separators (clicks, impressions). */
function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";
}

/** A 0–1 ratio rendered as a percentage with one decimal. */
function fmtPct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}

/** Average position, one decimal. */
function fmtPos(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

/** Parse the analytics envelope into the "ready" shape, or null if malformed. */
function parseAnalytics(data: unknown): Omit<Extract<GscAnalyticsPhase, { kind: "ready" }>, "kind"> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const totals = d.totals && typeof d.totals === "object" ? (d.totals as Record<string, unknown>) : null;
  if (!totals) return null;
  const rows = (v: unknown): FlaskSearchConsoleRow[] => (Array.isArray(v) ? (v as FlaskSearchConsoleRow[]) : []);
  const num = (v: unknown): number => (typeof v === "number" ? v : NaN);
  return {
    site_url: typeof d.site_url === "string" ? d.site_url : "",
    start_date: typeof d.start_date === "string" ? d.start_date : "",
    end_date: typeof d.end_date === "string" ? d.end_date : "",
    totals: {
      clicks: num(totals.clicks),
      impressions: num(totals.impressions),
      ctr: num(totals.ctr),
      position: num(totals.position),
    },
    top_queries: rows(d.top_queries),
    top_pages: rows(d.top_pages),
  };
}

/** One totals tile (flat solid surface, display-font number). */
function TotalTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 14px",
        borderRadius: 12,
        background: C.s2,
        border: "1px solid " + C.border,
        minWidth: 0,
      }}
    >
      <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 20, lineHeight: "26px", color: C.text }}>
        {value}
      </span>
      <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>{label}</span>
    </div>
  );
}

/** A compact ranked list (Top queries / Top pages). */
function AnalyticsList({ title, rows }: { title: string; rows: FlaskSearchConsoleRow[] }) {
  const capped = rows.slice(0, 10);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
      <span style={SUBHEAD_STYLE}>{title}</span>
      {capped.length === 0 ? (
        <p style={NOTE_STYLE}>Nothing to show for this window yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {capped.map((row, i) => (
            <div
              key={(row.keys?.[0] ?? "") + i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 10,
                background: C.s2,
                border: "1px solid " + C.border,
              }}
            >
              <span
                style={{
                  fontFamily: BODY,
                  fontSize: 13,
                  lineHeight: "18px",
                  color: C.text,
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={row.keys?.[0] ?? ""}
              >
                {row.keys?.[0] ?? "—"}
              </span>
              <span style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 13, lineHeight: "18px", color: C.text, flexShrink: 0 }}>
                {fmtInt(row.clicks)}
                <span style={{ fontFamily: BODY, fontWeight: 400, color: C.muted }}> clicks</span>
              </span>
              <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted, flexShrink: 0 }}>
                {fmtInt(row.impressions)} impr
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Read-only Search Console analytics for the selected property. Fetches once
 * (or renders seeded data from the mount probe). Its own errors are contained:
 * a failure here shows a muted retry and never breaks the connected card.
 */
function GscAnalyticsPanel({
  businessId,
  seed,
  m,
}: {
  businessId: string;
  seed: Extract<GscAnalyticsPhase, { kind: "ready" }> | null;
  m: boolean;
}) {
  const [phase, setPhase] = useState<GscAnalyticsPhase>(seed ?? { kind: "loading" });
  const reqId = useRef(0);

  // Fetch-only: sets state solely inside the promise callback (never
  // synchronously in an effect body), mirroring the GitHub status fetch.
  const fetchAnalytics = useCallback(() => {
    const id = ++reqId.current;
    searchConsoleAnalytics(businessId).then((result) => {
      if (id !== reqId.current) return;
      const parsed = result.ok ? parseAnalytics(result.data) : null;
      setPhase(parsed ? { kind: "ready", ...parsed } : { kind: "error" });
    });
  }, [businessId]);

  // If we were seeded from the mount probe, keep it; otherwise fetch once.
  // phase already starts at "loading", so the effect only kicks off the request.
  useEffect(() => {
    if (seed) return;
    fetchAnalytics();
  }, [seed, fetchAnalytics]);

  if (phase.kind === "loading") {
    return (
      <div style={{ borderTop: "1px solid " + C.border, paddingTop: 16 }}>
        <p style={NOTE_STYLE}>Reading your Search Console data…</p>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div style={{ borderTop: "1px solid " + C.border, paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={NOTE_STYLE}>Couldn&apos;t load Search Console data right now.</p>
        <ActionButton
          variant="secondary"
          onClick={() => {
            setPhase({ kind: "loading" });
            fetchAnalytics();
          }}
          m={m}
        >
          Try again
        </ActionButton>
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid " + C.border, paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: m ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
          gap: 10,
        }}
      >
        <TotalTile label="Clicks" value={fmtInt(phase.totals.clicks)} />
        <TotalTile label="Impressions" value={fmtInt(phase.totals.impressions)} />
        <TotalTile label="CTR" value={fmtPct(phase.totals.ctr)} />
        <TotalTile label="Avg position" value={fmtPos(phase.totals.position)} />
      </div>

      <div style={{ display: "flex", flexDirection: m ? "column" : "row", gap: 16 }}>
        <AnalyticsList title="Top queries" rows={phase.top_queries} />
        <AnalyticsList title="Top pages" rows={phase.top_pages} />
      </div>

      {(phase.start_date || phase.end_date) && (
        <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>
          {phase.start_date} → {phase.end_date}
        </span>
      )}
      <p style={NOTE_STYLE}>
        This is read-only Search Console data I can see · it doesn&apos;t change the audit yet.
      </p>
    </div>
  );
}

/** One selectable Search Console property row (mirrors RepoRow). */
function GscPropertyRow({
  property,
  selected,
  saving,
  onSelect,
}: {
  property: FlaskSearchConsoleProperty;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={saving}
      aria-pressed={selected}
      className="gv-nav-item"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 12,
        cursor: saving ? "progress" : "pointer",
        background: selected ? C.s2 : "transparent",
        border: "1px solid " + (selected ? C.blueText : C.border),
        fontFamily: BODY,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 500,
            fontSize: 15,
            lineHeight: "20px",
            color: C.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {property.site_url}
        </span>
        <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>
          {property.permission_level}
        </span>
      </span>
      {selected && !saving && <Icons name="check" size={16} style={{ color: C.good, flexShrink: 0 }} />}
      {saving && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>Saving…</span>}
    </button>
  );
}

function SearchConsoleConnection({ businessId, showToast }: { businessId: string; showToast: ShowToast }) {
  const m = useIsMobile();
  const router = useRouter();

  const [phase, setPhase] = useState<GscPhase>({ kind: "loading" });
  const [connecting, setConnecting] = useState(false);
  const [savingProperty, setSavingProperty] = useState<string | null>(null);
  // Seed for the analytics panel when a selection is restored on mount.
  const [analyticsSeed, setAnalyticsSeed] = useState<Extract<GscAnalyticsPhase, { kind: "ready" }> | null>(null);

  // Ignore results from a superseded status fetch (business change / retry).
  const reqId = useRef(0);

  /** Status check: GET /properties. 200 → connected, 404 → not connected, 401 → login.
   *  On 200 we probe /analytics once to restore any existing property selection. */
  const runStatus = useCallback(() => {
    const id = ++reqId.current;
    searchConsoleProperties(businessId).then((result) => {
      if (id !== reqId.current) return;

      if (result.status === 401) {
        router.replace(LOGIN_HREF);
        return;
      }
      if (result.status === 404) {
        setPhase({ kind: "not_connected" });
        return;
      }
      const list =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { properties?: FlaskSearchConsoleProperty[] }).properties
          : null;
      if (!result.ok || !Array.isArray(list)) {
        setPhase({ kind: "error" });
        return;
      }

      // Connected. Probe analytics to detect a property already selected: a 200
      // means one is selected (seed the panel); a 400 "no property selected"
      // means show the picker; any other outcome falls back to the picker and
      // the panel will surface its own error once a property is chosen.
      setPhase({ kind: "connected", properties: list, selected: null });
      searchConsoleAnalytics(businessId).then((aResult) => {
        if (id !== reqId.current) return;
        if (aResult.ok) {
          const parsed = parseAnalytics(aResult.data);
          if (parsed && parsed.site_url) {
            setAnalyticsSeed({ kind: "ready", ...parsed });
            setPhase({ kind: "connected", properties: list, selected: parsed.site_url });
          }
        }
        // 400 / anything else: leave selected null → picker.
      });
    });
  }, [businessId, router]);

  // Status check on mount. The parent keys this component by businessId, so a
  // business change remounts it with fresh "loading" state. reqId guards staleness.
  useEffect(() => {
    runStatus();
  }, [runStatus]);

  // Handle the OAuth return param (?search_console=connected | error), then strip
  // it so a refresh doesn't re-fire. Twin of the GitHub ?github= handler.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("search_console");
    if (flag !== "connected" && flag !== "error") return;

    if (flag === "connected") {
      showToast("success", "Google Search Console is connected. Pick the property I should read.");
    } else {
      showToast("error", "I couldn't finish connecting Search Console. Give it another try.");
    }

    url.searchParams.delete("search_console");
    const cleaned = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (cleaned ? "?" + cleaned : "") + url.hash);
    // The mount status check (runStatus) already reflects the now-connected state.
  }, [showToast]);

  const connect = useCallback(() => {
    if (connecting) return;
    setConnecting(true);
    searchConsoleConnect(businessId).then((result) => {
      if (result.status === 401) {
        router.replace(LOGIN_HREF);
        return;
      }
      const authUrl =
        result.ok && result.data && typeof result.data === "object"
          ? (result.data as { authorization_url?: string }).authorization_url
          : null;
      if (result.ok && typeof authUrl === "string" && authUrl) {
        // Full-page redirect to Google's OAuth screen (not a fetch-follow).
        window.location.href = authUrl;
        return;
      }
      setConnecting(false);
      showToast("error", "I couldn't start the Search Console connection. Give it another try.");
    });
  }, [businessId, connecting, router, showToast]);

  const selectProperty = useCallback(
    (property: FlaskSearchConsoleProperty) => {
      if (savingProperty) return;
      setSavingProperty(property.site_url);
      searchConsoleSelectProperty(businessId, property.site_url).then((result) => {
        if (result.status === 401) {
          router.replace(LOGIN_HREF);
          return;
        }
        if (result.ok) {
          setAnalyticsSeed(null); // let the panel fetch fresh for the new property.
          setPhase((prev) =>
            prev.kind === "connected" ? { ...prev, selected: property.site_url } : prev,
          );
          showToast("success", `I'll read ${property.site_url} from Search Console.`);
        } else {
          showToast("error", "I couldn't set that property. Give it another try.");
        }
        setSavingProperty(null);
      });
    },
    [businessId, savingProperty, router, showToast],
  );

  const chipState: ConnState =
    phase.kind === "connected"
      ? "connected"
      : phase.kind === "loading"
        ? "loading"
        : phase.kind === "error"
          ? "error"
          : "not_connected";

  let body: ReactNode;
  if (phase.kind === "loading") {
    body = <p style={NOTE_STYLE}>Checking your Search Console connection…</p>;
  } else if (phase.kind === "error") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={NOTE_STYLE}>Something went wrong reaching the server. Give it another try.</p>
        <ActionButton
          variant="secondary"
          onClick={() => {
            setPhase({ kind: "loading" });
            runStatus();
          }}
          m={m}
        >
          Try again
        </ActionButton>
      </div>
    );
  } else if (phase.kind === "not_connected") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ActionButton onClick={connect} disabled={connecting} m={m}>
          <GoogleGlyph size={16} />
          {connecting ? "Opening Google…" : "Connect Google Search Console"}
        </ActionButton>
        <p style={NOTE_STYLE}>
          Connecting only lets me read your Search Console data · it doesn&apos;t change the audit yet.
        </p>
      </div>
    );
  } else {
    // connected: property picker, or the selected summary + analytics panel.
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {phase.selected && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 12,
              background: C.s2,
              border: "1px solid " + C.border,
            }}
          >
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 100, background: C.good, flexShrink: 0 }} />
            <span style={{ fontFamily: BODY, fontSize: 14, lineHeight: "20px", color: C.text, minWidth: 0 }}>
              I&apos;m reading{" "}
              <span style={{ fontFamily: DISPLAY, fontWeight: 500 }}>{phase.selected}</span> from Search Console.
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={SUBHEAD_STYLE}>{phase.selected ? "Change property" : "Pick the property I should read"}</span>
          {phase.properties.length === 0 ? (
            <p style={NOTE_STYLE}>I don&apos;t see any Search Console properties on this account yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {phase.properties.map((property) => (
                <GscPropertyRow
                  key={property.site_url}
                  property={property}
                  selected={phase.selected === property.site_url}
                  saving={savingProperty === property.site_url}
                  onSelect={() => selectProperty(property)}
                />
              ))}
            </div>
          )}
        </div>

        {phase.selected && (
          <GscAnalyticsPanel key={phase.selected} businessId={businessId} seed={analyticsSeed} m={m} />
        )}
      </div>
    );
  }

  return <GscCard state={chipState} body={body} m={m} />;
}

/* ── No-business / demo state (no network calls) ───────────────────────── */

/** Sample repositories for the demo preview. Static, display-only. */
const DEMO_REPOS: FlaskGithubRepository[] = [
  { id: 1, name: "adas-bakery-site", full_name: "adas-bakery/adas-bakery-site", private: false, default_branch: "main", html_url: "" },
  { id: 2, name: "adas-bakery-orders", full_name: "adas-bakery/adas-bakery-orders", private: true, default_branch: "main", html_url: "" },
];

/**
 * Demo-mode preview (no backend configured). Looks connectable, but it is a
 * preview: no network calls, nothing is actually connected.
 */
function DemoGithubCard() {
  const m = useIsMobile();
  const [clicked, setClicked] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ActionButton onClick={() => setClicked(true)} m={m}>
        <Icons name="github" size={16} />
        Connect GitHub
      </ActionButton>

      {clicked && (
        <>
          <p style={NOTE_STYLE}>
            This is a preview, so nothing is connected. Once you add your business, I&apos;ll link your real GitHub
            here.{" "}
            <Link href={ONBOARDING_HREF} style={{ color: C.blueText, textDecoration: "none" }}>
              Add your business
            </Link>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={SUBHEAD_STYLE}>Pick the repository I should read</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DEMO_REPOS.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  selected={picked === repo.full_name}
                  saving={false}
                  onSelect={() => setPicked(repo.full_name)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <p style={NOTE_STYLE}>
        I only read the repository you pick. I never merge or publish · every change waits for your approval.
      </p>
    </div>
  );
  return <GithubCard state="preview" body={body} m={m} />;
}

/** Disabled card shown only for a signed-in user who has no business yet. */
function NoBusinessCard() {
  const m = useIsMobile();
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ActionButton disabled m={m}>
        <Icons name="github" size={16} />
        Connect GitHub
      </ActionButton>
      <p style={NOTE_STYLE}>
        I need a business first.{" "}
        <Link href={ONBOARDING_HREF} style={{ color: C.blueText, textDecoration: "none" }}>
          Add your website in onboarding
        </Link>{" "}
        and then I can connect GitHub.
      </p>
    </div>
  );
  return <GithubCard state="disabled" body={body} m={m} />;
}

/** Sample Search Console properties for the demo preview. Static, display-only. */
const DEMO_GSC_PROPERTIES: FlaskSearchConsoleProperty[] = [
  { site_url: "https://adasbakery.ng/", permission_level: "siteOwner" },
  { site_url: "sc-domain:adasbakery.ng", permission_level: "siteFullUser" },
];

/** Sample analytics for the demo preview, using the locked demo numbers. */
const DEMO_GSC_ANALYTICS: Extract<GscAnalyticsPhase, { kind: "ready" }> = {
  kind: "ready",
  site_url: "https://adasbakery.ng/",
  start_date: "2026-09-19",
  end_date: "2026-10-16",
  totals: { clicks: 1284, impressions: 10420, ctr: 0.1232, position: 18.4 },
  top_queries: [
    { keys: ["bakery near me"], clicks: 265, impressions: 880, ctr: 0.3011, position: 34 },
    { keys: ["cake delivery lagos"], clicks: 182, impressions: 320, ctr: 0.5688, position: 18 },
    { keys: ["wedding cake tasting"], clicks: 41, impressions: 140, ctr: 0.2929, position: 52 },
  ],
  top_pages: [
    { keys: ["https://adasbakery.ng/"], clicks: 410, impressions: 3200, ctr: 0.1281, position: 9 },
    { keys: ["https://adasbakery.ng/cakes"], clicks: 236, impressions: 2100, ctr: 0.1124, position: 14 },
    { keys: ["https://adasbakery.ng/order"], clicks: 128, impressions: 980, ctr: 0.1306, position: 21 },
  ],
};

/**
 * Demo-mode preview (no backend configured). Looks connectable, but it is a
 * preview: no network calls, nothing is actually connected.
 */
function DemoGscCard() {
  const m = useIsMobile();
  const [clicked, setClicked] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ActionButton onClick={() => setClicked(true)} m={m}>
        <GoogleGlyph size={16} />
        Connect Google Search Console
      </ActionButton>

      {clicked && (
        <>
          <p style={NOTE_STYLE}>
            This is a preview, so nothing is connected. Once you add your business, I&apos;ll link your real Search
            Console here.{" "}
            <Link href={ONBOARDING_HREF} style={{ color: C.blueText, textDecoration: "none" }}>
              Add your business
            </Link>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={SUBHEAD_STYLE}>{picked ? "Change property" : "Pick the property I should read"}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DEMO_GSC_PROPERTIES.map((property) => (
                <GscPropertyRow
                  key={property.site_url}
                  property={property}
                  selected={picked === property.site_url}
                  saving={false}
                  onSelect={() => setPicked(property.site_url)}
                />
              ))}
            </div>
          </div>
          {picked && (
            <div style={{ borderTop: "1px solid " + C.border, paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: m ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10 }}>
                <TotalTile label="Clicks" value={fmtInt(DEMO_GSC_ANALYTICS.totals.clicks)} />
                <TotalTile label="Impressions" value={fmtInt(DEMO_GSC_ANALYTICS.totals.impressions)} />
                <TotalTile label="CTR" value={fmtPct(DEMO_GSC_ANALYTICS.totals.ctr)} />
                <TotalTile label="Avg position" value={fmtPos(DEMO_GSC_ANALYTICS.totals.position)} />
              </div>
              <div style={{ display: "flex", flexDirection: m ? "column" : "row", gap: 16 }}>
                <AnalyticsList title="Top queries" rows={DEMO_GSC_ANALYTICS.top_queries} />
                <AnalyticsList title="Top pages" rows={DEMO_GSC_ANALYTICS.top_pages} />
              </div>
              <span style={{ fontFamily: BODY, fontSize: 12, lineHeight: "16px", color: C.muted }}>
                {DEMO_GSC_ANALYTICS.start_date} → {DEMO_GSC_ANALYTICS.end_date}
              </span>
            </div>
          )}
        </>
      )}

      <p style={NOTE_STYLE}>
        This is read-only Search Console data I can see · it doesn&apos;t change the audit yet.
      </p>
    </div>
  );
  return <GscCard state="preview" body={body} m={m} />;
}

/** Disabled GSC card shown only for a signed-in user who has no business yet. */
function NoBusinessGscCard() {
  const m = useIsMobile();
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ActionButton disabled m={m}>
        <GoogleGlyph size={16} />
        Connect Google Search Console
      </ActionButton>
      <p style={NOTE_STYLE}>
        I need a business first.{" "}
        <Link href={ONBOARDING_HREF} style={{ color: C.blueText, textDecoration: "none" }}>
          Add your website in onboarding
        </Link>{" "}
        and then I can connect Search Console.
      </p>
    </div>
  );
  return <GscCard state="disabled" body={body} m={m} />;
}

/* ── Shared text styles ────────────────────────────────────────────────── */

const NOTE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: BODY,
  fontSize: 13,
  lineHeight: "19px",
  color: C.muted,
  textWrap: "pretty",
};

const SUBHEAD_STYLE: CSSProperties = {
  fontFamily: DISPLAY,
  fontWeight: 500,
  fontSize: 14,
  lineHeight: "20px",
  color: C.text,
};

/* ── Screen ────────────────────────────────────────────────────────────── */

function ConnectionsBody() {
  const m = useIsMobile();
  const business = useBusiness();

  // Toast is lifted here so the GitHub and Search Console cards share one.
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);

  const showToast = useCallback<ShowToast>((kind, message) => {
    setToast({ id: ++toastSeq.current, kind, message });
  }, []);

  // Auto-dismiss the toast; re-armed whenever a new toast replaces it.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast((current) => (current && current.id === toast.id ? null : current));
    }, 4500);
    return () => clearTimeout(t);
  }, [toast]);

  let gscCard: ReactNode;
  let githubCard: ReactNode;
  if (business.status === "loading") {
    gscCard = <GscCard state="loading" body={<p style={NOTE_STYLE}>Loading your dashboard…</p>} m={m} />;
    githubCard = <GithubCard state="loading" body={<p style={NOTE_STYLE}>Loading your dashboard…</p>} m={m} />;
  } else if (business.status === "ready" && business.businessId) {
    gscCard = <SearchConsoleConnection key={business.businessId} businessId={business.businessId} showToast={showToast} />;
    githubCard = <GithubConnection key={business.businessId} businessId={business.businessId} showToast={showToast} />;
  } else if (business.status === "demo") {
    // demo mode (no backend): sample previews, mirroring Opportunities' demo posture.
    gscCard = <DemoGscCard />;
    githubCard = <DemoGithubCard />;
  } else {
    // status === "none": a signed-in user with genuinely no business yet.
    gscCard = <NoBusinessGscCard />;
    githubCard = <NoBusinessCard />;
  }

  return (
    <main style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <style dangerouslySetInnerHTML={{ __html: CONN_CSS }} />
      <div
        style={{
          padding: m ? "24px 16px 40px" : "32px 40px 48px",
          display: "flex",
          flexDirection: "column",
          gap: m ? 24 : 32,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          <span style={MONO_EYEBROW}>Connections</span>
          <h2
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontWeight: 500,
              fontSize: m ? 22 : 26,
              lineHeight: m ? "30px" : "34px",
              letterSpacing: "-0.3px",
              color: C.text,
              textWrap: "pretty",
            }}
          >
            Connect your tools so I can read your code and search{" "}
            <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>data</em>.
          </h2>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
            I&apos;ll read the repository and Search Console property you pick. Connecting only lets me read · nothing
            publishes, sends or runs on its own, and your search data doesn&apos;t change the audit yet.
          </p>
        </div>

        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: m ? 24 : 32 }}>
          {gscCard}
          {githubCard}
        </div>
      </div>
      {toast && <ToastView toast={toast} onDismiss={() => setToast(null)} />}
    </main>
  );
}

export function ConnectionsScreen() {
  return (
    <DashboardShell active="Connections" title="Connections" chips={false}>
      <ConnectionsBody />
    </DashboardShell>
  );
}
