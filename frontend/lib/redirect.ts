/**
 * Safe internal redirect targets.
 *
 * The pricing → auth → checkout funnel carries the intended destination as a
 * `callbackUrl` query param through /login and /signup. Only same-origin,
 * relative paths are ever honored: a value must start with a single "/" (not
 * "//" or "/\", which browsers treat as protocol-relative and resolve to
 * another origin). This keeps a crafted `?callbackUrl=https://evil.example`
 * from turning a login into an open redirect. Anything else falls back to the
 * caller's default.
 */

/** True when `value` is a safe, same-origin, relative path (e.g. "/pay?tier=growth"). */
export function isInternalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

/** The value when it is a safe internal path, otherwise the fallback. */
export function safeInternalPath(value: unknown, fallback: string): string {
  return isInternalPath(value) ? value : fallback;
}
