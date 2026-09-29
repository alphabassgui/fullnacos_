// Small BMONI Embedded API client. Server-side only: it reads the API key from
// process.env and must never be imported from a client component.
//
// Every path and body below was checked against the OpenAPI spec at
// https://embedded-dev.bmoni.com/docs/openapi.json. Response types only list
// fields the spec marks as present; anything else is left as `unknown`.

const SANDBOX_HOST = "embedded-dev.bmoni.com";

export class BmoniConfigError extends Error {}

export class BmoniError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "BmoniError";
  }
}

function config() {
  const key = process.env.BMONI_API_KEY;
  const base = process.env.BMONI_BASE_URL;
  if (!key) {
    throw new BmoniConfigError("BMONI_API_KEY is not set (backend/.env).");
  }
  if (!base) {
    throw new BmoniConfigError("BMONI_BASE_URL is not set (backend/.env).");
  }
  // Sandbox only. Refuse anything that is not the dev host.
  if (new URL(base).host !== SANDBOX_HOST) {
    throw new BmoniConfigError(
      `Refusing to call ${new URL(base).host}. This project is sandbox only (${SANDBOX_HOST}).`,
    );
  }
  return { key, base: base.replace(/\/+$/, "") };
}

/** True when the sandbox host + key are configured. Never returns the key. */
export function bmoniConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const { key, base } = config();
  const res = await fetch(base + path, {
    method,
    headers: {
      "x-api-key": key,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    // Error shape is { statusCode, message, error }. `message` can be an array.
    const p = parsed as { message?: string | string[] } | null;
    const msg = Array.isArray(p?.message)
      ? p.message.join("; ")
      : (p?.message ?? res.statusText);
    throw new BmoniError(res.status, msg, method, path, parsed);
  }
  return parsed as T;
}

const enc = encodeURIComponent;

// ---------- types (verified fields only) ----------

export type Currency = "USDB" | "CNGN" | "CADC" | "EURe" | "GBPe" | "MEXe";

export interface BmoniUser {
  id: string;
  bmoniUserId: string;
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
}

export interface SmartWallet {
  id: string;
  currency: string;
  walletAddress: unknown;
  isActive: boolean;
}

export type RailStatus =
  | "not_started"
  | "pending"
  | "active"
  | "resubmission_required"
  | "rejected";

export interface OnboardingStatus {
  anchorStatus: RailStatus;
  anchorRejectionReason?: string;
}

// ---------- calls ----------

export const bmoni = {
  health: () => request<unknown>("GET", "/v1/health"),

  // users
  createUser: (b: {
    firstName: string;
    lastName?: string;
    email: string;
    phoneNumber: string; // E.164
    bvn?: string;
  }) => request<{ user: BmoniUser }>("POST", "/v1/users", b),
  listUsers: (page = 1, limit = 100) =>
    request<{ users: Record<string, unknown>[] }>("GET", `/v1/users?page=${page}&limit=${limit}`),
  getUser: (userId: string) =>
    request<unknown>("GET", `/v1/users/${enc(userId)}`),

  // kyc
  bvnLookup: (userId: string, bvn: string) =>
    request<Record<string, unknown>>(
      "GET",
      `/v1/users/${enc(userId)}/kyc/bvn-lookup/${enc(bvn)}`,
    ),
  getKyc: (userId: string) =>
    request<unknown>("GET", `/v1/users/${enc(userId)}/kyc`),
  patchKyc: (userId: string, b: Record<string, unknown>) =>
    request<unknown>("PATCH", `/v1/users/${enc(userId)}/kyc`, b),
  kycReadiness: (userId: string) =>
    request<unknown>("GET", `/v1/users/${enc(userId)}/kyc/readiness`),

  // wallet
  createOwnerProofChallenge: (
    userId: string,
    b: { currency: Currency; userOwnerAddress: string },
  ) =>
    request<{
      challengeId: string;
      groupId: string;
      message: string;
      expiresAt: string;
    }>("POST", `/v1/users/${enc(userId)}/smart-wallets/owner-proof-challenges`, b),
  createManagedWallet: (
    userId: string,
    b: {
      currency: Currency;
      userOwnerAddress: string;
      ownerProofChallengeId: string;
      ownerProofSignature: string;
    },
  ) =>
    request<SmartWallet>(
      "POST",
      `/v1/users/${enc(userId)}/smart-wallets/create-managed`,
      b,
    ),
  listWallets: (userId: string) =>
    request<SmartWallet[]>(
      "GET",
      `/v1/users/${enc(userId)}/smart-wallets/account/wallets`,
    ),
  walletBalance: (userId: string, smartWalletId: string) =>
    request<{ balance: string; currency: string; smartWalletId: string }>(
      "GET",
      `/v1/users/${enc(userId)}/smart-wallets/${enc(smartWalletId)}/balance`,
    ),
  accountBalances: (userId: string) =>
    request<unknown>(
      "GET",
      `/v1/users/${enc(userId)}/smart-wallets/account/balances`,
    ),
  walletTransactions: (userId: string, smartWalletId: string) =>
    request<unknown>(
      "GET",
      `/v1/users/${enc(userId)}/smart-wallets/${enc(smartWalletId)}/transactions`,
    ),

  // onboarding
  startNigeria: (
    userId: string,
    b: { bvn: string; ngnWalletAddress: string; ngnWalletIndex: number },
  ) =>
    request<unknown>(
      "POST",
      `/v1/users/${enc(userId)}/onboarding/start-nigeria`,
      b,
    ),
  onboardingStatus: (userId: string) =>
    request<OnboardingStatus>(
      "GET",
      `/v1/users/${enc(userId)}/onboarding/status`,
    ),

  // deposits
  depositAccounts: (userId: string, currency: "NGN" | "USD") =>
    request<{ accounts: Record<string, unknown>[] }>(
      "GET",
      `/v1/users/${enc(userId)}/bank-accounts/deposit-accounts/${currency}`,
    ),
  linkNigeriaVba: (
    userId: string,
    smartWalletId: string,
    bankAccountId: string,
  ) =>
    request<{ bankAccountId: string; groupWalletId: string; linked: boolean }>(
      "POST",
      `/v1/users/${enc(userId)}/smart-wallets/${enc(smartWalletId)}/onramp/vba/nigeria`,
      { bankAccountId },
    ),

  // webhooks
  getWebhookConfig: () => request<unknown>("GET", "/v1/webhooks/config"),
  createWebhookConfig: (b: {
    callbackUrl: string;
    events: string[];
    active: boolean;
    partnerId?: string;
  }) =>
    request<{ id: string; partnerId: string; secretKey: string }>(
      "POST",
      "/v1/webhooks/config",
      b,
    ),
  updateWebhookConfig: (b: Record<string, unknown>) =>
    request<unknown>("PATCH", "/v1/webhooks/config", b),
  webhookEvents: (page = 1, limit = 20) =>
    request<unknown>("GET", `/v1/webhooks/events?page=${page}&limit=${limit}`),
};
