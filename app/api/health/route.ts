import { NextResponse } from "next/server";

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
  seo: ["NEXT_PUBLIC_SITE_URL"],
};

/**
 * Groups without which the platform cannot do its job. `seo` is cosmetic, and
 * `email` is deliberately optional — the outbox holds acknowledgements until a
 * provider is configured, so an unconfigured mailer degrades rather than breaks.
 */
const REQUIRED = ["auth", "database", "storage", "payments"] as const;

export function GET(): NextResponse {
  const groups = Object.fromEntries(
    Object.entries(GROUPS).map(([name, vars]) => [
      name,
      vars.every((v) => (process.env[v] ?? "").trim().length > 0),
    ]),
  );

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
    },
    { status: ready ? 200 : 503 },
  );
}
