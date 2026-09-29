import type { Metadata } from "next";
import { AuthScreen } from "@/components/app/Auth";

export const metadata: Metadata = {
  title: "Sign up · Groville",
  description:
    "Start free with Groville, your AI growth agent. Connect your site and see the customers you are missing in under ten minutes. Read-only access, Groville drafts and you approve every move.",
};

export default function SignUpPage() {
  return <AuthScreen mode="signup" />;
}
