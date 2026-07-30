import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { LeadControls } from "./LeadControls";

export const dynamic = "force-dynamic";

interface LeadRow {
  id: string;
  name: string;
  company: string | null;
  email: string;
  role: string;
  message: string;
  status: string;
  handled_at: string | null;
  created_at: string;
}

const FILTERS = [
  { key: "NEW", label: "New" },
  { key: "HANDLED", label: "Handled" },
  { key: "", label: "All" },
] as const;

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const status = (await searchParams).status ?? "NEW";

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const { data, error } = await supabase.rpc("list_marketing_leads", {
    p_status: status === "" ? null : status,
  });

  if (error) {
    const denied = /only OPS or SALES/i.test(error.message);
    return (
      <main className="container max-w-2xl py-12">
        <h1 className="text-xl font-semibold tracking-tight">Contact leads</h1>
        <div className="mt-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {denied
            ? "This inbox is for OPS and SALES. Switch to one of those roles to work leads."
            : `Couldn't load leads: ${error.message}`}
        </div>
      </main>
    );
  }

  const leads = (data ?? []) as LeadRow[];

  return (
    <main className="container max-w-3xl py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Contact leads</h1>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          Staff console →
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <Link
              key={f.key || "all"}
              href={`/admin/leads${f.key ? `?status=${f.key}` : "?status="}`}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {leads.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-10 text-center">
          <p className="text-sm font-medium">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">No leads in this state.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {leads.map((lead) => (
            <li key={lead.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {lead.name}
                    {lead.company && <span className="text-muted-foreground"> · {lead.company}</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <a className="underline underline-offset-2" href={`mailto:${lead.email}`}>
                      {lead.email}
                    </a>{" "}
                    · {lead.role.toLowerCase()} · {when(lead.created_at)}
                  </p>
                </div>
                <Badge variant={lead.status === "HANDLED" ? "muted" : "outline"}>
                  {lead.status.toLowerCase()}
                </Badge>
              </div>

              <p className="mt-3 whitespace-pre-wrap break-words text-sm">{lead.message}</p>

              <div className="mt-3">
                <LeadControls id={lead.id} status={lead.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
