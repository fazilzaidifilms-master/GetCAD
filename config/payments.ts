// Razorpay configuration. Keys are SERVER-ONLY secrets except the public key id,
// which the browser needs to open checkout.
//
// The webhook secret is DISTINCT from the API key secret — Razorpay signs
// webhooks with the former and checkout callbacks with the latter. Mixing them
// makes every signature check fail in a way that looks like a network problem.

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Shortest webhook secret we will run with. 16 chars of randomness is the
 *  floor at which guessing stops being a realistic attack. */
const MIN_WEBHOOK_SECRET = 16;

/**
 * Why the webhook secret is validated and the other values are not.
 *
 * A wrong key id or key secret fails loudly the first time Razorpay is called.
 * A wrong webhook *secret* fails silently in the worst possible direction: the
 * app keeps working, and the end-to-end verification still passes, because both
 * sides of the HMAC agree with each other. Agreeing on a guessable value is
 * exactly as "valid" as agreeing on a strong one.
 *
 * The failure this prevents was real: the webhook URL was pasted into the
 * secret field, in both .env.local and the deployment. Everything went green
 * while anyone who could read the site's public URL could forge a
 * `payment.captured` event and fund escrow without paying.
 *
 * Returns null when the secret is acceptable, or a reason it is not. The reason
 * never contains the value.
 */
export function webhookSecretProblem(webhookSecret: string, keySecret?: string): string | null {
  if (/^https?:\/\//i.test(webhookSecret)) {
    return "RAZORPAY_WEBHOOK_SECRET looks like a URL. It is the shared signing secret, not the webhook endpoint.";
  }
  if (keySecret && webhookSecret === keySecret) {
    return "RAZORPAY_WEBHOOK_SECRET must differ from RAZORPAY_KEY_SECRET — they are separate secrets.";
  }
  if (webhookSecret.length < MIN_WEBHOOK_SECRET) {
    return `RAZORPAY_WEBHOOK_SECRET is too short to resist guessing (needs ${MIN_WEBHOOK_SECRET}+ characters). Generate one with \`openssl rand -hex 32\`.`;
  }
  return null;
}

/** SERVER-ONLY. Throws rather than silently running with half a config. */
export function readRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!keyId) throw new Error("RAZORPAY_KEY_ID is not set.");
  if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not set (server-only secret).");
  if (!webhookSecret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not set (server-only secret).");
  const problem = webhookSecretProblem(webhookSecret, keySecret);
  if (problem) throw new Error(problem);
  return { keyId, keySecret, webhookSecret };
}

/** The key id is public by design — it ships to the browser to open checkout. */
export function readRazorpayPublicKeyId(env: NodeJS.ProcessEnv = process.env): string {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  if (!keyId) throw new Error("RAZORPAY_KEY_ID is not set.");
  return keyId;
}
