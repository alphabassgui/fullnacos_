"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icons, Logomark, Wordmark } from "@/components/ds";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile, usePrefersReducedMotion } from "./use-media-query";
import { Tour } from "./Tour";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useUser } from "@/lib/use-user";
import { isFlaskConfigured, logout as flaskLogout } from "@/lib/api";
import { clearDemoUser } from "@/lib/demo-user";
import { useAuth } from "@/lib/auth-context";
import { useSidebarCollapsed, toggleSidebarCollapsed } from "@/lib/sidebar";
import { useTour } from "@/lib/tour";

/**
 * Shared dashboard chrome (ported from the OpenDesign `ui_kits/app/Shell.jsx`).
 * Dark is home; every colour resolves to a Signal Blue dashboard token and flips
 * under `data-theme="light"`. Dashboards use FLAT solid surfaces — no glass / blur.
 *
 * Responsive: desktop keeps the 240px rail + top bar; below 768px the rail collapses
 * into a hamburger drawer (same content), following the landing's MobileNav pattern.
 */

/** Token map — mirrors the reference so screens can share it via import. */
export const C = {
  bg: "var(--bg)",
  s1: "var(--surface-1)",
  s2: "var(--surface-2)",
  border: "var(--border)",
  text: "var(--text)",
  secondary: "var(--text-secondary)",
  muted: "var(--text-muted)",
  blue: "var(--primary)",
  primaryHover: "var(--primary-hover)",
  blueText: "var(--accent-text)",
  onPrimary: "var(--text-on-primary)",
  good: "var(--success)",
  bad: "var(--error)",
} as const;

export const DISPLAY = "var(--font-display)";
export const BODY = "var(--font-body)";

const NAV_ITEMS: [icon: string, label: string, href: string][] = [
  ["telemetry", "Opportunities", "/opportunities"],
  ["work-flow", "Campaigns", "/campaigns"],
  ["vital-sign", "Results", "/results"],
  ["link", "Connections", "/connections"],
];

/** Sidebar navigation row. Internal routes render as a Next `Link`. When the rail
 *  is collapsed the label is hidden and shown as an accessible tooltip instead. */
