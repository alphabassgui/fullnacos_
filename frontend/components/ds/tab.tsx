"use client";

import type { CSSProperties, ReactNode } from "react";

export type TabState = "default" | "hovered" | "selected" | "disabled";

/** Segmented tab control — the source's `Tab Button` (4 states x dark/light mode). */
export function TabButton({
  children = "Overview",
  state = "default",
  mode = "dark",
  className = "",
  style,
  ...rest
}: { children?: ReactNode; state?: TabState; mode?: "dark" | "light"; className?: string; style?: CSSProperties } & Record<string, unknown>) {
  const selected = state === "selected";
  const st: CSSProperties =
    (
      {
        default: { background: "transparent", color: "var(--text-secondary)" },
        hovered: { background: "var(--surface-1)", color: "var(--text)" },
        selected: { background: "var(--primary)", color: "var(--text-on-primary)", boxShadow: "var(--shadow-primary-glow)" },
        disabled: { background: "transparent", color: "var(--text-muted)", opacity: 0.5, pointerEvents: "none" },
      } as Record<TabState, CSSProperties>
    )[state] ?? {};
  return (
    <button
      aria-pressed={selected}
      data-mode={mode}
      className={("tab " + (selected ? "is-selected " : "") + className).trim()}
      aria-disabled={state === "disabled" ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 36,
        padding: "8px 16px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "20px",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        transition: "background var(--dur) var(--ease), color var(--dur) var(--ease)",
        ...st,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
