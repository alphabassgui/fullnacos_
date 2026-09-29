// Shared helpers for route handlers: consistent JSON errors, and never leaking
// secrets or upstream internals to the browser.

import { BmoniConfigError, BmoniError } from "./bmoni/client";
import { HttpError } from "./billing/invoices";

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof BmoniConfigError) {
      console.error("[bmoni] config:", e.message);
      return json({ error: "Payments are not configured on the server yet." }, 503);
    }
    if (e instanceof BmoniError) {
      console.error(`[bmoni] ${e.method} ${e.path} -> ${e.statusCode}: ${e.message}`);
      return json({ error: "The payment provider returned an error. Please try again.", providerStatus: e.statusCode }, 502);
    }
    console.error("[api] unexpected:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong." }, 500);
  }
}

export const str = (v: unknown, max = 200) =>
  typeof v === "string" ? v.slice(0, max) : "";
