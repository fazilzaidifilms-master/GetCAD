import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Rate limiting for the public, unauthenticated forms.
 *
 * The client address is HASHED with a server-side salt before it ever leaves
 * this module — the database stores an opaque bucket key, never an IP. Set
 * RATE_LIMIT_SALT in production so the digests are not guessable from source.
 */
const SALT = process.env.RATE_LIMIT_SALT ?? "the-cad-pillar-rate-limit-v1";

async function clientFingerprint(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${SALT}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Returns true if the caller may proceed.
 *
 * FAILS OPEN: if the limiter itself errors, a genuine submission is still
 * accepted. Losing a real lead is a worse outcome than letting one extra
 * request through, and the limiter is defence against volume, not a security
 * boundary — authorization is enforced separately by RLS.
 */
export async function checkRateLimit(
  scope: string,
  maxHits: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const supabase = await createUserSupabaseClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_bucket: `${scope}:${await clientFingerprint()}`,
      p_max_hits: maxHits,
      p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/** Per-IP budgets for the two public forms. */
export const CONTACT_LIMIT = { scope: "contact", max: 5, windowSeconds: 3600 } as const;
export const DESIGNER_APPLICATION_LIMIT = {
  scope: "designer-application",
  max: 3,
  windowSeconds: 3600,
} as const;
