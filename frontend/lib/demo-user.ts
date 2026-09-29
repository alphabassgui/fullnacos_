/**
 * Demo user data layer (the fallback identity).
 *
 * Real email/password auth is wired via Supabase (see lib/supabase/*), but the
 * demo loop must keep running when no Supabase keys are configured. This module
 * holds the mock owner — Ada Osei of Ada's Bakery, the business behind the locked
 * demo numbers (see components/landing/VoiceCarousel.tsx) — used as that fallback.
 *
 * The ONE place that resolves the CURRENT user for the UI is useUser()
 * (lib/use-user.ts): it returns the real signed-in Supabase user when auth is
 * configured, and otherwise falls back to getDemoUser() below. Screens (Welcome,
 * /pay checkout) read through useUser(), never a hardcoded name, so the display
 * name and prefill stay in one seam. getDemoUser() / welcomeGreeting() keep their
 * shape so the fallback path is unchanged.
 *
 * (Separate future task: connecting the Supabase user to the teammate's Flask
 * agent API via its session cookie — not done here.)
 */

export type DemoUser = {
  /** The user's name for greetings; null when we don't have one yet. */
  name: string | null;
  /** Work email, used to prefill checkout; null when unknown. */
  email?: string | null;
  /** Business name, used to prefill checkout; null when unknown. */
  businessName?: string | null;
};

/** The mock signed-up user for the demo loop. First name only, for a natural greeting. */
export function getDemoUser(): DemoUser {
  return { name: "Ada", email: "ada@adasbakery.com", businessName: "Ada's Bakery" };
}

/** Personalized welcome line, with a graceful fallback when no name exists. */
export function welcomeGreeting(user: DemoUser): string {
  return user.name ? `Welcome, ${user.name}` : "Welcome to Groville";
}
