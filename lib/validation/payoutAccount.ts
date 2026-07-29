// Shared Zod schema for the payout account form — imported by both the client
// form (react-hook-form resolver) and the server action (defence-in-depth
// re-validation before the DB call).
//
// The SHAPES are not defined here. They come from core/payouts/bankAccountIn,
// which is the same module the database constraints in 0023 were written from.
// Zod's job in this file is field-level messaging and cross-field checks, not
// deciding what a PAN looks like — that decision lives in exactly one place.

import { z } from "zod";

import {
  ACCOUNT_NUMBER_PATTERN,
  ACCOUNT_TYPES,
  IFSC_PATTERN,
  PAN_PATTERN,
  normalizeAccountNumber,
  normalizeIfsc,
  normalizePan,
} from "@/core";

export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  SAVINGS: "Savings",
  CURRENT: "Current",
};

export const payoutAccountSchema = z
  .object({
    beneficiaryName: z
      .string()
      .trim()
      .min(2, "Enter the account holder's name as it appears at the bank")
      .max(120, "Name is too long")
      // Collapse internal runs of whitespace, matching the DB's normalization.
      .transform((v) => v.replace(/\s+/g, " ")),

    pan: z
      .string()
      .transform(normalizePan)
      .refine((v) => PAN_PATTERN.test(v), {
        message: "A PAN is five letters, four digits, then one letter (e.g. ABCDE1234F)",
      }),

    accountNumber: z
      .string()
      .transform(normalizeAccountNumber)
      .refine((v) => ACCOUNT_NUMBER_PATTERN.test(v), {
        message: "An account number is 9 to 18 digits, with no letters",
      }),

    confirmAccountNumber: z.string().transform(normalizeAccountNumber),

    ifsc: z
      .string()
      .transform(normalizeIfsc)
      .refine((v) => IFSC_PATTERN.test(v), {
        message: "An IFSC is four letters, a zero, then six more (e.g. HDFC0001234)",
      }),

    accountType: z.enum(ACCOUNT_TYPES, "Choose Savings or Current"),
  })
  .superRefine((data, ctx) => {
    // A mistyped account number is the only error on this form that has no
    // shape to catch it and no way for us to recover the money afterwards.
    if (data.accountNumber !== data.confirmAccountNumber) {
      ctx.addIssue({
        code: "custom",
        message: "The two account numbers don't match",
        path: ["confirmAccountNumber"],
      });
    }
  });

export type PayoutAccountInput = z.input<typeof payoutAccountSchema>;
export type PayoutAccountFields = z.output<typeof payoutAccountSchema>;

/** What my_payout_account() returns — display fragments only, never secrets. */
export interface PayoutAccountSummary {
  beneficiary_name: string;
  pan_last4: string;
  account_last4: string;
  ifsc: string;
  account_type: string;
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
  rejection_reason: string | null;
  updated_at: string;
}

export const PAYOUT_STATUS_LABELS: Record<PayoutAccountSummary["status"], string> = {
  PENDING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  REJECTED: "Needs attention",
};
