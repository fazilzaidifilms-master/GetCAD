import { NextResponse } from "next/server";

import { webhookSecretProblem } from "@/config/payments";
import { pushConfigProblems } from "@/config/push";

/**
 * Deployment health check.
 *
 * A deploy can build cleanly and still be broken, because every interesting
 * failure is a MISSING ENVIRONMENT VARIABLE that only surfaces when a user
 * happens to hit the code path that reads it. That is a miserable way to find
 * out payments are unconfigured.
 *
 * This reports which groups of configuration are present, so you can tell in
 * one request whether a deployment is actually wired up.
 *
 * SAFETY: it reports only whether a value is SET, never any value, never a
 * prefix, and never a length. `configured: false` tells an attacker only that
 * the site is incompletely deployed, which is already obvious from using it.
 */
const GROUPS: Record<string, readonly string[]> = {
  auth: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_JWT_ISSUER"],
  database: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  storage: ["SUPABASE_SERVICE_ROLE_KEY"],
  payments: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
  email: ["RESEND_API_KEY", "EMAIL_FROM"],
  push: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
  seo: ["NEXT_PUBLIC_SITE_URL"],
};

/**
 * Groups without which the platform cannot do its job. `seo` is cosmetic, and
 * `email` and `push` are deliberately optional — the outbox holds
 * acknowledgements until a provider is configured, and notifications still
 * appear inside the app when no VAPID keys are set. Both degrade rather than
 * break.
 */
const REQUIRED = ["auth", "database", "storage", "payments"] as const;

export function GET(): NextResponse {
  const groups = Object.fromEntries(
    Object.entries(GROUPS).map(([name, vars]) => [
      name,
      vars.every((v) => (process.env[v] ?? "").trim().length > 0),
    ]),
  );

  // `payments` being SET is not the same as `payments` being SAFE. A webhook
  // secret that is a URL, or a copy of the key secret, or short enough to guess
  // lets a forged payment fund escrow — and nothing else notices, because both
  // ends of the signature agree with each other. Report it as unconfigured.
  const secretProblem = groups.payments
    ? webhookSecretProblem(
        (process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim(),
        (process.env.RAZORPAY_KEY_SECRET ?? "").trim(),
      )
    : null;
  if (secretProblem) groups.payments = false;

  // Same shape of failure, different feature. Push keeps WORKING with the
  // private key pasted into NEXT_PUBLIC_VAPID_PUBLIC_KEY — it is simply also in
  // the browser bundle of a public site. Nothing else in the system would ever
  // report that, so it is reported here.
  const pushProblems = groups.push ? pushConfigProblems() : [];
  if (pushProblems.length > 0) groups.push = false;

  const ready = REQUIRED.every((g) => groups[g]);

  return NextResponse.json(
    {
      status: ready ? "ok" : "incomplete",
      configured: groups,
      // Named so it is obvious this is about configuration, not uptime: the
      // route answering at all already proves the app is running.
      note: ready
        ? undefined
        : `Missing configuration for: ${REQUIRED.filter((g) => !groups[g]).join(", ")}`,
      // Safe to state: it describes the SHAPE of a misconfiguration, never a
      // value, and an attacker able to exploit it already knows.
      warning: secretProblem ?? undefined,
      pushWarnings: pushProblems.length > 0 ? pushProblems : undefined,
    },
    { status: ready ? 200 : 503 },
  );
}
