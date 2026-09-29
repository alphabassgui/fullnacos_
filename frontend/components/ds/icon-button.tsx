"use client";

import type { CSSProperties } from "react";
import { Icons, type IconName } from "./icons";

export interface IconButtonProps {
  iconName: IconName;
  /** Accessible label — required for icon-only controls. */
  label: string;
  size?: number;
  iconSize?: number;
  selected?: boolean;
  className?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

/**
 * Circular icon-only control (the `.icon-btn` family). Focus ring, hover tint, press scale and
 * selected ring all come from the ported CSS so it stays consistent with the rest of the system.
 */
export function IconButton({
  iconName,
  label,
  size = 40,
  iconSize = 18,
  selected = false,
  className = "",
  style,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected || undefined}
      className={("icon-btn " + (selected ? "is-selected " : "") + className).trim()}
      style={{
        width: size,
        height: size,
        border: "none",
        background: "transparent",
        transition: "background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur-fast) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      <Icons name={iconName} size={iconSize} />
    </button>
  );
}