function NavItem({
  icon,
  label,
  active,
  href,
  collapsed,
  onNavigate,
}: {
  icon: string;
  label: string;
  active?: boolean;
  href: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      data-tour={"nav-" + label.toLowerCase()}
      className="gv-nav-item"
      aria-label={collapsed ? label : undefined}
      style={{
        textDecoration: "none",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: collapsed ? "10px 0" : "10px 12px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontFamily: BODY,
        fontSize: 14,
        lineHeight: "20px",
        background: active ? C.s2 : "transparent",
        color: active ? C.text : C.secondary,
        boxShadow: active ? "0 0 16px rgba(24,93,241,0.28), inset 0 0 0 1px " + C.border : "none",
      }}
    >
      <Icons name={icon} size={18} style={{ color: active ? C.blueText : C.muted }} />
      {!collapsed && label}
    </Link>
  );

  if (!collapsed) return link;
  // Icon-only rail: surface the label as a tooltip on hover/focus (keyboard-accessible).
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The rail's inner content — shared by the desktop sidebar and the mobile drawer.
 *  When `onToggle` is provided (desktop only) a collapse button sits beside the
 *  wordmark; `collapsed` drives the icon-only compact layout. */
function SidebarContent({
  active,
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  active: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const user = useUser();
  const accountName = user.businessName ?? user.name ?? "Your business";
  const accountSub = user.email ?? "";
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: 8,
          padding: collapsed ? "8px 0" : "8px 4px",
        }}
      >
        {collapsed ? (
          <Logomark size={22} style={{ color: C.text }} />
        ) : (
          <Wordmark size={22} style={{ color: C.text }} />
        )}
        {onToggle && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="gv-nav-item"
            aria-label="Collapse sidebar"
            aria-expanded={true}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 6,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: C.muted,
              flexShrink: 0,
            }}
          >
            <PanelGlyph collapsed={false} />
          </button>
        )}
      </div>
      {collapsed && onToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="gv-nav-item"
          aria-label="Expand sidebar"
          aria-expanded={false}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 0",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: C.muted,
          }}
        >
          <PanelGlyph collapsed />
        </button>
      )}
      <nav data-tour="nav" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV_ITEMS.map(([icon, label, href]) => (
          <NavItem
            key={label}
            icon={icon}
            label={label}
            href={href}
            active={active === label}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {!collapsed && (
          <div
            data-tour="agent"
            style={{
              background: C.s2,
              borderRadius: 16,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span style={{ fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.12em", color: C.muted }}>
              AGENT
            </span>
            <span style={{ fontSize: 13, lineHeight: "18px", color: C.secondary }}>Last scan 2h ago</span>
            <span style={{ fontSize: 13, lineHeight: "18px", color: C.secondary }}>Next digest Friday</span>
          </div>
        )}
        <AccountButton collapsed={collapsed} name={accountName} sub={accountSub} />
        <LogoutButton onNavigate={onNavigate} collapsed={collapsed} />
      </div>
    </>
  );
}

/** Account switcher row. Collapsed = avatar only with the name as a tooltip. */
function AccountButton({ collapsed, name, sub }: { collapsed: boolean; name: string; sub: string }) {
  const avatarSpan = (
    <span
      style={{
        width: 32,
        height: 32,
        borderRadius: 100,
        flexShrink: 0,
        background: C.s2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: DISPLAY,
        fontSize: 12,
        fontWeight: 600,
        color: C.text,
      }}
    >
      {initialsFrom(name)}
    </span>
  );

  const button = (
    <button
      className="gv-nav-item"
      aria-label={collapsed ? name : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: 8,
        borderRadius: 8,
        border: "1px solid " + C.border,
        background: "transparent",
        cursor: "pointer",
      }}
    >
      {avatarSpan}
      {!collapsed && (
        <>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: BODY, fontSize: 13, lineHeight: "16px", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <span style={{ fontFamily: BODY, fontSize: 11, lineHeight: "14px", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sub}
            </span>
          </span>
          <Icons name="hero-chevron-down" size={14} style={{ color: C.muted }} />
        </>
      )}
    </button>
  );

  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{name}</TooltipContent>
    </Tooltip>
  );
}

/** Sign the user out and return to /login. Flask logout when configured (clears the session
 *  cookie); otherwise Supabase signOut. Graceful in demo mode: with neither configured there is
 *  no session, so it just routes to /login. */
function LogoutButton({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  const onLogout = async () => {
    setBusy(true);
    if (isFlaskConfigured()) {
      await flaskLogout();
      // Drop the cached session so the provider (and any guard) sees the user as
      // signed out immediately, not on the next hard refresh.
      await refresh();
    } else {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        await supabase.auth.signOut();
      } else {
        // Demo mode: forget the persisted typed identity so the next sign-up /
        // login starts clean rather than inheriting this business.
        clearDemoUser();
      }
    }
    onNavigate?.();
    router.push("/login");
  };

  const button = (
    <button
      type="button"
      onClick={onLogout}
      disabled={busy}
      className="gv-nav-item"
      aria-label={collapsed ? "Log out" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 8,
        width: "100%",
        textAlign: "left",
        padding: collapsed ? "10px 0" : "8px 10px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        cursor: busy ? "progress" : "pointer",
        fontFamily: BODY,
        fontSize: 13,
        lineHeight: "16px",
        color: C.muted,
      }}
    >
      {collapsed ? <LogoutGlyph /> : busy ? "Logging out…" : "Log out"}
    </button>
  );

  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">Log out</TooltipContent>
    </Tooltip>
  );
}

/** Desktop rail. Collapses from 240px to a 72px icon-only rail; the width
 *  animates unless the user prefers reduced motion. */
function Sidebar({
  active,
  collapsed,
  onToggle,
}: {
  active: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <aside
      aria-label="Primary"
      style={{
        width: collapsed ? 72 : 240,
        flexShrink: 0,
        background: C.s1,
        borderRight: "1px solid " + C.border,
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "16px 12px" : 16,
        gap: 24,
        overflow: "hidden",
        transition: reduced ? "none" : "width 200ms var(--ease-state, ease), padding 200ms var(--ease-state, ease)",
      }}
    >
      <SidebarContent active={active} collapsed={collapsed} onToggle={onToggle} />
    </aside>
  );
}

export function Chip({ children, chevron }: { children: ReactNode; chevron?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid " + C.border,
        fontFamily: BODY,
        fontSize: 13,
        lineHeight: "18px",
        color: C.secondary,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {chevron && <Icons name="hero-chevron-down" size={14} style={{ color: C.muted }} />}
    </span>
  );
}

const iconBtn: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 4,
  display: "flex",
};

