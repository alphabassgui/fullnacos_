/**
 * Session refresh + route gating for the proxy (proxy.ts), following the
 * official @supabase/ssr App Router pattern.
 *
 * updateSession() refreshes the auth session on every matched request (so a
 * logged-in user's tokens stay fresh) and redirects unauthenticated users away
 * from the protected areas to /login.
 *
 * DEMO SAFETY: when Supabase env is absent the app is in demo mode — this
 * returns immediately without gating anything, so the mock "Ada" demo loop
 * keeps working. Real auth (and gating) only turns on when the keys are present.
 *
 * FLASK TAKES PRECEDENCE: when NEXT_PUBLIC_API_BASE is set, Flask is the real
 * auth path and its session cookie is HttpOnly on the backend's own origin —
 * this server never sees it, so a Supabase check here would wrongly bounce a
 * Flask-authenticated user off every protected route. In that case this stands
 * down entirely; gating is done client-side (lib/use-auth-gate.ts) instead.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import { isProtectedPath } from "../protected-routes";
import { isFlaskConfigured } from "../api";

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Flask is the real auth path → the client gate handles it; do not gate here.
  if (isFlaskConfigured()) return response;

  // Demo mode: no keys → do not refresh or gate anything.
  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: getUser() runs before any redirect so a token refresh is written
  // back to the response cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    // Carry any cookies refreshed during getUser() onto the redirect, so a
    // token rotation is not lost (documented @supabase/ssr pitfall).
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
