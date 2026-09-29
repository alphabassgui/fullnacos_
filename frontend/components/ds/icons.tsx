"use client";

import type { CSSProperties } from "react";

/**
 * Icon set rendered as CSS masks tinted by `currentColor`, exactly as in the
 * landing reference. Assets live in /public/icons. Names map to those files.
 */
type IconEntry = { url: string; rotate?: number };

const LOCAL = "/icons/";

const iconRegistry: Record<string, IconEntry> = {};

// Local glyphs (Untitled UI style, exported to /public/icons as ic-<name>.svg)
[
  "api", "audit", "bell", "bolt", "builder", "chat-alerts", "chevron-left",
  "chevron-right", "cross", "dark-mode", "deploy", "facebook", "github",
  "globe", "instagram", "light-mode", "link", "linkedin", "logic",
  "placeholder", "play", "plus", "routing", "shield", "star-half",
  "star-full", "telemetry", "tick", "vital-sign", "work-flow", "x",
  "arrow-right",
].forEach((n) => {
  iconRegistry[n] = { url: `${LOCAL}ic-${n}.svg` };
});
iconRegistry["arrow-left"] = { url: `${LOCAL}ic-arrow-right.svg`, rotate: 180 };

// Heroicons-outline glyphs used inside form fields.
[
  "check", "chevron-down", "envelope", "phone", "globe-alt",
  "magnifying-glass", "credit-card", "question-mark-circle",
].forEach((n) => {
  iconRegistry[`hero-${n}`] = { url: `${LOCAL}hero-${n}.svg` };
});

// Lucide status glyphs.
Object.assign(iconRegistry, {
  "alert-circle": { url: `${LOCAL}lu-circle-alert.svg` },
  "alert-triangle": { url: `${LOCAL}lu-triangle-alert.svg` },
  "check-circle": { url: `${LOCAL}lu-circle-check.svg` },
  circle: { url: `${LOCAL}lu-circle.svg` },
  "help-circle": { url: `${LOCAL}lu-circle-help.svg` },
  zap: { url: `${LOCAL}lu-zap.svg` },
  timelapse: { url: `${LOCAL}lu-timer.svg` },
});

export const ICON_NAMES = Object.keys(iconRegistry);

export type IconName = string;

export interface IconsProps {
  name?: IconName;
  size?: number;
  title?: string;
  style?: CSSProperties;
  className?: string;
}

export function Icons({ name = "placeholder", size = 20, title, style, className }: IconsProps) {
  const entry = iconRegistry[name] || iconRegistry.placeholder;
  return (
    <span
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flexShrink: 0,
        background: "currentColor",
        WebkitMaskImage: `url("${entry.url}")`,
        maskImage: `url("${entry.url}")`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        transform: entry.rotate ? `rotate(${entry.rotate}deg)` : undefined,
        ...style,
      }}
    />
  );
}
