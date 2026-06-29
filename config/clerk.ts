// Public Clerk verification config, read SERVER-SIDE only.
//
// None of these are secrets: the issuer is your Clerk Frontend API origin and
// the JWKS is published publicly by Clerk. They must NOT be exposed to the
// browser via NEXT_PUBLIC_* (the secret-scan step guards that). Token
// verification needs only these public values — never the Clerk secret key.

export interface ClerkVerificationConfig {
  /** Clerk Frontend API origin, e.g. https://your-app.clerk.accounts.dev */
  issuer: string;
  /** Clerk JWKS endpoint (defaults to `${issuer}/.well-known/jwks.json`). */
  jwksUrl: string;
}

/**
 * Read and validate the Clerk verification config from the environment.
 * Throws (fail fast at startup) if the issuer is missing.
 */
export function readClerkVerificationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ClerkVerificationConfig {
  const issuer = env.CLERK_JWT_ISSUER?.trim();
  if (!issuer) {
    throw new Error("CLERK_JWT_ISSUER is not set (Clerk Frontend API origin).");
  }
  const jwksUrl = env.CLERK_JWKS_URL?.trim() || `${issuer}/.well-known/jwks.json`;
  return { issuer, jwksUrl };
}
