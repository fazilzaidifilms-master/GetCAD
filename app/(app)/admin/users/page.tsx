import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { partyLabel } from "@/components/domain";
import { ErrorPanel } from "@/components/error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { setUserRoleAction, setUserStatusAction } from "./actions";

/**
 * Access control — who is on the platform and what they may do.
 *
 * Before this, the only way to make someone OPS was an UPDATE in the Supabase
 * SQL editor. That is fine for the first account and wrong for every one after
 * it: no record of who granted what, and the most privilege-sensitive action in
 * the product happening in a tool that will just as happily drop a table.
 *
 * IDS, NOT NAMES. The table shows opaque account references and nothing else —
 * no email, no name. Changing a role does not require knowing which jeweller is
 * which, and this product's premise is that identity does not travel further
 * than it has to. The account screen tells each person their own reference and
 * to quote it; that is how a support request gets matched to a row here.
 *
 * The order counts are there so nobody flips a role blind. A designer with live
 * work is not someone to move to CLIENT without thinking about what happens to
 * those orders.
 */
export const dynamic = "force-dynamic";

const ROLES = ["CLIENT", "DESIGNER", "OPS", "SALES", "FINANCE", "QC"] as const;

interface PlatformUser {
  id: string;
  role: string;
  status: string;
  created_at: string;
  orders_as_client: number;
  orders_as_designer: number;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { q, role: roleFilter } = await searchParams;

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const { data, error } = await supabase.rpc("list_platform_users", {
    p_search: q ?? null,
    p_role: roleFilter && roleFilter !== "ALL" ? roleFilter : null,
  });

  // The database refuses non-OPS callers. Rendering its message rather than a
  // generic "forbidden" means a SALES member reading this knows why, and knows
  // it is not a bug.
  if (error) {
    return (
      <main className="container max-w-3xl py-8">
        <h1 className="text-[length:var(--fs-6)] font-semibold tracking-[var(--ls-6)]">Access</h1>
        <ErrorPanel title="Not available to your role" message={error.message} className="mt-4" />
        <Link href="/admin" className="mt-4 inline-block text-sm text-primary hover:underline">
          Back to the queue
        </Link>
      </main>
    );
  }

  const users = (data ?? []) as PlatformUser[];

  return (
    <main className="container max-w-4xl py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
          Access
        </h1>
        <Link href="/admin" className="text-sm text-primary hover:underline">
          Back to the queue
        </Link>
      </div>
      <p className="mt-2 text-[length:var(--fs-4)] leading-[var(--lh-4)] text-muted-foreground">
        Every account on the platform. Roles decide what each person sees; the database enforces it
        either way, so a change here takes effect on their next page load.
      </p>

      {/* GET, not a Server Action: a filter belongs in the URL so it can be
          bookmarked, shared with another staff member, and survives a refresh. */}
      <form method="GET" className="mt-6 flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Account reference…"
          aria-label="Search by account reference"
          className="max-w-xs"
        />
        <select
          name="role"
          defaultValue={roleFilter ?? "ALL"}
          aria-label="Filter by role"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="ALL">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {partyLabel(r)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </form>

      <div className="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-border bg-card">
        {users.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No accounts match. {q ? "Try a shorter reference." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="tabular break-all font-mono text-[length:var(--fs-2)] text-muted-foreground">
                      {u.id}
                      {u.id === userId ? (
                        <span className="ml-2 font-sans not-italic text-foreground">(you)</span>
                      ) : null}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="muted">{partyLabel(u.role)}</Badge>
                      <Badge variant={u.status === "ACTIVE" ? "default" : "muted"}>
                        {u.status === "ACTIVE"
                          ? "Active"
                          : u.status === "SUSPENDED"
                            ? "Suspended"
                            : "Pending"}
                      </Badge>
                      <span className="text-[length:var(--fs-2)] text-muted-foreground">
                        {u.orders_as_client} placed · {u.orders_as_designer} worked
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setUserRoleAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="user_id" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        aria-label={`Role for ${u.id}`}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {partyLabel(r)}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="sm">
                        Set role
                      </Button>
                    </form>

                    {/* Suspend, never delete: orders, escrow rows and audit
                        entries reference this account, and a platform that can
                        erase a counterparty cannot answer a dispute. */}
                    <form action={setUserStatusAction}>
                      <input type="hidden" name="user_id" value={u.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={u.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"}
                      />
                      <Button
                        type="submit"
                        variant={u.status === "SUSPENDED" ? "outline" : "destructive"}
                        size="sm"
                      >
                        {u.status === "SUSPENDED" ? "Reinstate" : "Suspend"}
                      </Button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-[length:var(--fs-2)] text-muted-foreground">
        Every change is written to the audit log with the account that made it. The last active OPS
        account cannot be demoted or suspended — promote someone else first.
      </p>
    </main>
  );
}
