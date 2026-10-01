"use client";

/**
 * useUser — the ONE place that resolves the current user for the UI.
 *
 * Resolution order:
 *   1. Flask (real auth) — when NEXT_PUBLIC_API_BASE is set, read the signed-in
 *      user from GET /api/auth/me (username + email). This is the real-data path.
 *   2. Supabase — when Flask is not configured but Supabase is, read the
 *      Supabase auth user (kept only as the demo-mode fallback, per PR #16).
 *   3. Demo — when neither is configured, fall back to the mock "Ada" demo user
 *      (lib/demo-user.ts) so the demo loop still runs.
 *
 * In Flask mode it initializes to a neutral (nameless) user so there is no
 * flash of "Ada" before /api/auth/me resolves; in demo/Supabase mode it
 * initializes to the demo user synchronously so demo mode has no flash.
 */

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getDemoUser, useDemoIdentity, type DemoUser } from "@/lib/demo-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getMe, isFlaskConfigured } from "@/lib/api";

/** Map a Supabase auth user onto the app's DemoUser shape (metadata is set at sign up). */
function fromSupabaseUser(user: User): DemoUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const businessName = typeof meta.business_name === "string" ? meta.business_name : null;
  const fullName = typeof meta.full_name === "string" ? meta.full_name : null;
  const emailName = user.email ? user.email.split("@")[0] : null;
  return {
    // Prefer a real name, then the business name, then the email handle.
    name: fullName ?? businessName ?? emailName,
    email: user.email ?? null,
    businessName,
  };
}

export function useUser(): DemoUser {
  // Pure demo mode (no Flask, no Supabase): the identity comes from the external
  // demo-identity store, which serves the typed sign-up details when persisted and
  // the "Ada" mock otherwise — SSR-stable, so no hydration mismatch.
  const flask = isFlaskConfigured();
  const demoMode = !flask && !isSupabaseConfigured();
  const demoUser = useDemoIdentity();

  // In Flask mode start neutral (no "Ada" flash); otherwise start from the demo user.
  const [user, setUser] = useState<DemoUser>(() =>
    flask ? { name: null, email: null, businessName: null } : getDemoUser(),
  );

  useEffect(() => {
    // Real auth path: resolve the signed-in user from Flask's session cookie.
    if (isFlaskConfigured()) {
      let active = true;
      getMe().then((flaskUser) => {
        // businessName stays null here — the business record is a later task.
        if (active && flaskUser) {
          setUser({ name: flaskUser.username, email: flaskUser.email, businessName: null });
        }
      });
      return () => {
        active = false;
      };
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return; // demo mode: identity is served by useDemoIdentity above

    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) setUser(fromSupabaseUser(data.user));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ? fromSupabaseUser(session.user) : getDemoUser());
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return demoMode ? demoUser : user;
}
