"use client";

import type { CSSProperties, ReactNode } from "react";

export type CardVariant = "elevated" | "accent" | "interactive" | "plain";

export interface CardProps {
  /** elevated = premium lift; accent = focal card; interactive = hover/press affordance. */
  variant?: CardVariant;
  as?: "div" | "article" | "section";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  [key: string]: unknown;
}

/**
 * Base surface used across the landing (and reusable by dashboards). Styling lives in the
 * ported CSS classes: `.card-elevated`, `.card-accent`, `.card--interactive`. Dark lifts via a
 * lighter gradient fill; light lifts via warm shadow on a sunken section — never mixed.
 */
export function Card({ variant = "elevated", as: Tag = "div", className = "", style, children, ...rest }: CardProps) {
  const variantClass =
    variant === "elevated"
      ? "card-elevated"
      : variant === "accent"
      ? "card-elevated card-accent"
      : variant === "interactive"
      ? "card--interactive"
      : "";
  return (
    <Tag className={(variantClass + " " + className).trim()} style={style} {...rest}>
      {children}
    </Tag>
  );
}
