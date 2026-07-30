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
export { isStaffRole, STAFF_ROLES } from "./auth/roles";
export type { StaffRole } from "./auth/roles";
export { availableTransitions } from "./orders/availableTransitions";
export type { TransitionRow, ActorContext } from "./orders/availableTransitions";
export { ORDER_STATUS_META, statusMeta } from "./orders/status";
export type { StatusTone, StatusMeta } from "./orders/status";
export { buildTimeline } from "./orders/timeline";
export type { TimelineRawRow, TimelineStep, QcOutcome } from "./orders/timeline";
export {
  sanitizeUpload,
  MAX_UPLOAD_BYTES,
  DEFAULT_ALLOWLIST,
  DELIVERABLE_ALLOWLIST,
} from "./files/sanitizationGate";
export {
  stripMetadata,
  stripPng,
  stripJpeg,
  stripStep,
  STRIPPABLE_TYPES,
} from "./files/metadataStripper";
export type { StripResult } from "./files/metadataStripper";
export type {
  IncomingFile,
  SanitizedFile,
  GateResult,
  GateOptions,
} from "./files/sanitizationGate";
export { escrowSign, netHeld, ESCROW_KINDS } from "./money/escrowSign";
export type { EscrowKind } from "./money/escrowSign";
export {
  validateBankAccount,
  normalizePan,
  normalizeIfsc,
  normalizeAccountNumber,
  isValidPan,
  isValidIfsc,
  isValidAccountNumber,
  panHolderType,
  maskAccountNumber,
  maskFromLast4,
  maskPan,
  ACCOUNT_TYPES,
  PAN_PATTERN,
  IFSC_PATTERN,
  ACCOUNT_NUMBER_PATTERN,
} from "./payouts/bankAccountIn";
export type {
  AccountType,
  BankAccountInput,
  BankAccountErrors,
  NormalizedBankAccount,
} from "./payouts/bankAccountIn";
// NOT re-exported here on purpose: core/payments/razorpaySignature imports
// node:crypto, and middleware.ts imports this barrel while running on the EDGE
// runtime, which has no node builtins. Pulling it in here breaks the build.
// Server-side callers import it directly from core/payments/razorpaySignature.
