import { timingSafeEqual } from "node:crypto";

/**
 * Authorising a scheduled job.
 *
 * A cron endpoint is a URL anyone can find. `/api/cron/push` drains a queue and
 * sends notifications; called repeatedly by a stranger it is a way to make
 * every phone on the platform buzz, and to burn the retry budget on rows that
 * would otherwise have been delivered. So it needs a secret, and the secret
 * needs comparing in constant time — a naive `===` on a string leaks its length
 * and prefix through timing, and a cron secret is exactly the kind of value
 * someone would sit and probe.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` using the value of the
 * project's CRON_SECRET environment variable. Any other scheduler can do the
 * same.
 *
 * WITHOUT A SECRET SET, THE ROUTE IS CLOSED. Not open — closed. An unconfigured
 * cron endpoint that runs for anybody is worse than one that runs for nobody:
 * the second is a feature you notice is missing, the first is one you never
 * notice is abused.
 */
export function cronSecretProblem(secret: string | undefined): string | null {
  const value = (secret ?? "").trim();
  if (!value) {
    return "CRON_SECRET is not set, so scheduled jobs are refused. Generate one with `openssl rand -hex 32`.";
  }
  if (value.length < 24) {
    return "CRON_SECRET is too short to resist guessing (needs 24+ characters).";
  }
  return null;
}

/** True only when the header carries exactly the configured secret. */
export function cronRequestIsAuthorised(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  if (cronSecretProblem(secret) !== null) return false;

  const expected = `Bearer ${(secret ?? "").trim()}`;
  const provided = authorizationHeader ?? "";

  // Compare over fixed-width buffers: timingSafeEqual throws on a length
  // mismatch, which would itself be a timing signal about the secret's length.
  const a = Buffer.from(expected.padEnd(256).slice(0, 256));
  const b = Buffer.from(provided.padEnd(256).slice(0, 256));
  return timingSafeEqual(a, b) && provided.length === expected.length;
}
