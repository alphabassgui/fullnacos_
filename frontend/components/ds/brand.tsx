"use client";

import type { CSSProperties, SVGProps } from "react";

/** The Groville mark: two woven diamond outlines (from the LOGOMARK SYSTEM artwork). */
export function Logomark({
  size = 24,
  style,
  ...rest
}: { size?: number; style?: CSSProperties } & Omit<SVGProps<SVGSVGElement>, "style">) {
  return (
    <svg
      viewBox="0 0 85.02 131.75"
      width={size * 0.645}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="8.647"
      strokeLinejoin="miter"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
      {...rest}
    >
      <path d="M 42.59 4.32 L 80.70 42.58 L 42.59 80.84 L 4.32 42.58 Z" />
      <path d="M 42.59 51.07 L 80.70 89.33 L 42.59 127.43 L 4.32 89.33 Z" />
    </svg>
  );
}

/** Horizontal lockup: mark plus the Groville wordmark set in the display face. */
export function Wordmark({
  size = 22,
  showMark = true,
  style,
  ...rest
}: { size?: number; showMark?: boolean; style?: CSSProperties } & Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "style"
>) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text)", ...style }}
      {...rest}
    >
      {showMark && <Logomark size={size} />}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: size * 0.82,
          letterSpacing: "-0.6px",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        Groville
      </span>
    </span>
  );
}

/** Square app-icon lockup: the mark on a blue gradient tile. */
export function AppIcon({
  size = 44,
  radius,
  style,
  ...rest
}: { size?: number; radius?: number; style?: CSSProperties } & Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "style"
>) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.27),
        background: "var(--gradient-primary)",
        color: "var(--text-on-primary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 0 12px rgba(24,93,241,0.25)",
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      <Logomark size={size * 0.62} />
    </span>
  );
}
