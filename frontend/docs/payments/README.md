# Groville pricing + BMONI payments

Sandbox only. NGN only. Built for the hackathon demo.

## Status: what is proven and what is not

| Part | Status |
|---|---|
| Pricing maths (monthly, annual, USD display) | Tested. Matches the mockup exactly. |
| Invoices, subscriptions, expiry, reminders, renewals | Tested (42 API checks against the running server). |
| Webhook endpoint: signature check, dedupe, matching | Tested with signed fake deliveries. Not yet with a real BMONI delivery. |
| Pricing page, checkout, waiting -> received, light/dark, mobile | Tested in a real browser (20 checks, against the real BMONI account). |
| Live BMONI: health, create user, BVN lookup, KYC profile, owner-proof challenge, wallet creation, balances, transactions | **Works** against the sandbox (run with the shared key). |
| Live BMONI: Nigeria onboarding (`start-nigeria`) -> real virtual account | **Works now.** It failed on 23 Sep (504/500, BMONI side) and was working again on 25 Sep. The app shows the real account: PROVIDUS BANK 9699794595, "Dillon Bunch". |
| Real bank deposit detected from BMONI | **Cannot be tested**: the sandbox has no way to simulate a bank transfer. Detection by webhook or balance is built but unproven with real money. |

BMONI confirmed they cannot give us a production key during the hackathon, so this stays **sandbox only**. If BMONI's onboarding fails again, the app falls back to a **clearly labelled placeholder account** (see "Demo fallback") so the demo still runs.

The offline tests used a fake merchant record and a throwaway webhook secret. Both were removed afterwards.

## Run it

```
cd backend
npm install
```

1. Open `backend/.env` and paste the sandbox key after `BMONI_API_KEY=`. The shared key is printed on https://embedded-docs.bmoni.com/api-quickstart/ (or use one from the organisers).
2. Prove BMONI works (safe to re-run, it resumes):
   `npx tsx --env-file=.env scripts/bmoni-proof.ts`
   On the shared key both test personas' phone numbers were already taken by other teams (409), and BMONI accepts a different made-up phone, so we run it as: `PHONE=+2348000009317 npx tsx --env-file=.env scripts/bmoni-proof.ts` (and `PERSONA_INDEX=1` for Bunch Dillon). It never prints other people's users or the webhook secret.
3. Start the app: `npm run dev`, then open http://localhost:3000/pricing

Environment variables (all in `backend/.env`, which is gitignored):

| Variable | What |
|---|---|
| `BMONI_API_KEY` | Sandbox key. Backend only. |
| `BMONI_BASE_URL` | `https://embedded-dev.bmoni.com`. The client refuses any other host. |
| `BMONI_WEBHOOK_SECRET` | Filled in by `scripts/register-webhook.ts`. Optional. |
| `CRON_SECRET` | Protects the daily job endpoint. |
| `APP_PUBLIC_URL` | Public https URL, only needed for real webhooks. |
| `ALLOW_SIMULATE_PAYMENT` | Set `false` to switch the simulate button off. Always off in production builds. |
| `DEMO_FALLBACK_ACCOUNT` | `true` (set in `.env`): if BMONI cannot issue a real virtual account, show a labelled placeholder so the demo still runs. Ignored in production. Set `false` to see the raw error instead. |

## Demo steps

1. Open `/pricing`. Flip Monthly / Annual (Growth goes to N24,000 a month, N288,000 billed, saves N72,000). Flip NGN / USD ($59 -> $47).
2. **Scan:** "Start free", enter name and email. Account created, no BMONI call.
3. **Growth:** "Start free" on the Growth card, enter name and email. You see the exact amount, for example N30,000.37, the real BMONI sandbox account (PROVIDUS BANK 9699794595) and "Waiting for payment". (The very first click on a fresh setup also creates the merchant account at BMONI and can take up to a minute.) If BMONI's onboarding is down, a red "Demo account" notice replaces the account with a placeholder; say so out loud in the demo.
4. Press **Simulate payment** (clearly labelled sandbox only). The page changes to "Payment received. Growth is active until ...".
5. **Studio:** "Talk to us" sends a message. No payment.
6. Run the daily job by hand:
   `curl -X POST -H "x-cron-secret: dev-cron-secret-change-me" http://localhost:3000/api/jobs/daily`
   It expires unpaid invoices and lapsed subscriptions, and creates a renewal invoice plus a reminder 7 days before a period ends.
