import "server-only";

import { readRazorpayConfig } from "@/config/payments";

/**
 * Razorpay Route linked accounts — registering a designer as someone we are
 * allowed to transfer money to.
 *
 * ⚠️ UNVERIFIED AGAINST THE LIVE API. Every other integration in this codebase
 * has been exercised end-to-end (see scripts/verify-payment.mjs). This one has
 * not: the build environment has no egress to api.razorpay.com, and Route
 * account creation cannot be meaningfully faked. The request shapes below are
 * written from Razorpay's documented v2 Accounts API, and the operator path
 * (create the linked account in the Razorpay dashboard, then record its id with
 * `npm run payouts:link -- --account-ref acc_…`) exists precisely so the
 * platform is not blocked on code nobody has been able to run yet.
 *
 * Onboarding is three calls, not one, and they are not interchangeable:
 *
 *   1. POST /v2/accounts                      — who this person is
 *   2. POST /v2/accounts/:id/stakeholders     — the individual behind it
 *   3. PATCH /v2/accounts/:id/products/:pid   — where settlements actually go
 *
 * The bank details only take effect at step 3. An account created without it
 * looks fine in the dashboard and silently cannot be paid.
 */
const API_BASE = "https://api.razorpay.com/v2";

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function call(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const { keyId, keySecret } = readRazorpayConfig();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(keyId, keySecret),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Razorpay ${method} ${path} failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface LinkedAccountInput {
  /** OUR user id, sent as reference_id so the account is traceable back here. */
  userId: string;
  email: string;
  /** Digits only; Razorpay rejects formatting characters. */
  phone: string;
  legalName: string;
  beneficiaryName: string;
  pan: string;
  accountNumber: string;
  ifsc: string;
  accountType: "SAVINGS" | "CURRENT";
}

export interface LinkedAccountResult {
  accountId: string;
  productId: string | null;
  /** Razorpay's activation state — `activated` is the only payable one. */
  activationStatus: string | null;
}

/** Razorpay wants a bare 10-digit Indian number, not a formatted one. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function createLinkedAccount(
  input: LinkedAccountInput,
): Promise<LinkedAccountResult> {
  // 1. The account itself.
  const account = await call("/accounts", "POST", {
    email: input.email,
    phone: normalizePhone(input.phone),
    type: "route",
    // Traceable back to our user without exposing anything identifying.
    reference_id: input.userId,
    legal_business_name: input.legalName,
    business_type: "individual",
    contact_name: input.legalName,
    profile: { category: "services", subcategory: "web_designing" },
    legal_info: { pan: input.pan },
  });

  const accountId = typeof account.id === "string" ? account.id : null;
  if (!accountId) throw new Error("Razorpay returned no linked account id");

  // 2. The individual behind the account.
  await call(`/accounts/${encodeURIComponent(accountId)}/stakeholders`, "POST", {
    name: input.legalName,
    email: input.email,
    kyc: { pan: input.pan },
  });

  // 3. Route configuration — this is where the bank details land. Without it
  //    the account exists and cannot receive a paisa.
  const product = await call(`/accounts/${encodeURIComponent(accountId)}/products`, "POST", {
    product_name: "route",
    tnc_accepted: true,
  });
  const productId = typeof product.id === "string" ? product.id : null;

  let activationStatus =
    typeof product.activation_status === "string" ? product.activation_status : null;

  if (productId) {
    const configured = await call(
      `/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}`,
      "PATCH",
      {
        settlements: {
          account_number: input.accountNumber,
          ifsc_code: input.ifsc,
          beneficiary_name: input.beneficiaryName,
        },
        tnc_accepted: true,
      },
    );
    if (typeof configured.activation_status === "string") {
      activationStatus = configured.activation_status;
    }
  }

  return { accountId, productId, activationStatus };
}

/** Current activation state of an existing linked account. */
export async function fetchLinkedAccount(accountId: string): Promise<Record<string, unknown>> {
  return call(`/accounts/${encodeURIComponent(accountId)}`, "GET");
}
