import type { Metadata } from "next";
import { CampaignsScreen } from "@/components/app/Campaigns";

export const metadata: Metadata = {
  title: "Campaigns · Groville",
  description:
    "The campaigns Groville has drafted for Ada's Bakery. One draft is waiting for your approval. Nothing goes live until you approve it.",
};

export default function CampaignsPage() {
  return <CampaignsScreen />;
}
