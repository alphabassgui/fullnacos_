import type { Metadata } from "next";
import { AnalysingScreen } from "@/components/app/Analysing";

export const metadata: Metadata = {
  title: "Analysing · Groville",
  description:
    "Groville is reading your website and Google Search Console to find the customers you are missing, then drafting the first campaign. You approve every move.",
};

export default function AnalysingPage() {
  return <AnalysingScreen />;
}
