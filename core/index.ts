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
export { tabsForRole, activeTabKey } from "./nav/tabs";
export type { Tab } from "./nav/tabs";
export { orderActions, primaryAction } from "./orders/actions";
export type { OrderAction, ActionIntent } from "./orders/actions";
export {
  mmToMicrons,
  micronsToMm,
  caratToMct,
  mctToCarat,
  formatMm,
  formatCarat,
  estimateMct,
  estimateDiameterUm,
  specProblems,
  specIsComplete,
} from "./orders/spec";
export type { OrderSpecInput, SpecProblem } from "./orders/spec";
export {
  decimate,
  decimateUntilSafe,
  previewIsSafe,
  bounds,
  longestExtent,
  DEFAULT_GRID_DIVISIONS,
  MAX_PREVIEW_TRIANGLES,
  MIN_REDUCTION_RATIO,
} from "./preview/decimate";
export type { Mesh, DecimateResult } from "./preview/decimate";
export { fileGrantFor, grantExplanation } from "./files/downloadGate";
export type { FileGrant, DownloadContext } from "./files/downloadGate";
export { pinFromTap, pinStyle, pinProblems, crowdedPairs, BP_MAX } from "./orders/pins";
export type { Pin } from "./orders/pins";
export { gradeBrief, qualitySummary } from "./orders/briefQuality";
export type { BriefQuality, BriefGap, BriefGrade, BriefContext, GapSeverity } from "./orders/briefQuality";
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
export { renderEmail, isEmailTemplate, EMAIL_TEMPLATES } from "./email/templates";
export type { EmailTemplate, EmailPayloads, RenderedEmail } from "./email/templates";
// NOT re-exported here on purpose: core/payments/razorpaySignature imports
// node:crypto, and middleware.ts imports this barrel while running on the EDGE
// runtime, which has no node builtins. Pulling it in here breaks the build.
// Server-side callers import it directly from core/payments/razorpaySignature.
