"use server";

import { redirect } from "next/navigation";

import { flushEmailsBestEffort } from "@/lib/email/dispatch";
import { CONTACT_LIMIT, checkRateLimit } from "@/lib/rateLimit";
import { createUserSupabaseClient } from "@/lib/supabase/server";

// Works for signed-out visitors too: createUserSupabaseClient() attaches a
// Clerk token only if one exists, and falls back to the anon role otherwise —
// exactly the role submit_marketing_lead() is granted to.
export async function submitLeadAction(formData: FormData): Promise<void> {
  const name = formData.get("name")?.toString().trim() ?? "";
  const company = formData.get("company")?.toString().trim() || null;
  const email = formData.get("email")?.toString().trim() ?? "";
  const role = formData.get("role")?.toString() || "BUSINESS";
  const message = formData.get("message")?.toString().trim() ?? "";

  const allowed = await checkRateLimit(
    CONTACT_LIMIT.scope,
    CONTACT_LIMIT.max,
    CONTACT_LIMIT.windowSeconds,
  );
  if (!allowed) {
    throw new Error("Too many submissions from this network. Please try again later.");
  }

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("submit_marketing_lead", {
    p_name: name,
    p_email: email,
    p_message: message,
    p_company: company,
    p_role: role,
  });
  if (error) throw new Error(error.message);

  // The DB enqueued a "we received your message" email in the same
  // transaction; send it now, best-effort. Must run before redirect(), which
  // throws internally to perform the navigation.
  await flushEmailsBestEffort();

  redirect("/contact?submitted=1");
}
