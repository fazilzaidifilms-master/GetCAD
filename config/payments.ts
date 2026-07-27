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

/** SERVER-ONLY. Throws rather than silently running with half a config. */
export function readRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!keyId) throw new Error("RAZORPAY_KEY_ID is not set.");
  if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not set (server-only secret).");
  if (!webhookSecret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not set (server-only secret).");
  return { keyId, keySecret, webhookSecret };
}

/** The key id is public by design — it ships to the browser to open checkout. */
export function readRazorpayPublicKeyId(env: NodeJS.ProcessEnv = process.env): string {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  if (!keyId) throw new Error("RAZORPAY_KEY_ID is not set.");
  return keyId;
}
