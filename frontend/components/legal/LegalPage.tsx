import type { ReactNode } from "react";

/** Shared container for long-form legal pages. Readable measure, ~380px-safe gutters,
 *  theme-aware via CSS vars. Typography for child elements lives in the `.gv-legal` block. */
export function LegalPage({ children }: { children: ReactNode }) {
  return (
    <main className="gv-legal" style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>
      <article style={{ maxWidth: 720, margin: "0 auto", padding: "96px 24px 120px" }}>{children}</article>
    </main>
  );
}