7. Look at `backend/data/db.json` to show customers, invoices, subscriptions and the reminder log.

## Design decisions (with the evidence)

**BMONI is only the payment rail.** It has no plans, subscriptions or renewals. We built those.

**Decision: one merchant BMONI account receives every customer's payment. Customers do not need a BMONI user or a BVN.**

Why:
- The deposit event carries `userId`, `transactionId`, `smartWalletId`, `amount`, `currency`, `transferId`. There is **no payer name and no reference** (checked in the OpenAPI examples). So with one shared account the only thing that can identify a payment is the amount.
- So each invoice gets a unique amount: the plan price plus 1 to 99 kobo (for example N30,000.37). A deposit of exactly that amount pays that invoice. The customer is told to send the exact amount.
- Per-customer BMONI users would give each customer their own account number, but every customer would need a BVN. That conflicts with "no card required", and the sandbox only recognises two test identities, so it cannot even be demoed.
- Recurring payments use option (a): a new invoice each period. Option (b), pre-funded wallets with the server sending transfers, needs the server to sign for every customer, so it was not built.

**Detecting a payment, in order:**
1. Webhook `employee.deposit.completed` (signature checked over the raw body, deduplicated on the event id).
2. Fallback: while the page is waiting, the server compares the merchant wallet balance with the last balance it accounted for. A rise equal to an open invoice's exact amount pays it. This works without a public URL.
3. Sandbox only: the simulate button (below).

**Prices live in one file:** `lib/billing/plans.config.ts`. It holds plans, NGN and USD prices, the annual discount, invoice lifetime, reminder days and the page copy. The browser only sends `{ planId, interval }`. Annual is computed on the server: 30,000 x 12 x 0.8 = 288,000.

**Free plan (Scan):** creates a customer and a subscription that never expires. No BMONI call.

**Simulate payment (sandbox only).** The BMONI sandbox cannot simulate a bank transfer. Test tokens (N1,000 and $10) are credited by hand after an emailed request, usually within a business day. `POST /api/sandbox/simulate-payment` marks an invoice paid through the same code path as a real deposit. It moves no money, is disabled in production, and is labelled on screen.

**Provisioning is safe for the shared key.** The shared sandbox key is one shared BMONI partner. The merchant email gets a random tag so we never adopt someone else's user. If the first persona's phone is taken (409), it falls back to the second persona. Wallet creation is not duplicate-safe, so the owner key is saved before the call and existing wallets are listed first.

**Webhook subscription names.** For a partner-scoped subscription, BMONI renames `wallet.*` events to `employee.*`. Subscribing to `wallet.deposit.completed` is accepted and never fires. We subscribe to `employee.deposit.completed`.

## Where the reference and the brief disagreed (spec won)

- `POST /v1/users` also accepts an optional `bvn` that auto-fills last name, address and date of birth.
- KYC `PATCH` body per the spec: `personalInfo`, `address` (`streetLine1`...), `identificationNumbers`. One docs page shows `addressDetails`/`street` instead.
- `GET /v1/users` returns `{ users: [...] }` and is paginated.
- Webhook config: the spec says omit `partnerId`; a docs page says supply it. We omit it. `GET /v1/webhooks/config` returns the `secretKey`. Only one config exists per partner.
- `ngnWalletIndex`: the docs quickstart uses `0`, with the owner address as `ngnWalletAddress`. We do the same. Still to confirm live.
- The quickstart says three document uploads are required before verification completes. The Nigeria page lists none for stage 1. Still to confirm live.

## Limitations (be upfront about these in the demo)

