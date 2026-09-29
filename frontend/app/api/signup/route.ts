import { signUpFree } from "@/lib/billing/invoices";
import { handle, json, readJson, str } from "@/lib/http";

// Scan (free forever): create the account. No BMONI call.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const { customer, subscription } = await signUpFree(str(b.name), str(b.email));
    return json({ customerId: customer.id, plan: subscription.planId, status: subscription.status });
  });
}
