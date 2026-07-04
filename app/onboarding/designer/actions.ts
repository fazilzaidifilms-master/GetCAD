"use server";

import { revalidatePath } from "next/cache";

import { generateId } from "@/core";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Apply to become a designer. The DB function is the source of truth (audited
 * DESIGNER_APPLIED, sets role DESIGNER / status PENDING). Identity comes from the
 * verified token inside the function — nothing here is trusted from the client.
 */
export async function applyAsDesignerAction(formData: FormData): Promise<void> {
  const legalName = formData.get("legal_name")?.toString().trim() ?? "";
  const email = formData.get("email")?.toString().trim() ?? "";
  const country = formData.get("country")?.toString().trim() || null;
  if (!legalName || !email) throw new Error("legal name and email are required");

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("apply_as_designer", {
    p_profile_id: generateId(),
    p_legal_name: legalName,
    p_email: email,
    p_country: country,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/onboarding/designer");
}

/**
 * Sign the current designer agreement. We pass back the fingerprint of the exact
 * text we showed; the DB rejects it if the current document changed since load
 * (so you can never sign something you didn't see). Records an immutable
 * signature + SIGNED_AGREEMENT audit entry, and flips the designer to ACTIVE.
 */
export async function signAgreementAction(formData: FormData): Promise<void> {
  const expectedSha256 = formData.get("expected_sha256")?.toString() ?? "";
  if (!expectedSha256) throw new Error("missing document fingerprint");

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("accept_designer_agreement", {
    p_expected_sha256: expectedSha256,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/onboarding/designer");
  revalidatePath("/orders");
}
