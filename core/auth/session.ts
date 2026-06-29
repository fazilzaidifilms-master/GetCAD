/**
 * Pure route-protection logic, shared by the Next.js middleware.
 *
 * Kept in `core/` (framework-free) so the single most security-relevant
 * decision in the app — "does this path require a logged-in user?" — is plain,
 * testable logic rather than something buried in middleware glue. The middleware
 * imports this; the test exercises the exact same function.
 */

/** Path prefixes that require an authenticated session. */
export const PROTECTED_PREFIXES = ["/dashboard"] as const;

/** True if `pathname` is behind auth. Matches a prefix exactly or as a segment. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}