- **Sandbox only.** No real money and no real personal data. Test personas only.
- **Server-held owner key (demo only).** The merchant wallet's owner key is generated and stored on the server in `data/db.json`. In a real product the key must live on the user's device or in a KMS. Never reuse this approach in production.
- **USD is display only.** Prices show, but paying in USD is refused (`USD payment is not available`). USD needs a second KYC stage and a USD account. The USD header copy ("Cards and invoices welcome") is from the mockup and is not true for this build.
- **Amount matching is fragile in real life.** If a customer sends a rounded amount, the payment is stored as "unmatched" (`unmatchedDeposits` in `db.json`) for a human. Also unverified: whether BMONI credits the gross or net amount after fees. Only a real deposit can answer that.
- **Balance check:** the live balance is a plain decimal string (`"0"`, currency `"NGN"`), which is what the fallback parses. What it looks like after a real deposit is still unseen.
- **The account number is real but it is sandbox.** It belongs to a fake test identity (Dillon Bunch), so a real bank transfer to it will not arrive. If BMONI's onboarding breaks again the page shows a placeholder, which is labelled on screen; never present that as real.
- **Real identities are untested.** Only the two sandbox test personas have been through onboarding. Whether a real business can onboard (and whether a business/KYB account is the right route for a merchant) is an open question for BMONI.
- **Customers can be anything; the merchant must be a test persona.** Our customers are just names and emails in our own data. Only the one merchant BMONI user needs a BVN, and in the sandbox only the two test personas' BVNs resolve. A made-up phone number is accepted.
- **No customer login.** Customers are identified by email only. Fine for a demo, not for production.
- **Reminders are written to a log, not emailed.** No email provider is connected.
- **Storage is a JSON file** (`data/db.json`). Fine locally, does not work on Vercel-style read-only hosts. Swap for a real database.
- **Webhooks need a public https URL** (a tunnel such as ngrok) and, with the shared key, may collide with another team's config. `scripts/register-webhook.ts` will not overwrite one that points elsewhere unless you pass `--force`.
- **Growth button says "Start free"** because the mockup does. It is a paid plan, so consider "Start Growth". The Growth feature list is only what was visible in the mockup screenshot.
- The daily job is triggered by hand or an external scheduler. Nothing schedules it inside the app.

## For the frontend developer (hooking up the real Groville pages)

`app/pricing/` is a **stand-in page built from the mockup so the payment code could be tested**. The real frontend replaces it, including its popup form. Everything below is what a replacement page needs. The browser only calls these routes, never BMONI, and **never sends a price** (it sends `planId` and `interval`; the server prices it).

| What | Call | Returns |
|---|---|---|
| Plans and prices | `GET /api/plans?interval=monthly` or `annual` | `{ interval, annualDiscount, headline: { NGN, USD }, payableCurrency, plans: [{ id, name, tagline, kind, popular, cta, note, features[], perMonthNgn, listPerMonthNgn, billedNgn, savesPerYearNgn, perDayNgn, perMonthUsd, listPerMonthUsd, savesPerYearUsd }] }`. `kind` is `free`, `paid` or `contact`. |
| Free signup (Scan) | `POST /api/signup` `{ name, email }` | `{ customerId, plan, status }` |
| Pay for Growth | `POST /api/subscribe` `{ name, email, planId: "growth", interval: "monthly"\|"annual" }` | `{ customerId, invoiceId, status, amountNgn, amountKobo, expiresAt, demo, bank: { accountNumber, bankName, accountName } }` |
| Is it paid yet? | `GET /api/invoices/{invoiceId}` (poll about every 4 s) | `{ status: "pending"\|"paid"\|"expired", paidAt, subscription: { status, currentPeriodEnd } , ... }` |
| Studio "Talk to us" | `POST /api/contact` `{ name, email, message }` | `{ ok: true }` |
| Sandbox demo only | `POST /api/sandbox/simulate-payment` `{ invoiceId }` | `{ simulated: true, matched }`. Off in production. |

Rules for the page:
- Show `amountNgn` **exactly** (it has kobo, for example 30,000.37). The customer must send that exact amount.
- If `demo` is `true`, the account number is a placeholder: show a clear warning and do not present it as real. See "Demo fallback".
- Errors come back as `{ "error": "message" }` with 400 (bad input, or USD payment), 404, 409, 502/503 (payment provider problem). Show the message.
- USD is display only. Sending `currency: "USD"` to `/api/subscribe` is refused.
- The customer's name and email are stored only in our own `data/db.json`. They are not sent to BMONI (BMONI only ever sees the merchant test identity).

## Files

