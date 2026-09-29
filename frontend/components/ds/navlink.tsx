"use client";

import type { CSSProperties, ReactNode } from "react";

export type NavlinkState = "default" | "hovered" | "active" | "focused" | "disabled";

/** Nav item — 5 states, animated/persistent underline via the `.navlink` class. */
export function Navlink({
  children = "Platform",
  state = "default",
  href = "#",
  className = "",
  style,
  ...rest
}: { children?: ReactNode; state?: NavlinkState; href?: string; className?: string; style?: CSSProperties } & Record<string, unknown>) {
  const st: CSSProperties =
    (
      {
        default: { color: "var(--nav-inactive)" },
        hovered: { color: "var(--text)" },
        active: { color: "var(--text)", borderBottom: "2px solid var(--nav-indicator)" },
        focused: { color: "var(--text)", boxShadow: "var(--ring-focus)" },
        disabled: { color: "var(--text-muted)", opacity: 0.6, pointerEvents: "none" },
      } as Record<NavlinkState, CSSProperties>
    )[state] ?? {};
  return (
    <a
      href={href}
      className={("navlink " + (state === "active" ? "is-active " : "") + className).trim()}
      aria-current={state === "active" ? "true" : undefined}
      aria-disabled={state === "disabled" ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 24,
        padding: "0 2px",
        borderRadius: 8,
        borderBottom: "2px solid transparent",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "24px",
        letterSpacing: "-0.64px",
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "color var(--dur) var(--ease), border-color var(--dur) var(--ease)",
        ...st,
        ...style,
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
