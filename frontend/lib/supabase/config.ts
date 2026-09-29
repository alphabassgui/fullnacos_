/**
 * Supabase env config — the single source for the public Supabase settings.
 *
 * These are the ONLY two Supabase values the frontend reads, both public
 * (browser-safe) by design: the project URL and the anon key. They are wired as
 * NEXT_PUBLIC_* so Next inlines them for the browser client. There is NO
 * service-role key here or anywhere in frontend code — that key is server-only
 * and must never ship to the browser.
 *
 * Everything is guarded so a build with no env (e.g. the cloud CI, which has no
 * keys) never crashes: values are read as plain strings-or-undefined and
 * isSupabaseConfigured() gates real auth. When it returns false the app runs in
 * demo mode (mock "Ada" from lib/demo-user.ts) with no gating.
 */

import { isFlaskConfigured } from "../api";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True only when Supabase is the active auth path: both public vars are present AND
 * Flask is NOT configured. Flask takes precedence (it is the real auth path; Supabase
 * is only the demo fallback), so when NEXT_PUBLIC_API_BASE is set every Supabase client
 * stands down — no browser/server client is ever constructed, matching the middleware's
 * documented behavior and preventing a partial Supabase env from crashing Flask mode.
 */
export function isSupabaseConfigured(): boolean {
  if (isFlaskConfigured()) return false;
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
