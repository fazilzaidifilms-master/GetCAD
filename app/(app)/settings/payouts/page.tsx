import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { maskFromLast4 } from "@/core";
import { formatMoney } from "@/lib/money";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import {
  ACCOUNT_TYPE_LABELS,
  PAYOUT_STATUS_LABELS,
  type PayoutAccountSummary,
} from "@/lib/validation/payoutAccount";

import { PayoutAccountForm } from "./PayoutAccountForm";

export const dynamic = "force-dynamic";

interface PayoutRow {
  order_id: string;
  party: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
}

/**
 * Payee-facing wording. Deliberately not the raw state machine: "PROCESSING"
 * means something precise to us and nothing reassuring to someone waiting for
 * money.
 */
const PAYOUT_PROGRESS_LABELS: Record<string, string> = {
  PENDING: "Queued",
  PROCESSING: "On its way",
  PAID: "Sent",
  FAILED: "Couldn't be sent",
  REVERSED: "Returned to us",
};

const STATUS_TONE: Record<PayoutAccountSummary["status"], "muted" | "outline"> = {
  PENDING_VERIFICATION: "outline",
  VERIFIED: "muted",
  REJECTED: "outline",
};

export default async function PayoutSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();

  const { data: me } = await supabase.from("users").select("id, role, status").maybeSingle();
  // Only roles that actually receive escrow releases have a payout account.
  // A client landing here is a wrong turn, not an error.
  if (me && me.role !== "DESIGNER" && me.role !== "QC") redirect("/dashboard");

  // The raw table is unreadable by design (policies/0019). This function is the
  // only read path, and it returns display fragments — never the full account
  // number or PAN.
  const [{ data, error }, { data: payoutData }] = await Promise.all([
    supabase.rpc("my_payout_account"),
    // Amounts and states only — my_payouts() deliberately returns no processor
    // references and no destination account.
    supabase.rpc("my_payouts", { p_limit: 20 }),
  ]);
  const account = (data ?? null) as PayoutAccountSummary | null;
  const payouts = (payoutData ?? []) as PayoutRow[];

  return (
    <main className="container max-w-2xl py-8">
      <h1 className="text-xl font-semibold tracking-tight">Payout account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Where we send your earnings once an order is closed and released. Your bank details are
        never shown to clients and are not stored with your order history.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your payout account: {error.message}
        </div>
      )}

      {account && (
        <section className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)]">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">On file</p>
            <Badge variant={STATUS_TONE[account.status]}>
              {PAYOUT_STATUS_LABELS[account.status]}
            </Badge>
          </div>

          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Account holder</dt>
              <dd className="mt-0.5">{account.beneficiary_name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Account</dt>
              {/* The server returns only the last four — never the full
                  number — so this masks a fragment, not a secret. */}
              <dd className="tabular mt-0.5 font-mono">
                {maskFromLast4(account.account_last4)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">IFSC</dt>
              <dd className="tabular mt-0.5 font-mono">{account.ifsc}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Type</dt>
              <dd className="mt-0.5">
                {ACCOUNT_TYPE_LABELS[account.account_type as keyof typeof ACCOUNT_TYPE_LABELS] ??
                  account.account_type}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">PAN</dt>
              <dd className="tabular mt-0.5 font-mono">{maskFromLast4(account.pan_last4)}</dd>
            </div>
          </dl>

          {account.status === "PENDING_VERIFICATION" && (
            <p className="mt-3 text-xs text-muted-foreground">
              We&apos;re confirming these details with our payment processor. Payouts are released
              once that completes.
            </p>
          )}
          {account.status === "REJECTED" && account.rejection_reason && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {account.rejection_reason}
            </div>
          )}
        </section>
      )}

      <section className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)]">
        <p className="text-sm font-medium">{account ? "Update your details" : "Add your details"}</p>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          These must match your bank exactly. A mismatch between the name, account number and IFSC
          is the most common reason a payout fails.
        </p>
        <PayoutAccountForm hasExisting={Boolean(account)} />
      </section>

      {payouts.length > 0 && (
        <section className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)]">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">Your payouts</p>
          </div>
          <ul className="divide-y divide-border">
            {payouts.map((p, i) => (
              <li key={`${p.order_id}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="tabular hidden font-mono text-xs text-muted-foreground sm:inline">
                  {p.order_id.slice(0, 10)}…
                </span>
                <span className="tabular ml-auto font-mono font-medium">
                  {formatMoney(p.amount, p.currency)}
                </span>
                <Badge variant={p.status === "PAID" ? "muted" : "outline"}>
                  {PAYOUT_PROGRESS_LABELS[p.status] ?? p.status}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            A payout is sent once an order closes and finance releases it. Settlement to your bank
            usually takes a further working day or two.
          </p>
        </section>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        We currently pay Indian bank accounts only. If you bank outside India, tell us — we&apos;ll
        let you know when international payouts are available.
      </p>
    </main>
  );
}