- `lib/billing/plans.config.ts`: all prices and copy. `pricing.ts`: the maths.
- `lib/billing/invoices.ts`: invoices, subscriptions, matching, daily job. `store.ts`: JSON store.
- `lib/billing/merchant.ts`: one-time BMONI setup. `reconcile.ts`: balance fallback.
- `lib/bmoni/client.ts`: BMONI client (sandbox host only, key from env). `wallet.ts`: owner key + signing. `webhook.ts`: signature check.
- `app/api/*`: plans, signup, subscribe, invoices/[id], contact, webhooks/bmoni, jobs/daily, sandbox/simulate-payment.
- `app/pricing/*`: the page. `app/page.tsx` now redirects to `/pricing` (it was the unmodified Create Next App stub).
- `scripts/bmoni-proof.ts`, `scripts/register-webhook.ts`.

Existing files touched: `package.json` and `package-lock.json` (added `ethers`, and `tsx` as a dev dependency) and `app/page.tsx` (see above). Nothing else that already existed was changed.

## Live status (run on 23 and 25 Sep 2026 with the shared sandbox key)

**Update, 25 Sep: `start-nigeria` is working again.** The same call that failed on 23 Sep succeeded, onboarding status went to `anchorStatus: "active"`, and BMONI issued a per-user virtual account: `{ id: "14b9cc5d-...", accountName: "Dillon Bunch", bankName: "PROVIDUS BANK", accountNumber: "9699794595", bankCode: "000023", targetCurrency: "NGN" }`. Linking it to the wallet returned `linked: true`. `GET .../deposit-accounts/NGN` lists this account **and** the shared pooled account (`pooled-vba-1`, target currency EUR), so the code picks the entry whose id is a UUID. The first Growth click now takes about 5 seconds and shows this real account. Nothing was needed on our side apart from retrying; documents were not uploaded. Everything below is the history of the failure.

**Worked:**
- `POST /v1/users` with a `bvn`: fine. BMONI does not require the persona's phone, so a spare made-up phone works when the persona phones are taken (they were: 409 for both).
- BVN lookup, `PATCH /kyc`, owner-proof challenge, `create-managed`, balances, transactions: all fine.

**Learned from the live responses (differs from what the docs led us to expect):**
- Asking for a `CNGN` wallet returns a wallet labelled `NGN`.
- `GET .../smart-wallets/account/wallets` returns 400 for a brand-new user until the first owner-proof challenge exists.
- Before onboarding, `GET .../deposit-accounts/NGN` lists a **shared pooled account** (`id: "pooled-vba-1"`, "Bkey Limited", target currency EUR). It is not a UUID, cannot be linked to our wallet (400 "bankAccountId must be a UUID"), and is not ours. The code ignores anything that is not a UUID.
- Balance: `{ balance: "0", currency: "NGN" }`. Transactions: `{ transactions: [], page, perPage, total, ... }`.
- KYC readiness still lists `proofOfAddressDocuments`, `identificationDocuments`, `biometricDocuments` as missing. The Nigeria docs page says stage 1 needs only the BVN and those uploads belong to stage 2 (USD). We did not upload documents.
- A webhook config already exists on the shared key, pointing at BMONI's own `bmoni-hackathon-demo.workers.dev`. We did not touch it. Real deposit webhooks therefore never reach us; the balance check and the simulate button cover that.

**Was broken on 23 Sep (BMONI side, fixed by 25 Sep):** `POST /v1/users/{id}/onboarding/start-nigeria` failed every time, so no per-user virtual account was issued.
- First: HTTP 504, a Cloudflare "origin gateway timeout" after about 15 seconds ("retryable, retry after 120 s"). Six tries over about 5 minutes, same result.
- Tried: owner address vs smart-wallet address as `ngnWalletAddress`; Samson Jabo and Bunch Dillon identities with their own BVNs; filling `sourceOfFunds`; waiting more than 2 minutes between tries.
- After several tries on one user the answer became a fast HTTP 500 ("The operation could not be completed"). Onboarding status stays `not_started`.
- Cloudflare ray ids for the support email: `a3fce88c0bb7da21`, `a3fcec5968170161`.

**Still worth asking BMONI:** how a merchant should collect from many customers (no payer name or reference on deposits), how to test a deposit in the sandbox, whether the credited amount is gross or net of fees, and which identity a real merchant uses in production (owner BVN or a business/KYB account). BMONI said they cannot provide a production key during the hackathon.

**Side effects on the shared account.** The live run created two test users (with spare phones +2348000009317 and +2348000009318, emails `samson.jabo+...@example.com` and `bunch.dillon+...@example.com`) and one wallet each. They are fake sandbox data. The app reuses the Bunch Dillon one.
