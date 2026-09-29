import type { Metadata } from "next";
import { AuthScreen } from "@/components/app/Auth";

export const metadata: Metadata = {
  title: "Log in · Groville",
  description:
    "Log back in to Groville, your AI growth agent, and pick up where you left off with the gaps and campaign drafts waiting for your approval.",
};

export default function LogInPage() {
  return <AuthScreen mode="login" />;
}
