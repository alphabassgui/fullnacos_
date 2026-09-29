/**
 * Proxy (Next.js 16's renamed middleware convention — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 *
 * Runs before rendering to refresh the Supabase session and gate the
 * authenticated areas. In demo mode (no Supabase env) updateSession() is a
 * no-op, so this is safe to ship without keys.
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every request except:
     * - _next/static, _next/image (build assets)
     * - favicon.ico and static image files (also covers /images/* .webp assets)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
