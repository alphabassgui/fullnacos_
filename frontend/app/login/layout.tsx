import type { ReactNode } from "react";
import { RequireGuest } from "@/components/app/guards";

export default function GuestLayout({ children }: { children: ReactNode }) {
  return <RequireGuest>{children}</RequireGuest>;
}
