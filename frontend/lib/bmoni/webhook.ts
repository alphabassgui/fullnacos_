// Webhook signature check. X-Webhook-Signature = hex HMAC-SHA256 of the RAW
// request body keyed with the config's secretKey. Compare in constant time.
// https://embedded-docs.bmoni.com/api-reference/webhooks/

import crypto from "node:crypto";

export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signatureHeader ?? "";
  // Length check first: timingSafeEqual throws on a length mismatch.
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}

/** "250.00" -> 25000. String maths only, no floats. Returns null if not a plain decimal. */
export function decimalToKobo(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const m = /^(\d+)(?:\.(\d{1,}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  // more than 2 decimals: only accept if the extra digits are zeros
  if (/[1-9]/.test(frac.slice(2))) return null;
  return Number(m[1]) * 100 + Number(frac.slice(0, 2));
}
