import "server-only";

import { isEmailTemplate, renderEmail, type EmailPayloads, type EmailTemplate } from "@/core";
import { isEmailConfigured } from "@/config/email";
import { sendEmail } from "@/lib/email/client";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Drain the email outbox: claim a batch, render each in core, send via the
 * provider, record the result. The same enqueue -> claim -> send -> record
 * shape as the payout worker (0024).
 *
 * Best-effort by construction. The dispatcher never throws to its caller: a
 * business action enqueues transactionally and then asks the dispatcher to try
 * sending, but a provider outage must never turn a successful application into
 * an error. Anything unsent simply stays in the outbox for the next drain (the
 * `send-emails` script, or the next form submission).
 */
export interface DispatchOutcome {
  key: string;
  result: "sent" | "failed" | "skipped";
  detail: string;
}

interface OutboxRow {
  template: string;
  recipient_email: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
}

export async function dispatchEmails(limit = 20): Promise<DispatchOutcome[]> {
  // Email switched off is a valid state (see config/email.ts). Leave the queue
  // untouched so it drains once a key is set, rather than failing every row.
  if (!isEmailConfigured()) return [];

  const admin = createAdminSupabaseClient();

  const { data, error } = await admin.rpc("claim_emails", { p_limit: limit });
  if (error) {
    // Could not even claim — nothing was sent, nothing was consumed. Report,
    // don't throw: the caller is a form submission, not a mail server.
    return [{ key: "-", result: "skipped", detail: `could not claim: ${error.message}` }];
  }

  const claimed = (data ?? []) as OutboxRow[];
  const outcomes: DispatchOutcome[] = [];

  for (const row of claimed) {
    if (!isEmailTemplate(row.template)) {
      await admin.rpc("record_email_result", {
        p_idempotency_key: row.idempotency_key,
        p_status: "FAILED",
        p_failure_reason: `unknown template: ${row.template}`,
      });
      outcomes.push({ key: row.idempotency_key, result: "failed", detail: "unknown template" });
      continue;
    }

    try {
      const template = row.template as EmailTemplate;
      const rendered = renderEmail(template, row.payload as EmailPayloads[typeof template]);
      const { id } = await sendEmail({
        to: row.recipient_email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await admin.rpc("record_email_result", {
        p_idempotency_key: row.idempotency_key,
        p_status: "SENT",
        p_provider_ref: id,
      });
      outcomes.push({ key: row.idempotency_key, result: "sent", detail: id });
    } catch (e) {
      const detail = e instanceof Error ? e.message : "unknown error";
      // Left FAILED, which claim_emails re-claims: a duplicate email is
      // low-stakes, so retrying beats stranding an unsent acknowledgement.
      await admin.rpc("record_email_result", {
        p_idempotency_key: row.idempotency_key,
        p_status: "FAILED",
        p_failure_reason: detail,
      });
      outcomes.push({ key: row.idempotency_key, result: "failed", detail });
    }
  }

  return outcomes;
}

/**
 * Fire the dispatcher from inside a request without letting it affect the
 * response. Use this right after a business action that enqueued an email: the
 * acknowledgement goes out in the same request when the provider is healthy,
 * and on any failure the row simply waits in the outbox. Never throws.
 */
export async function flushEmailsBestEffort(): Promise<void> {
  try {
    await dispatchEmails();
  } catch {
    // The outbox is durable; a failed flush loses nothing. Never surface this
    // to a user who just submitted a form successfully.
  }
}
