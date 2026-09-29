import type { Metadata } from "next";
import { Onboarding } from "@/components/app/Onboarding";

export const metadata: Metadata = {
  title: "Onboarding · Groville",
  description:
    "Tell Groville about your business in six quick steps, then it reads your site and Google Search Console to find the customers you are missing. Groville drafts, you approve.",
};

export default function OnboardingPage() {
  return <Onboarding />;
}
