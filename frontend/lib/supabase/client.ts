/**
 * Supabase browser client (cookie-based sessions, @supabase/ssr).
 *
 * Returns null when Supabase env is absent so the demo still runs and the build
 * never crashes — callers must handle null (fall back to the demo behavior).
 * A single client instance is reused across calls in the browser.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

let client: SupabaseClient | null = null;

/** The shared browser client, or null in demo mode (env not configured). */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createBrowserClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string);
  }
  return client;
}
