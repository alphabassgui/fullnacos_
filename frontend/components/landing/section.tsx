"use client";

import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ds";

export function Section({
  children,
  style,
  ...rest
}: { children?: ReactNode; style?: CSSProperties } & Record<string, unknown>) {
  return (
    <section style={{ borderTop: "1px solid var(--border)", padding: "120px var(--gutter)", ...style }} {...rest}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  line1,
  accent,
  line2,
  description,
  eyebrowStyle,
}: {
  eyebrow: ReactNode;
  line1: ReactNode;
  accent?: ReactNode;
  line2?: string;
  description?: ReactNode;
  eyebrowStyle?: CSSProperties;
  align?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 80, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 56 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 560 }}>
        <Badge dot={false} style={{ alignSelf: "flex-start", ...eyebrowStyle }}>
          {eyebrow}
        </Badge>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "var(--text-h2)",
            lineHeight: "var(--lh-h2)",
            letterSpacing: "var(--track-h2)",
            color: "var(--text)",
          }}
        >
          {line1}{" "}
          {accent && (
            <em
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontWeight: 400,
                color: "var(--accent-text)",
                letterSpacing: "var(--track-serif-h2)",
              }}
            >
              {accent}
            </em>
          )}
          {line2 ? " " + line2 : ""}
        </h2>
      </div>
      {description && (
        <p
          style={{
            flex: 1,
            minWidth: 280,
            margin: 0,
            fontSize: "var(--text-body-md)",
            lineHeight: "var(--lh-body-md)",
            letterSpacing: "var(--track-body)",
            color: "var(--text-secondary)",
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
