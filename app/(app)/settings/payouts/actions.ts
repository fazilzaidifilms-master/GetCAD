"use server";

import { revalidatePath } from "next/cache";

import { payoutAccountSchema } from "@/lib/validation/payoutAccount";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export type PayoutActionResult = { ok: true } | { ok: false; error: string };

/**
 * Record where this user's payouts should go.
 *
 * The DB function is the source of truth: it takes NO user id, so identity
 * comes from the verified token inside the function and there is no argument a
 * caller could tamper with to redirect someone else's money. This action
 * re-validates with the shared schema first so a malformed submission fails
 * with a field message instead of a raw Postgres error.
 *
 * NOTE ON LOGGING: nothing in this file logs the submitted values. The account
 * number and PAN must not reach a server log, an error tracker, or a revalidate
 * trace — `error.message` from the RPC is safe because upsert_payout_account
 * raises only field names, never values.
 */
export async function savePayoutAccountAction(formData: FormData): Promise<PayoutActionResult> {
  const parsed = payoutAccountSchema.safeParse({
    beneficiaryName: formData.get("beneficiaryName")?.toString() ?? "",
    pan: formData.get("pan")?.toString() ?? "",
    accountNumber: formData.get("accountNumber")?.toString() ?? "",
    confirmAccountNumber: formData.get("confirmAccountNumber")?.toString() ?? "",
    ifsc: formData.get("ifsc")?.toString() ?? "",
    accountType: formData.get("accountType")?.toString() ?? "",
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("upsert_payout_account", {
    p_beneficiary_name: parsed.data.beneficiaryName,
    p_pan: parsed.data.pan,
    p_account_number: parsed.data.accountNumber,
    p_ifsc: parsed.data.ifsc,
    p_account_type: parsed.data.accountType,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/payouts");
  return { ok: true };
}
