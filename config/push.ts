/**
 * Web Push (VAPID) configuration.
 *
 * VAPID is an ECDSA P-256 keypair that identifies this server to every push
 * service. The PUBLIC key is handed to the browser — it has to be, the
 * subscription is bound to it — so it is `NEXT_PUBLIC_`. The PRIVATE key signs
 * the request that asks a push service to deliver; anyone holding it can send
 * notifications that appear to come from us, to every device that ever
 * subscribed.
 *
 * THE MISTAKE THIS GUARDS AGAINST. The two keys are both short base64url
 * strings from the same command, and it is genuinely easy to paste them into
 * the wrong variables. Swapped, nothing works, which is annoying but safe. But
 * putting the PRIVATE key into `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ships it into the
 * JavaScript bundle of a public marketing site, and nothing fails — push keeps
 * working, so no test catches it and no error is ever logged. That is the same
 * shape of failure as the Razorpay webhook secret (see config/payments), which
 * is why it gets the same treatment: a length check that makes the wrong value
 * impossible to miss.
 *
 * Generate a pair with:
 *   npx web-push generate-vapid-keys
 */

/** Just the variables this module reads — not the whole process environment,
 *  so a test can pass three strings without inventing a NODE_ENV. */
export type PushEnv = Record<string, string | undefined>;

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: contact, so a push service can reach us about abuse. */
  subject: string;
}

/**
 * An uncompressed P-256 public point is 65 bytes → 87 base64url characters.
 * A P-256 private scalar is 32 bytes → 43. The gap is wide enough that a length
 * test alone distinguishes them, which is the whole point.
 */
const PUBLIC_KEY_LENGTH = 87;
const PRIVATE_KEY_LENGTH = 43;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Returns null when the value is a plausible VAPID public key, or a reason it
 * is not. The reason never contains the value.
 */
export function publicKeyProblem(publicKey: string): string | null {
  const value = publicKey.trim();
  if (!value) return "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.";
  if (!BASE64URL.test(value)) {
    return "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not base64url. Copy it exactly as `npx web-push generate-vapid-keys` printed it.";
  }
  if (value.length === PRIVATE_KEY_LENGTH) {
    return "NEXT_PUBLIC_VAPID_PUBLIC_KEY is the length of a PRIVATE key. If the private key has been in this variable, it is in the browser bundle — generate a new pair before doing anything else.";
  }
  if (value.length !== PUBLIC_KEY_LENGTH) {
    return `NEXT_PUBLIC_VAPID_PUBLIC_KEY should be ${PUBLIC_KEY_LENGTH} characters; this one is ${value.length}.`;
  }
  return null;
}

export function privateKeyProblem(privateKey: string, publicKey?: string): string | null {
  const value = privateKey.trim();
  if (!value) return "VAPID_PRIVATE_KEY is not set.";
  if (!BASE64URL.test(value)) return "VAPID_PRIVATE_KEY is not base64url.";
  if (publicKey && value === publicKey.trim()) {
    return "VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY are the same value — they are two halves of a keypair, not one secret.";
  }
  if (value.length === PUBLIC_KEY_LENGTH) {
    return "VAPID_PRIVATE_KEY is the length of a PUBLIC key — the two are probably swapped.";
  }
  if (value.length !== PRIVATE_KEY_LENGTH) {
    return `VAPID_PRIVATE_KEY should be ${PRIVATE_KEY_LENGTH} characters; this one is ${value.length}.`;
  }
  return null;
}

export function subjectProblem(subject: string): string | null {
  const value = subject.trim();
  if (!value) return "VAPID_SUBJECT is not set. Use a mailto: address you actually read.";
  if (!/^(mailto:[^@\s]+@[^@\s]+\.[^@\s]+|https:\/\/\S+)$/i.test(value)) {
    return "VAPID_SUBJECT must be a mailto: address or an https URL.";
  }
  return null;
}

/** Every problem with the current environment, or an empty list. */
export function pushConfigProblems(env: PushEnv = process.env): string[] {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY ?? "";
  const subject = env.VAPID_SUBJECT ?? "";
  return [
    publicKeyProblem(publicKey),
    privateKeyProblem(privateKey, publicKey),
    subjectProblem(subject),
  ].filter((p): p is string => p !== null);
}

/**
 * Push is OPTIONAL. An unconfigured deployment must run normally with
 * notifications simply not being delivered to devices — they still appear in
 * the app. So this returns null rather than throwing, and every caller treats
 * null as "the feature is off".
 */
export function readPushConfig(env: PushEnv = process.env): PushConfig | null {
  if (pushConfigProblems(env).length > 0) return null;
  return {
    publicKey: (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim(),
    privateKey: (env.VAPID_PRIVATE_KEY ?? "").trim(),
    subject: (env.VAPID_SUBJECT ?? "").trim(),
  };
}

/** True when the browser has a key to subscribe with. Safe on the client. */
export function pushIsConfiguredForBrowser(publicKey: string | undefined): boolean {
  return publicKeyProblem(publicKey ?? "") === null;
}
