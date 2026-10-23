import type { ReactNode } from "react";
import { RequireAuth, RequireNotOnboarded } from "@/components/app/guards";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <RequireNotOnboarded>{children}</RequireNotOnboarded>
    </RequireAuth>
  );
}
