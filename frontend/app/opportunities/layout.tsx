import type { ReactNode } from "react";
import { RequireAuth, RequireOnboarded } from "@/components/app/guards";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <RequireOnboarded>{children}</RequireOnboarded>
    </RequireAuth>
  );
}
