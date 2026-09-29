import { runDailyJob } from "@/lib/billing/invoices";
import { handle, json } from "@/lib/http";

// Daily expiry + reminder job. Trigger from a scheduler (or by hand in the demo):
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/jobs/daily
export async function POST(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("x-cron-secret") !== secret) {
      return json({ error: "Forbidden." }, 403);
    }
    return json(await runDailyJob());
  });
}
