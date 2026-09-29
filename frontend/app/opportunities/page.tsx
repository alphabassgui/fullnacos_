import type { Metadata } from "next";
import { OpportunitiesScreen } from "@/components/app/Opportunities";

export const metadata: Metadata = {
  title: "Opportunities · Groville",
  description:
    "The customers you are missing, ranked. Groville found the search gaps worth chasing and drafted the campaigns to win them. You approve every move.",
};

export default function OpportunitiesPage() {
  return <OpportunitiesScreen />;
}
