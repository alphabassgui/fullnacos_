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
  type FlaskGithubRepository,
} from "@/lib/api";

/**
 * Connections — the GitHub connection screen, wired to the real Flask backend.
 *
 * SCOPE: GitHub only. No Instagram, no Google/Search Console UI. The owner
 * connects their GitHub account and picks the repository Groville may read.
 *
 * Honesty boundary (never break): connecting GitHub only LINKS the account so I
 * can read the code and draft changes. Nothing publishes, merges or runs on its
 * own; every change still waits for the owner's approval elsewhere in the app.
 *
 * Data / env safety: every network call goes through lib/api.ts (which forces
 * credentials:'include' and reads NEXT_PUBLIC_API_BASE). When no backend is
 * configured, or the user has no business yet, we render a disabled card and
 * make ZERO network calls — so the build passes with no env set.
 *
 * Status: there is no /status route. On mount we call GET /repositories:
 *   200 → connected (the list drives the repo picker)
 *   404 "GitHub connection not found" → not connected
 *   401 → not authenticated, route to /login like the rest of the app.
 * There is no disconnect endpoint, so no disconnect control is offered.
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

type ConnState = "loading" | "connected" | "not_connected" | "error" | "disabled";

/** Status pill mirroring the app's dashboard chip look. */
function StateChip({ state }: { state: ConnState }) {
  const label =
    state === "connected"
      ? "Connected"
      : state === "loading"
        ? "Checking…"
        : state === "error"
          ? "Couldn't check"
          : state === "disabled"
            ? "Not available"
            : "Not connected";
  const color = state === "connected" ? C.secondary : state === "error" ? C.bad : C.muted;
  const tip =
    state === "connected"
      ? "Your GitHub is linked so I can read your code. I never merge or publish on my own."
      : state === "error"
        ? "I couldn't check this connection just now. Try again in a moment."
        : state === "disabled"
          ? "This connection isn't available in this environment yet."
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
  m,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  m: boolean;
}) {
  const primary = variant === "primary";
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
        border: primary ? "none" : "1px solid " + C.border,
        color: primary ? C.onPrimary : C.text,
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

function GithubConnection({ businessId }: { businessId: string }) {
  const m = useIsMobile();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selected, setSelected] = useState<{ repository: string; default_branch: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [savingRepo, setSavingRepo] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Ignore results from a superseded status fetch (business change / retry).
  const reqId = useRef(0);
  const toastSeq = useRef(0);

  const showToast = useCallback((kind: Toast["kind"], message: string) => {
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
      </div>
    );
  }

  return (
    <>
      <GithubCard state={chipState} body={body} m={m} />
      {toast && <ToastView toast={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}

/* ── No-business / demo state (no network calls) ───────────────────────── */

/** Disabled card shown when there's no current business (demo mode, or no business yet). */
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

  let card: ReactNode;
  if (business.status === "loading") {
    card = <GithubCard state="loading" body={<p style={NOTE_STYLE}>Loading your dashboard…</p>} m={m} />;
  } else if (business.status === "ready" && business.businessId) {
    card = <GithubConnection key={business.businessId} businessId={business.businessId} />;
  } else {
    // demo mode (no env) or a signed-in user with no business yet.
    card = <NoBusinessCard />;
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
            Connect GitHub so I can read your{" "}
            <em style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: C.blueText }}>code</em>.
          </h2>
          <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: "21px", color: C.secondary, textWrap: "pretty" }}>
            I&apos;ll read the repository you pick and draft changes for your approval. Connecting only links the
            account · nothing publishes or runs on its own.
          </p>
        </div>

        <div style={{ maxWidth: 720 }}>{card}</div>
      </div>
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