const avatar: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 100,
  flexShrink: 0,
  background: C.s2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: DISPLAY,
  fontSize: 12,
  fontWeight: 600,
  color: C.text,
};

const DEFAULT_CHIPS = (
  <>
    <Chip chevron>This week</Chip>
    <Chip>3 gaps · 7 drafts</Chip>
  </>
);

/** Up-to-two-letter initials for the avatar, from the business/user name. */
function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "G";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Desktop top bar. `chips` overrides the default eyebrow chips for a screen. */
function TopBar({ title, chips }: { title: string; chips?: ReactNode }) {
  const user = useUser();
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 32px",
        borderBottom: "1px solid " + C.border,
      }}
    >
      <Link href="/opportunities" aria-label="Back to Opportunities" style={iconBtn}>
        <Icons name="chevron-left" size={18} style={{ color: C.secondary }} />
      </Link>
      <h1 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, lineHeight: "24px", color: C.text }}>
        {title}
      </h1>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {chips ?? DEFAULT_CHIPS}
        <button aria-label="Notifications" style={iconBtn}>
          <Icons name="bell" size={18} style={{ color: C.secondary }} />
        </button>
        <span style={avatar}>{initialsFrom(user.businessName ?? user.name ?? "Your business")}</span>
      </div>
    </header>
  );
}

/** Three-line hamburger glyph (no menu icon in the registry). */
function MenuGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Panel-collapse glyph (no sidebar icon in the registry). A framed panel with a
 *  divider; the chevron points in the direction the toggle will move the rail. */
function PanelGlyph({ collapsed }: { collapsed?: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d={collapsed ? "M13.5 9l3 3l-3 3" : "M16.5 9l-3 3l3 3"} />
    </svg>
  );
}

/** Sign-out glyph (no logout icon in the registry) for the collapsed rail. */
function LogoutGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
      <path d="M10 8l-4 4l4 4" />
      <path d="M6 12h11" />
    </svg>
  );
}

/** Mobile top bar — hamburger opens the drawer. The default eyebrow chips are
 *  dropped for space; a screen-specific `chips` node (e.g. a status pill) shows. */
function MobileTopBar({ title, onMenu, chips }: { title: string; onMenu: () => void; chips?: ReactNode }) {
  const user = useUser();
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid " + C.border,
        background: C.s1,
        flexShrink: 0,
      }}
    >
      <button aria-label="Open menu" onClick={onMenu} style={{ ...iconBtn, color: C.text }}>
        <MenuGlyph />
      </button>
      <h1 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, lineHeight: "22px", color: C.text, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </h1>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {chips}
        <button aria-label="Notifications" style={iconBtn}>
          <Icons name="bell" size={18} style={{ color: C.secondary }} />
        </button>
        <span style={avatar}>{initialsFrom(user.businessName ?? user.name ?? "Your business")}</span>
      </div>
    </header>
  );
}

