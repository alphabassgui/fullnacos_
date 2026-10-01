import type { Metadata } from "next";
import { AuthScreen } from "@/components/app/Auth";
import { safeInternalPath } from "@/lib/redirect";

export const metadata: Metadata = {
  title: "Log in · Groville",
  description:
    "Log back in to Groville, your AI growth agent, and pick up where you left off with the gaps and campaign drafts waiting for your approval.",
};

/**
 * Reads the `callbackUrl` query param (Next 16 `searchParams` is a Promise) and
 * hands the validated internal path to the client screen, which redirects there
 * after a successful log in instead of the default dashboard. Reading it here
 * avoids a `useSearchParams` Suspense boundary in the client tree (matching
 * app/campaign-draft/page.tsx).
 */
export default async function LogInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { callbackUrl } = await searchParams;
  const raw = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  const callback = safeInternalPath(raw, "") || undefined;
  return <AuthScreen mode="login" callbackUrl={callback} />;
}
