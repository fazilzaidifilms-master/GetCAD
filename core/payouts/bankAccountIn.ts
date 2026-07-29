/**
 * Validation and masking for Indian bank payout identity (the IMPS/NEFT rail).
 *
 * WHY THIS IS A CORE MODULE AND NOT A ZOD SCHEMA
 *
 * These rules are enforced in three places that must never disagree: the form
 * the designer fills in, the Server Action that receives it, and the CHECK
 * constraints on `payout_accounts`. If the browser accepts a PAN the database
 * rejects, the designer gets a raw Postgres error. If the database accepts one
 * the processor rejects, we discover it at payout time — with money already
 * released and a person waiting to be paid. So the shapes live here, in one
 * framework-free place, and everything else quotes them.
 *
 * SCOPE: India only, deliberately. An IFSC is meaningless outside India, and a
 * SWIFT/IBAN rail has a different shape entirely. Rather than build a vague
 * "international" abstraction nobody has requirements for yet, this module is
 * honestly named and the table carries a country tripwire (see 0023) so the
 * first non-Indian designer forces the conversation instead of silently
 * storing an IFSC-shaped nothing.
 *
 * NOTHING HERE EVER LOGS OR RETURNS A FULL ACCOUNT NUMBER OR PAN. The mask
 * helpers are the only sanctioned way to put either in front of a human.
 */

/** Permanent Account Number: 5 letters, 4 digits, 1 letter. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Indian Financial System Code: 4-letter bank code, a reserved '0', then a
 * 6-character branch code. The zero in position 5 is fixed by RBI, which makes
 * it a cheap, high-value typo check.
 */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers vary by bank; 9-18 digits covers every scheme. */
export const ACCOUNT_NUMBER_PATTERN = /^[0-9]{9,18}$/;

export const ACCOUNT_TYPES = ["SAVINGS", "CURRENT"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * The 4th character of a PAN encodes what kind of entity holds it. We report
 * it but deliberately DO NOT gate on it: the published list has grown over the
 * years, and rejecting a valid PAN because our table is stale would block a
 * real designer from being paid. Shape validation catches typos; this is
 * context for a human reviewer.
 */
const PAN_HOLDER_TYPES: Record<string, string> = {
  P: "Individual",
  C: "Company",
  H: "Hindu Undivided Family",
  F: "Firm / LLP",
  A: "Association of Persons",
  T: "Trust",
  B: "Body of Individuals",
  L: "Local Authority",
  J: "Artificial Juridical Person",
  G: "Government",
};

/** Uppercase and strip all whitespace. Users paste these with spaces in them. */
function squash(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function normalizePan(raw: string): string {
  return squash(raw);
}

export function normalizeIfsc(raw: string): string {
  return squash(raw);
}

/** Account numbers are commonly written with spaces or hyphens in groups. */
export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/[\s-]+/g, "");
}

export function isValidPan(raw: string): boolean {
  return PAN_PATTERN.test(normalizePan(raw));
}

export function isValidIfsc(raw: string): boolean {
  return IFSC_PATTERN.test(normalizeIfsc(raw));
}

export function isValidAccountNumber(raw: string): boolean {
  return ACCOUNT_NUMBER_PATTERN.test(normalizeAccountNumber(raw));
}

/** Human-readable entity type for a PAN, or null if the shape is wrong. */
export function panHolderType(raw: string): string | null {
  const pan = normalizePan(raw);
  if (!PAN_PATTERN.test(pan)) return null;
  return PAN_HOLDER_TYPES[pan.charAt(3)] ?? "Unknown";
}

const DOT = "•";

/**
 * Show enough for the owner to recognise their own account, and no more.
 * Same principle as a card's last four: recognition, not reconstruction.
 */
export function maskAccountNumber(raw: string): string {
  const acct = normalizeAccountNumber(raw);
  if (acct.length <= 4) return DOT.repeat(acct.length);
  return DOT.repeat(Math.min(acct.length - 4, 10)) + acct.slice(-4);
}

export function maskPan(raw: string): string {
  const pan = normalizePan(raw);
  if (pan.length <= 4) return DOT.repeat(pan.length);
  return DOT.repeat(pan.length - 4) + pan.slice(-4);
}

/**
 * Render a mask when the last four are ALL we hold.
 *
 * The read path (my_payout_account) deliberately returns fragments, so the UI
 * never has a full value to mask. Passing a bare "9012" to maskAccountNumber
 * would correctly refuse to reveal a 4-character secret and render "••••" —
 * hiding the very digits meant to be shown. This is the display path for
 * already-truncated values.
 */
export function maskFromLast4(last4: string, dots = 6): string {
  return DOT.repeat(Math.max(0, dots)) + last4;
}

export interface BankAccountInput {
  beneficiaryName: string;
  pan: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
  accountType: string;
}

export interface NormalizedBankAccount {
  beneficiaryName: string;
  pan: string;
  accountNumber: string;
  ifsc: string;
  accountType: AccountType;
}

export type BankAccountErrors = Partial<Record<keyof BankAccountInput, string>>;

/**
 * Validate and normalize in one pass, returning per-field messages.
 *
 * `confirmAccountNumber` is not paranoia: a mistyped account number is the one
 * error in this form that cannot be detected by shape, cannot be recovered by
 * us, and sends real money to a stranger. Every other field either has a
 * checkable pattern or fails harmlessly.
 */
export function validateBankAccount(
  input: BankAccountInput,
): { ok: true; value: NormalizedBankAccount } | { ok: false; errors: BankAccountErrors } {
  const errors: BankAccountErrors = {};

  const beneficiaryName = input.beneficiaryName.trim().replace(/\s+/g, " ");
  if (beneficiaryName.length < 2) {
    errors.beneficiaryName = "Enter the account holder's name as it appears at the bank.";
  } else if (beneficiaryName.length > 120) {
    errors.beneficiaryName = "Name must be 120 characters or fewer.";
  }

  const pan = normalizePan(input.pan);
  if (!PAN_PATTERN.test(pan)) {
    errors.pan = "A PAN is 10 characters: five letters, four digits, one letter (e.g. ABCDE1234F).";
  }

  const accountNumber = normalizeAccountNumber(input.accountNumber);
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    errors.accountNumber = "An account number is 9 to 18 digits, with no letters.";
  }

  const confirm = normalizeAccountNumber(input.confirmAccountNumber);
  if (confirm !== accountNumber) {
    errors.confirmAccountNumber = "The two account numbers don't match.";
  }

  const ifsc = normalizeIfsc(input.ifsc);
  if (!IFSC_PATTERN.test(ifsc)) {
    errors.ifsc = "An IFSC is 11 characters: four letters, a zero, then six more (e.g. HDFC0001234).";
  }

  const accountType = input.accountType as AccountType;
  if (!ACCOUNT_TYPES.includes(accountType)) {
    errors.accountType = "Choose Savings or Current.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { beneficiaryName, pan, accountNumber, ifsc, accountType } };
}
