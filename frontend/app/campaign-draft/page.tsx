import type { Metadata } from "next";
import { CampaignDraftScreen } from "@/components/app/CampaignDraft";

export const metadata: Metadata = {
  title: "Campaign draft · Groville",
  description:
    "The campaign Groville would run to win the gap, an SEO article and social posts, drafted for your approval. Nothing goes live until you approve it.",
};

/**
 * Reads the `opportunity` query param (Next 16 `searchParams` is a Promise) and
 * hands the id to the client screen, which loads the matching drafted action.
 * Reading it here avoids a `useSearchParams` Suspense boundary in the client tree.
 */
export default async function CampaignDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { opportunity } = await searchParams;
  const opportunityId = Array.isArray(opportunity) ? opportunity[0] : opportunity ?? "";
  return <CampaignDraftScreen opportunityId={opportunityId} />;
}
