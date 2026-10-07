import type { ReactNode } from "react";
import { RequireAuth } from "@/components/app/guards";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
