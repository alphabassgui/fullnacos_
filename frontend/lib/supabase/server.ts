/**
 * Supabase server client (cookie-based sessions, @supabase/ssr).
 *
 * For Server Components / Route Handlers. Returns null when Supabase env is
 * absent (demo mode) so callers can fall back gracefully. Session refreshes
 * are written back through the cookie store; when called from a Server
 * Component (where cookies cannot be set) the write is a no-op and the proxy
 * (proxy.ts) is responsible for refreshing the session instead.
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/** A per-request server client, or null in demo mode (env not configured). */
export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — cookies are read-only here.
          // The proxy refreshes the session, so this can be safely ignored.
        }
      },
    },
  });
}
