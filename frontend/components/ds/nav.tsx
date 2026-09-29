"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Wordmark } from "./brand";
import { Navlink } from "./navlink";
import { Mode } from "./mode";
import { ButtonGroup } from "./button";

const DEFAULT_LINKS = ["Platform", "Benchmarks", "Customers", "FAQ", "Pricing"];

export interface NavDarkProps {
  links?: string[];
  active?: string;
  cta?: string;
  ctaHref?: string;
  loginHref?: string;
  linkHrefs?: string[];
  onLinkClick?: (e: React.MouseEvent, label: string, href: string) => void;
  variant?: "desktop" | "mobile";
  style?: CSSProperties;
  [key: string]: unknown;
}

/** Floating glass nav (dark theme) — 1200x70, 36px radius, blur(20px). */
export function NavDark({
  links = DEFAULT_LINKS,
  active = "Platform",
  cta = "Start free",
  ctaHref,
  loginHref = "/login",
  linkHrefs,
  onLinkClick,
  variant = "desktop",
  style,
  ...rest
}: NavDarkProps) {
  const compact = variant === "mobile";
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        maxWidth: 1200,
        height: 70,
        padding: "12px 24px",
        boxSizing: "border-box",
        borderRadius: 36,
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: "none",
        boxShadow: "var(--shadow-inset-rim), var(--shadow-float)",
        ...style,
      }}
      {...rest}
    >
      <Wordmark size={22} />
      {!compact && (
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {links.map((l, i) => (
            <Navlink
              key={l}
              href={(linkHrefs && linkHrefs[i]) || "#"}
              onClick={onLinkClick && ((e: React.MouseEvent) => onLinkClick(e, l, (linkHrefs && linkHrefs[i]) || "#"))}
              state={l === active ? "active" : "default"}
            >
              {l}
            </Navlink>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Mode />
        {!compact && (
          <Link
            href={loginHref}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--text-secondary)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Log in
          </Link>
        )}
        {!compact && (
          <ButtonGroup size="small" showIcon={false} href={ctaHref}>
            {cta}
          </ButtonGroup>
        )}
      </div>
    </nav>
  );
}
