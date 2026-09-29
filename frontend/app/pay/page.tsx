import type { Metadata } from "next";
import { PaymentScreen } from "@/components/app/Payment";

export const metadata: Metadata = {
  title: "Checkout · Groville",
  description:
    "Start Growth by bank transfer. Groville shows the exact amount and account, waits for your transfer, and confirms it. Bank transfer only, no card, and nothing charges automatically.",
};

export default function PayPage() {
  return <PaymentScreen />;
}
