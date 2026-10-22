import type { Metadata } from "next";
import { GtmScreen } from "@/components/app/Gtm";

export const metadata: Metadata = {
  title: "GTM · Groville",
  description:
    "I read your go-to-market surface against your competitors, score it, name the blind spots, and draft a recommendation. You review it before acting. Nothing goes live on its own.",
};

export default function GtmPage() {
  return <GtmScreen />;
}
