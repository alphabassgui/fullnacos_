"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icons, type IconName } from "./icons";
import { Dot } from "./badge";

export type ButtonSize = "sm" | "md" | "lg" | "xl" | "2xl";

export const BUTTON_SIZES: Record<ButtonSize, { padding: string; fontSize: number; lineHeight: string; gap: number; icon: number }> = {
  sm: { padding: "8px 14px", fontSize: 14, lineHeight: "20px", gap: 4, icon: 20 },
  md: { padding: "10px 16px", fontSize: 14, lineHeight: "20px", gap: 8, icon: 20 },
  lg: { padding: "10px 18px", fontSize: 16, lineHeight: "24px", gap: 8, icon: 20 },
  xl: { padding: "12px 20px", fontSize: 16, lineHeight: "24px", gap: 8, icon: 20 },
  "2xl": { padding: "16px 28px", fontSize: 18, lineHeight: "28px", gap: 12, icon: 24 },
};

type BaseProps = {
  size?: ButtonSize;
  as?: "button" | "a";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>;

/** Layout shell shared by every button hierarchy — the source's `_Button base`. */
export function ButtonBase({ size = "md", as: Tag = "button", className = "", style, children, ...rest }: BaseProps) {
  const s = BUTTON_SIZES[size] ?? BUTTON_SIZES.md;
  return (
    <Tag
      className={("btn " + className).trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        padding: s.padding,
        borderRadius: 8,
        border: "none",
        background: "none",
        cursor: "pointer",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        transition: "background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), color var(--dur) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export type ButtonHierarchy =
  | "primary"
  | "secondary color"
  | "secondary gray"
  | "tertiary color"
  | "tertiary gray"
  | "link color"
  | "link gray";

type HierarchyStyle = { background: string; color: string; hover: string; boxShadow?: string; padding?: number };

const HIERARCHY: Record<ButtonHierarchy, HierarchyStyle> = {
  primary: { background: "var(--primary)", color: "var(--text-on-primary)", hover: "var(--primary-hover)" },
  "secondary color": { background: "var(--primary-soft)", color: "var(--accent-text)", boxShadow: "inset 0 0 0 1px var(--primary)", hover: "var(--surface-2)" },
  "secondary gray": { background: "var(--surface-1)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--border-strong)", hover: "var(--surface-2)" },
  "tertiary color": { background: "transparent", color: "var(--accent-text)", hover: "var(--primary-soft)" },
  "tertiary gray": { background: "transparent", color: "var(--text-secondary)", hover: "var(--surface-1)" },
  "link color": { background: "transparent", color: "var(--accent-text)", padding: 0, hover: "transparent" },
  "link gray": { background: "transparent", color: "var(--text-secondary)", padding: 0, hover: "transparent" },
};

export type ButtonState = "default" | "hover" | "focused" | "disabled";

export interface ButtonProps {
  children?: ReactNode;
  size?: ButtonSize;
  hierarchy?: ButtonHierarchy;
  icon?: "false" | "leading" | "trailing" | "only" | "dot";
  iconName?: IconName;
  destructive?: boolean;
  state?: ButtonState;
  className?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

/** The full Button family: 5 sizes x 7 hierarchies x icon placement x destructive x state. */
export function Button({
  children = "Button CTA",
  size = "md",
  hierarchy = "primary",
  icon = "false",
  iconName = "arrow-right",
  destructive = false,
  state = "default",
  className = "",
  style,
  ...rest
}: ButtonProps) {
  const h = HIERARCHY[hierarchy] ?? HIERARCHY.primary;
  const s = BUTTON_SIZES[size] ?? BUTTON_SIZES.md;
  const isLink = hierarchy.startsWith("link");
  const base: CSSProperties = {
    background: destructive && hierarchy === "primary" ? "var(--error)" : h.background,
    color: destructive ? (hierarchy === "primary" ? "#fff" : "var(--error)") : h.color,
    boxShadow: h.boxShadow,
  };
  const byState: CSSProperties =
    (
      {
        default: {},
        hover: { background: h.hover, filter: isLink ? "brightness(1.15)" : undefined },
        focused: {
          boxShadow: [h.boxShadow, destructive ? "0 0 0 4px rgba(229,72,77,0.24)" : "var(--ring-focus)"]
            .filter(Boolean)
            .join(", "),
        },
        disabled: { opacity: 0.45, cursor: "not-allowed", pointerEvents: "none" },
      } as Record<ButtonState, CSSProperties>
    )[state] ?? {};
  const variant =
    hierarchy === "primary"
      ? "btn--primary"
      : hierarchy.startsWith("secondary")
      ? "btn--secondary"
      : hierarchy.startsWith("tertiary")
      ? "btn--ghost is-neutral"
      : "btn--ghost";
  const glyph = <Icons name={iconName} size={s.icon} style={{ flexShrink: 0 }} />;
  return (
    <ButtonBase
      size={size}
      className={(variant + " " + className).trim()}
      aria-disabled={state === "disabled" ? "true" : undefined}
      style={{ ...base, ...(isLink ? { padding: 0 } : null), ...byState, ...style }}
      {...rest}
    >
      {icon === "leading" && glyph}
      {icon === "dot" && <Dot size="md" color="currentColor" />}
      {icon !== "only" && children}
      {icon === "only" && glyph}
      {icon === "trailing" && glyph}
    </ButtonBase>
  );
}

export type ButtonGroupSize = "small" | "medium" | "large" | "desktop";

const GROUP_SIZE: Record<ButtonGroupSize, { height: number; padding: string; fontSize: number }> = {
  small: { height: 36, padding: "8px 14px", fontSize: 14 },
  medium: { height: 44, padding: "12px 16px", fontSize: 14 },
  large: { height: 48, padding: "12px 20px", fontSize: 16 },
  desktop: { height: 44, padding: "12px 16px", fontSize: 14 },
};

export type GroupState = "default" | "hovered" | "pressed" | "focused" | "disabled";

export interface ButtonGroupProps {
  children?: ReactNode;
  size?: ButtonGroupSize;
  iconName?: IconName;
  showIcon?: boolean;
  state?: GroupState;
  href?: string;
  className?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

/** Gradient primary CTA used in heroes and CTA bands — the source's `Button Group`. */
export function ButtonGroup({
  children = "Start Free",
  size = "medium",
  iconName = "arrow-right",
  showIcon = true,
  state = "default",
  href,
  className = "",
  style,
  ...rest
}: ButtonGroupProps) {
  const s = GROUP_SIZE[size] ?? GROUP_SIZE.medium;
  const st: CSSProperties =
    (
      {
        default: {},
        hovered: { filter: "brightness(1.08)" },
        pressed: { filter: "brightness(0.94)", transform: "translateY(1px)" },
        focused: { boxShadow: "var(--ring-focus)" },
        disabled: { opacity: 0.45, pointerEvents: "none" },
      } as Record<GroupState, CSSProperties>
    )[state] ?? {};
  const shared = {
    className: ("btn btn--cta " + className).trim(),
    "aria-disabled": state === "disabled" ? ("true" as const) : undefined,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: s.height,
      padding: s.padding,
      borderRadius: 8,
      border: "none",
      cursor: "pointer",
      background: "var(--gradient-primary)",
      color: "var(--text-on-primary)",
      boxShadow: "var(--shadow-primary-glow)",
      fontFamily: "var(--font-body)",
      fontWeight: 500,
      fontSize: s.fontSize,
      lineHeight: "20px",
      whiteSpace: "nowrap",
      boxSizing: "border-box",
      textDecoration: "none",
      transition: "filter var(--dur) var(--ease), transform var(--dur-fast) var(--ease)",
      ...st,
      ...style,
    } as CSSProperties,
    ...rest,
  };
  const inner = (
    <>
      {children}
      {showIcon && <Icons name={iconName} size={16} />}
    </>
  );
  // Internal navigation routes through next/link; without an href this stays a plain button.
  return href ? (
    <Link href={href} {...shared}>
      {inner}
    </Link>
  ) : (
    <button {...shared}>{inner}</button>
  );
}

export type ContainerState = "default" | "hovered" | "pressed" | "focused" | "disabled";

export interface ButtonContainerProps {
  children?: ReactNode;
  iconName?: IconName;
  state?: ContainerState;
  className?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

/** Outlined secondary action with a leading icon chip — the source's `Button Container`. */
export function ButtonContainer({
  children = "Watch the 90-second demo",
  iconName = "play",
  state = "default",
  className = "",
  style,
  ...rest
}: ButtonContainerProps) {
  const st: CSSProperties =
    (
      {
        default: {},
        hovered: { background: "var(--surface-1)" },
        pressed: { background: "var(--surface-2)", transform: "translateY(1px)" },
        focused: { boxShadow: "inset 0 0 0 1px var(--border-strong), var(--ring-focus)" },
        disabled: { opacity: 0.45, pointerEvents: "none" },
      } as Record<ContainerState, CSSProperties>
    )[state] ?? {};
  return (
    <button
      className={className || undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 44,
        padding: "8px 16px 8px 8px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        background: "var(--bg)",
        boxShadow: "inset 0 0 0 1px var(--border-strong)",
        color: "var(--text)",
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 14,
        lineHeight: "20px",
        boxSizing: "border-box",
        transition: "background var(--dur) var(--ease)",
        ...st,
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: "var(--text)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icons name={iconName} size={14} style={{ color: "var(--bg)" }} />
      </span>
      {children}
    </button>
  );
}
