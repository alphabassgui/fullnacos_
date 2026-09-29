import { newId, update } from "@/lib/billing/store";
import { HttpError, upsertCustomer } from "@/lib/billing/invoices";
import { handle, json, readJson, str } from "@/lib/http";

// Studio "Talk to us": stores the message. No payment flow.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const message = str(b.message, 2000).trim();
    if (message.length < 3) throw new HttpError(400, "Tell us a little about what you need.");
    await update((db) => {
      const c = upsertCustomer(db, str(b.name), str(b.email));
      db.contacts.push({ id: newId("ct"), at: new Date().toISOString(), name: c.name, email: c.email, message });
    });
    return json({ ok: true });
  });
}
