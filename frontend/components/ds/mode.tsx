"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Icons } from "./icons";
import { applyTheme, resolveTheme } from "./theme";

const SIZE = { small: 37.524, large: 44 } as const;
export type ModeState = "default" | "hovered" | "pressed" | "selected" | "disabled";

/** Theme switch button — flips data-theme on <html> and persists the choice. */
export function Mode({
  mode,
  size = "small",
  state = "default",
  onChange,
  className = "",
  style,
  ...rest
}: {
  mode?: "light" | "dark";
  size?: keyof typeof SIZE;
  state?: ModeState;
  onChange?: (next: string) => void;
  className?: string;
  style?: CSSProperties;
} & Record<string, unknown>) {
  // Start from the SSR default so the first client render matches the server HTML;
  // the actual theme is synced after mount (below), avoiding a hydration mismatch.
  const [theme, setTheme] = useState<string>(mode ?? "dark");
  useEffect(() => {
    if (mode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the optional controlled `mode` prop into local state
      setTheme(mode === "light" ? "light" : "dark");
      return;
    }
    // Uncontrolled: adopt the theme the boot script resolved, and re-apply it so
    // React Strict Mode's dev remount (which clears the attribute) doesn't drop it.
    const t = resolveTheme();
    applyTheme(t);
    setTheme(t);
  }, [mode]);
  const dim = SIZE[size] ?? SIZE.small;
  const st: CSSProperties =
    (
      {
        default: {},
        hovered: { background: "var(--surface-2)" },
        pressed: { transform: "scale(0.96)" },
        selected: { boxShadow: "inset 0 0 0 0.905px var(--primary)" },
        disabled: { opacity: 0.45, pointerEvents: "none" },
      } as Record<ModeState, CSSProperties>
    )[state] ?? {};
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next, true);
    if (onChange) onChange(next);
  };
  return (
    <button
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={flip}
      className={("icon-btn " + className).trim()}
      style={{
        width: dim,
        height: dim,
        borderRadius: 32.571,
        border: "none",
        cursor: "pointer",
        background: "var(--surface-1)",
        boxShadow: "inset 0 0 0 0.905px var(--border-strong)",
        color: "var(--text)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        transition: "background var(--dur) var(--ease), transform var(--dur-fast) var(--ease)",
        ...st,
        ...style,
      }}
      {...rest}
    >
      <Icons name={theme === "dark" ? "light-mode" : "dark-mode"} size={14} />
    </button>
  );
}
