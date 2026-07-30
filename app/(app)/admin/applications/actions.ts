"use server";

import { revalidatePath } from "next/cache";

import { flushEmailsBestEffort } from "@/lib/email/dispatch";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export type ReviewResult = { ok: true } | { ok: false; error: string };

/**
 * Record a review decision on a designer application.
 *
 * Authorization lives in the DB function (`review_designer_application` refuses
 * anyone but OPS/SALES via app.require_triage_staff), reached through the
 * user-scoped client so the caller's verified role is what's checked. Accepting
 * does not create a designer account — it records a decision.
 */
export async function reviewApplicationAction(formData: FormData): Promise<ReviewResult> {
  const id = formData.get("id")?.toString() ?? "";
  const decision = formData.get("decision")?.toString() ?? "";
  const notes = formData.get("notes")?.toString() ?? "";
  if (!id || !decision) return { ok: false, error: "Missing application or decision." };

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("review_designer_application", {
    p_id: id,
    p_decision: decision,
    p_notes: notes.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  // An accept/reject enqueued a decision email in the same transaction; send it
  // now, best-effort. Never blocks or fails the review.
  await flushEmailsBestEffort();

  revalidatePath("/admin/applications");
  return { ok: true };
}
