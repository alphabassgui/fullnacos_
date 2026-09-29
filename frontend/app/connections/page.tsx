import type { Metadata } from "next";
import { ConnectionsScreen } from "@/components/app/Connections";

export const metadata: Metadata = {
  title: "Connections · Groville",
  description:
    "Exactly what Groville is connected to and what it can see. Read-only sources, drafts for your approval. Groville never publishes, posts, changes your settings or spends your money.",
};

export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
