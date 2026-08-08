import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DESIGNER_APPLICATION_FILES_BUCKET } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { ReviewControls } from "./ReviewControls";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 300; // 5 minutes — long enough to open, short enough to expire

interface ApplicationRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  country: string;
  years_experience: number;
  primary_software: string;
  categories: string[];
  portfolio_url: string | null;
  portfolio_file_keys: string[] | null;
  status: string;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const FILTERS = [
  { key: "PENDING_REVIEW", label: "To review" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "REJECTED", label: "Rejected" },
  { key: "", label: "All" },
] as const;

const STATUS_TONE: Record<string, "muted" | "outline"> = {
  PENDING_REVIEW: "outline",
  ACCEPTED: "muted",
  REJECTED: "outline",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const status = (await searchParams).status ?? "PENDING_REVIEW";

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  // Authorization is enforced inside the function (OPS/SALES only); a refusal
  // comes back as an error we render as "not authorized", not a crash.
  const { data, error } = await supabase.rpc("list_designer_applications", {
    p_status: status === "" ? null : status,
  });

  if (error) {
    const denied = /only OPS or SALES/i.test(error.message);
    return (
      <main className="container max-w-2xl py-12">
        <h1 className="text-xl font-semibold tracking-tight">Designer applications</h1>
        <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)] text-sm text-muted-foreground">
          {denied
            ? "This inbox is for OPS and SALES. Switch to one of those roles to review applications."
            : `Couldn't load applications: ${error.message}`}
        </div>
      </main>
    );
  }

  const applications = (data ?? []) as ApplicationRow[];

  // Portfolio files live in a private bucket. Mint short-lived signed URLs
  // server-side (service role) so a reviewer can open them without the objects
  // ever being public.
  const admin = createAdminSupabaseClient();
  const fileLinks = new Map<string, { name: string; url: string }[]>();
  for (const app of applications) {
    if (!app.portfolio_file_keys?.length) continue;
    const links: { name: string; url: string }[] = [];
    for (const key of app.portfolio_file_keys) {
      const signed = await admin.storage
        .from(DESIGNER_APPLICATION_FILES_BUCKET)
        .createSignedUrl(key, SIGNED_URL_TTL);
      if (signed.data?.signedUrl) {
        links.push({ name: key.split("/").pop() ?? "file", url: signed.data.signedUrl });
      }
    }
    fileLinks.set(app.id, links);
  }

  return (
    <main className="container max-w-3xl py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Designer applications</h1>
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
              href={`/admin/applications${f.key ? `?status=${f.key}` : "?status="}`}
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

      {applications.length === 0 ? (
        <div className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-10)] text-center">
          <p className="text-sm font-medium">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">No applications in this state.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {applications.map((app) => (
            <li key={app.id} className="rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)]">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="font-medium">{app.full_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {app.country} · {app.years_experience} yr
                    {app.years_experience === 1 ? "" : "s"} · {app.primary_software}
                  </p>
                </div>
                <Badge variant={STATUS_TONE[app.status] ?? "outline"}>
                  {app.status.replace("_", " ").toLowerCase()}
                </Badge>
              </div>

              <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="truncate">
                    <a className="underline underline-offset-2" href={`mailto:${app.email}`}>
                      {app.email}
                    </a>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{app.phone}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Categories</dt>
                  <dd>{app.categories.map((c) => c.toLowerCase()).join(", ")}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Applied</dt>
                  <dd>{when(app.created_at)}</dd>
                </div>
              </dl>

              <div className="mt-3 text-sm">
                <span className="text-muted-foreground">Portfolio: </span>
                {app.portfolio_url ? (
                  <a
                    href={app.portfolio_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {app.portfolio_url}
                  </a>
                ) : (
                  <span className="inline-flex flex-wrap gap-3">
                    {(fileLinks.get(app.id) ?? []).map((f) => (
                      <a
                        key={f.url}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {f.name}
                      </a>
                    ))}
                    {(fileLinks.get(app.id)?.length ?? 0) === 0 && (
                      <span className="text-muted-foreground">files unavailable</span>
                    )}
                  </span>
                )}
              </div>

              {app.review_notes && (
                <p className="mt-3 rounded-md border border-border bg-subtle px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Note: </span>
                  {app.review_notes}
                </p>
              )}

              <ReviewControls id={app.id} status={app.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
