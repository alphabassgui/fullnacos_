import type { Metadata } from "next";
import { AuthScreen } from "@/components/app/Auth";
import { safeInternalPath } from "@/lib/redirect";

export const metadata: Metadata = {
  title: "Sign up · Groville",
  description:
    "Start free with Groville, your AI growth agent. Connect your site and see the customers you are missing in under ten minutes. Read-only access, Groville drafts and you approve every move.",
};

/**
 * Reads the `callbackUrl` query param (Next 16 `searchParams` is a Promise) and
 * hands the validated internal path to the client screen, which redirects there
 * after a successful sign up (e.g. straight to /pay when the user chose a paid
 * tier) instead of the default welcome flow. Reading it here avoids a
 * `useSearchParams` Suspense boundary (matching app/campaign-draft/page.tsx).
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { callbackUrl } = await searchParams;
  const raw = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  const callback = safeInternalPath(raw, "") || undefined;
  return <AuthScreen mode="signup" callbackUrl={callback} />;
}
