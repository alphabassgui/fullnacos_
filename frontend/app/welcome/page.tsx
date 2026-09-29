import type { Metadata } from "next";
import { Welcome } from "@/components/app/Welcome";

export const metadata: Metadata = {
  title: "Welcome · Groville",
  description:
    "Say hello to Groville, your AI growth agent. It reads your site to find the customers you are missing and drafts the campaigns to win them. You approve every move, Groville never publishes or sends on its own.",
};

export default function WelcomePage() {
  return <Welcome />;
}