/** Slide-in drawer holding the full rail content on mobile. */
function MobileDrawer({ open, active, onClose }: { open: boolean; active: string; onClose: () => void }) {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("gv-mnav-lock");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("gv-mnav-lock");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const transition = reduced ? "none" : "transform .25s ease, opacity .25s ease";

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(1,4,12,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition,
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "min(300px, 82vw)",
          boxSizing: "border-box",
          background: C.s1,
          borderRight: "1px solid " + C.border,
          display: "flex",
          flexDirection: "column",
          padding: 16,
          gap: 24,
          overflowY: "auto",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition,
          zIndex: 41,
        }}
      >
        <SidebarContent active={active} onNavigate={onClose} />
      </aside>
    </>
  );
}

/**
 * Dashboard layout wrapper. Desktop = rail + top bar; mobile = top bar + drawer.
 * `children` is the screen's scrollable `<main>`.
 */
export function DashboardShell({
  active,
  title,
  children,
  chips,
}: {
  active: string;
  title: string;
  children: ReactNode;
  /** Overrides the top bar's default eyebrow chips (e.g. a status pill). */
  chips?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Persisted collapse preference (external store: SSR renders expanded, the
  // client reconciles after hydration).
  const collapsed = useSidebarCollapsed();
  // While the tour runs, keep the desktop rail expanded so the nav-* steps land
  // on labeled rows (mirrors the mobile requestDrawer pattern). This is transient
  // only — it never persists, so the prior collapse state is restored the moment
  // the tour closes.
  const tour = useTour();
  const effectiveCollapsed = tour.open ? false : collapsed;

  // Auth gating now lives at the App Router layer (RequireAuth wraps each protected
  // segment's layout), sourced from the single AuthProvider — so the shell no longer
  // runs its own per-route check.

  // Suppress the landing's ambient dark glows on dashboards and paint the solid
  // canvas. Rendered as a <style> (in the initial SSR HTML) rather than a
  // post-mount class, so it applies at first paint — no dark-only glow flashes,
  // no phantom scroll height on mobile. The landing keeps its glows.
  const canvas = <style href="gv-dash-canvas" precedence="high">{DASH_CANVAS_CSS}</style>;

  if (!isMobile) {
    return (
      <TooltipProvider delayDuration={200}>
        {canvas}
        <div
          className="gv-dash"
          style={{ display: "flex", height: "100dvh", background: C.bg, color: C.text, fontFamily: BODY }}
        >
          <Sidebar active={active} collapsed={effectiveCollapsed} onToggle={toggleSidebarCollapsed} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <TopBar title={title} chips={chips} />
            {children}
          </div>
        </div>
        <Tour />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      {canvas}
      <div
        className="gv-dash"
        style={{ display: "flex", flexDirection: "column", height: "100dvh", background: C.bg, color: C.text, fontFamily: BODY }}
      >
        <MobileTopBar title={title} onMenu={() => setOpen(true)} chips={chips} />
        {children}
        <MobileDrawer open={open} active={active} onClose={() => setOpen(false)} />
      </div>
      <Tour requestDrawer={setOpen} />
    </TooltipProvider>
  );
}

/** Suppress the landing's ambient dark glows (globals.css) while a dashboard is
 *  mounted, so their tall pseudo-elements never inflate the page or bleed below
 *  the board. Light has no such glows. */
const DASH_CANVAS_CSS = `
html[data-theme="dark"] body::before,
html[data-theme="dark"] body::after,
html[data-theme="dark"]::before,
html[data-theme="dark"] #root::after{content:none!important;display:none!important}
html[data-theme="dark"],html[data-theme="dark"] body{background:var(--bg)!important}
`;

/** Shared style hook for uppercase mono eyebrows used across dashboards. */
export const MONO_EYEBROW: CSSProperties = {
  fontFamily: DISPLAY,
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: C.muted,
};
