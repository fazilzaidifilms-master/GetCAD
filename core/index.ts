// Public surface of the framework-agnostic core.
// NOTHING here may import next/* or react (enforced by the boundary lint rule).
export { generateId, isOpaqueId, ID_LENGTH, ID_PATTERN } from "./ids/generateId";
export {
  verifyClerkToken,
  clerkRemoteKeySet,
  ClerkTokenError,
} from "./auth/verifyClerkToken";
export type {
  VerifiedPrincipal,
  VerifyClerkTokenOptions,
} from "./auth/verifyClerkToken";
export { isProtectedPath, PROTECTED_PREFIXES } from "./auth/session";
