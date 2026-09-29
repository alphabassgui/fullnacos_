import type { Metadata } from "next";
import { ResultsScreen } from "@/components/app/Results";

export const metadata: Metadata = {
  title: "Results · Groville",
  description:
    "The payoff of the campaign you approved. Groville drafts, you approve and ship, and this is what it won for Ada's Bakery, tied to the same gap you started from.",
};

export default function ResultsPage() {
  return <ResultsScreen />;
}
