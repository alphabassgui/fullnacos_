"use client";

import type { CSSProperties, ReactNode } from "react";

const DOT_SIZES = { sm: 6, md: 8, lg: 10 } as const;

export function Dot({
  size = "md",
  color = "var(--primary)",
  style,
  ...rest
}: { size?: keyof typeof DOT_SIZES; color?: string; style?: CSSProperties } & Record<string, unknown>) {
  const d = DOT_SIZES[size] ?? DOT_SIZES.md;
  return (
    <span
      aria-hidden="true"
      style={{ width: d, height: d, borderRadius: 100, background: color, flexShrink: 0, display: "inline-block", ...style }}
      {...rest}
    />
  );
}

/** Tagline pill: 35px tall, 36px radius, flat fill + hairline ring + soft shadow. */
export function Badge({
  children = "AI-Native Automation Platform",
  dot = true,
  style,
  ...rest
}: { children?: ReactNode; dot?: boolean; style?: CSSProperties } & Record<string, unknown>) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 35,
        boxSizing: "border-box",
        padding: "8px 16px",
        borderRadius: 36,
        background: "var(--primary-soft)",
        boxShadow: "0 0 0 0.5px var(--blue-900), 0 1px 2px 0 rgba(6,12,28,0.28)",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 12,
        lineHeight: "18px",
        letterSpacing: "0.64px",
        color: "var(--text)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {dot && <Dot size="md" />}
      {children}
    </span>
  );
}
