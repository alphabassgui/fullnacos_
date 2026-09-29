// Registers our webhook with BMONI and stores the signing secret in .env.
//   npx tsx --env-file=.env scripts/register-webhook.ts [--force]
//
// Needs a PUBLIC https URL (APP_PUBLIC_URL in .env, e.g. an ngrok tunnel):
// BMONI cannot reach http://localhost. Without it the app still works using
// the balance-check fallback and the sandbox simulate button.
//
// SHARED KEY WARNING: BMONI allows ONE webhook config per partner. With the
// shared sandbox key that config belongs to everyone using the key, so this
// script will not overwrite one that points elsewhere unless you pass --force.
// It never prints the secret.

import fs from "node:fs";
import path from "node:path";
import { bmoni, BmoniError } from "../lib/bmoni/client";

// Partner-scoped subscriptions receive employee.* names (renamed from wallet.*).
// Subscribing to wallet.deposit.completed here would be accepted and never fire.
const EVENTS = [
  "employee.deposit.completed",
  "employee.deposit.failed",
  "employee.deposit.refunded",
  "onboarding.completed",
  "onboarding.failed",
  "kyc.action_required",
];

interface WebhookConfig {
  callbackUrl: string;
  secretKey: string;
}

function writeSecret(secret: string) {
  const file = path.join(process.cwd(), ".env");
  let env = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^BMONI_WEBHOOK_SECRET=.*$/m.test(env)) {
    env = env.replace(/^BMONI_WEBHOOK_SECRET=.*$/m, `BMONI_WEBHOOK_SECRET=${secret}`);
  } else {
    env += `\nBMONI_WEBHOOK_SECRET=${secret}\n`;
  }
  fs.writeFileSync(file, env);
  console.log("Saved BMONI_WEBHOOK_SECRET to .env (not printed). Restart the dev server to load it.");
}

async function main() {
  const force = process.argv.includes("--force");
  const base = process.env.APP_PUBLIC_URL ?? "";
  if (!base.startsWith("https://")) {
    console.log(
      "APP_PUBLIC_URL must be a public https URL (e.g. your ngrok URL) in backend/.env.\n" +
        "BMONI cannot call localhost. Skipping: the app will use the balance-check fallback instead.",
    );
    return;
  }
  const callbackUrl = `${base.replace(/\/+$/, "")}/api/webhooks/bmoni`;

  let existing: WebhookConfig | null = null;
  try {
    existing = (await bmoni.getWebhookConfig()) as WebhookConfig;
  } catch (e) {
    if (!(e instanceof BmoniError && e.statusCode === 404)) throw e;
  }

  if (!existing) {
    const created = await bmoni.createWebhookConfig({ callbackUrl, events: EVENTS, active: true });
    writeSecret(created.secretKey);
    return;
  }

  if (existing.callbackUrl === callbackUrl) {
    console.log("A webhook config for this URL already exists. Reusing its secret.");
    writeSecret(existing.secretKey);
    return;
  }

  const host = (() => {
    try {
      return new URL(existing.callbackUrl).host;
    } catch {
      return "(unparseable)";
    }
  })();
  if (!force) {
    console.log(
      `A webhook config already exists for this API key and points to ${host}.\n` +
        "With the shared sandbox key that config may belong to another team. Not changing it.\n" +
        "Options: use the balance-check fallback (default), get your own key, or re-run with --force to take it over.",
    );
    return;
  }
  const updated = (await bmoni.updateWebhookConfig({ callbackUrl, events: EVENTS, active: true })) as WebhookConfig;
  writeSecret(updated.secretKey);
}

main().catch((e) => {
  console.error(e instanceof BmoniError ? `BMONI error ${e.statusCode}: ${e.message}` : e instanceof Error ? e.message : e);
  process.exit(1);
});
