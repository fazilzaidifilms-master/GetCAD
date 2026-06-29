import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

/**
 * Server-side verification of a Clerk-issued session JWT.
 *
 * This is the heart of the Clerk -> Supabase bridge and it lives in `core/`
 * precisely because it must be framework-agnostic and trivially testable: it
 * takes a token + the public verification material and returns a verified
 * identity, or throws. It NEVER trusts a claim the client merely asserts — the
 * signature, issuer, and expiry are all checked (non-negotiable: server-side
 * auth only).
 *
 * The key resolver is injected so production uses Clerk's remote JWKS while
 * tests use a local key set — same code path, fully deterministic offline.
 */

export interface VerifiedPrincipal {
  /** The Clerk user id (the JWT `sub`). This is also our `users.id`. */
  clerkUserId: string;
  /** The full verified claim set, for callers that need more than the id. */
  claims: JWTPayload;
}

export interface VerifyClerkTokenOptions {
  /**
   * Resolves the signing key for a token. In production:
   * `clerkRemoteKeySet(jwksUrl)`. In tests: a local JWKS resolver.
   */
  getKey: JWTVerifyGetKey;
  /** Expected issuer — Clerk's Frontend API origin (e.g. https://x.clerk.accounts.dev). */
  issuer: string;
  /** Optional audience to enforce. */
  audience?: string;
  /** Allowed clock skew in seconds (default 0 — be strict). */
  clockToleranceSec?: number;
}

/** Thrown for any token that is missing, malformed, or fails verification. */
export class ClerkTokenError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ClerkTokenError";
    this.cause = cause;
  }
}

/**
 * Build a JWKS resolver pointed at Clerk's public key endpoint. Thin wrapper
 * around jose's remote key set (it caches and rotates keys for you).
 */
export function clerkRemoteKeySet(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl));
}

/**
 * Verify a Clerk session token. Resolves to the verified principal, or rejects
 * with {@link ClerkTokenError}. Only RS256 is accepted (Clerk's algorithm) —
 * this also blocks `alg: none` and algorithm-confusion attacks.
 */
export async function verifyClerkToken(
  token: string,
  opts: VerifyClerkTokenOptions,
): Promise<VerifiedPrincipal> {
  if (!token || typeof token !== "string") {
    throw new ClerkTokenError("missing token");
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, opts.getKey, {
      issuer: opts.issuer,
      audience: opts.audience,
      clockTolerance: opts.clockToleranceSec ?? 0,
      algorithms: ["RS256"],
    }));
  } catch (err) {
    throw new ClerkTokenError("token verification failed", err);
  }

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new ClerkTokenError("token has no subject (sub) claim");
  }

  return { clerkUserId: sub, claims: payload };
}
