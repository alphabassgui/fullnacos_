"use client";

import type { CSSProperties } from "react";
import { Icons, type IconName } from "./icons";

const CORNERS = { sharp: 0, smooth: 8, rounded: 16, pill: 999 } as const;

export interface InputFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  type?: "regular" | "plain" | "phone" | "search" | "select";
  corners?: keyof typeof CORNERS;
  addon?: "none" | "leading" | "trailing";
  addonText?: string;
  state?: "default" | "active" | "hovered" | "filled" | "disabled" | "readonly";
  feedback?: "none" | "error" | "success";
  hint?: string;
  iconName?: IconName;
  style?: CSSProperties;
  [key: string]: unknown;
}

/** Text input with label, addon, icon and feedback — the source's `Input field` set. */
export function InputField({
  label = "Email",
  placeholder = "you@company.com",
  value,
  type = "regular",
  corners = "smooth",
  addon = "none",
  addonText = "https://",
  state = "default",
  feedback = "none",
  hint = "We only use this to send your report.",
  iconName = "hero-envelope",
  style,
  ...rest
}: InputFieldProps) {
  const radius = CORNERS[corners] ?? 8;
  const tone = feedback === "error" ? "var(--error)" : feedback === "success" ? "var(--success)" : null;
  const ring =
    (
      {
        default: "inset 0 0 0 1px var(--border)",
        active: "inset 0 0 0 1px var(--primary), var(--ring-focus)",
        hovered: "inset 0 0 0 1px var(--border-strong)",
        filled: "inset 0 0 0 1px var(--border-strong)",
        disabled: "inset 0 0 0 1px var(--border)",
        readonly: "inset 0 0 0 1px var(--border)",
      } as Record<string, string>
    )[state] ?? "inset 0 0 0 1px var(--border)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 320, ...style }} {...rest}>
      {label && (
        <label style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: 14, lineHeight: "20px", color: "var(--text-secondary)" }}>
          {label}
        </label>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 44,
          padding: "10px 14px",
          boxSizing: "border-box",
          borderRadius: radius,
          background: "var(--surface-1)",
          boxShadow: tone ? "inset 0 0 0 1px " + tone : ring,
          opacity: state === "disabled" ? 0.55 : 1,
        }}
      >
        {addon === "leading" && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>{addonText}</span>
        )}
        {type !== "plain" && (
          <Icons
            name={type === "phone" ? "hero-phone" : type === "search" ? "hero-magnifying-glass" : iconName}
            size={20}
            style={{ color: "var(--text-muted)" }}
          />
        )}
        <input
          readOnly={state === "readonly"}
          disabled={state === "disabled"}
          defaultValue={value}
          placeholder={placeholder}
          style={{
            flexGrow: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "var(--font-body)",
            fontWeight: 400,
            fontSize: 16,
            lineHeight: "24px",
            color: "var(--text)",
          }}
        />
        {type === "select" && <Icons name="hero-chevron-down" size={20} style={{ color: "var(--text-muted)" }} />}
        {addon === "trailing" && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>{addonText}</span>
        )}
      </div>
      {hint && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-body)",
            fontSize: 14,
            lineHeight: "20px",
            color: tone || "var(--text-muted)",
          }}
        >
          <Icons name={feedback === "error" ? "alert-circle" : feedback === "success" ? "check-circle" : "hero-question-mark-circle"} size={14} />
          {hint}
        </span>
      )}
    </div>
  );
}
