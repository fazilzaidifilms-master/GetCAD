import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";

import { partyLabel } from "@/components/domain";
import { InstallHint } from "@/components/pwa/install-hint";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { Button } from "@/components/ui/button";
import { pushIsConfiguredForBrowser } from "@/config/push";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Account.
 *
 * The fourth tab in every role's navigation, and the only screen that talks
 * about the viewer rather than about work. It is deliberately thin: identity,
 * what the account can do, the way out.
 *
 * Note what it does NOT show. There is no "profile" here in the social sense —
 * no photo, no bio, no display name shown to anyone else. A designer's identity
 * is never rendered to a client and vice versa, so a profile page would be a
 * screen for editing something nobody can see. What people actually need is
 * their role (which explains why the rest of the app looks the way it does) and
 * the settings that have real consequences.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");
  const { data } = await supabase.from("users").select("role, status").maybeSingle();

  const role: string = data?.role ?? "CLIENT";
  const status: string = data?.status ?? "PENDING";

  // Read here rather than in the client component: an unconfigured deployment
  // should show nothing at all, not a button that fails when pressed.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const pushOffered = pushIsConfiguredForBrowser(vapidPublicKey);

  return (
    <main className="container max-w-2xl py-8">
      <h1 className="text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
        Account
      </h1>

      <dl className="mt-6 divide-y divide-border overflow-hidden rounded-[var(--r-lg)] border border-border bg-card">
        <Row label="Signed in as" value={partyLabel(role)} />
        <Row label="Status" value={status === "ACTIVE" ? "Active" : "Pending"} />
        <Row
          label="Account reference"
          value={userId}
          mono
          hint="Quote this if you contact us. It identifies your account without naming you."
        />
      </dl>

      <InstallHint />

      {pushOffered ? (
        <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-card p-4">
          <PushOptIn publicKey={vapidPublicKey} />
        </div>
      ) : null}

      {role === "DESIGNER" ? (
        <div className="mt-4">
          <Link href="/settings/payouts">
            <Button variant="outline" className="min-h-[var(--ctl)] w-full">
              Payout details
            </Button>
          </Link>
        </div>
      ) : null}

      <div className="mt-8">
        <SignOutButton>
          <Button variant="ghost" className="min-h-[var(--ctl)] w-full">
            Sign out
          </Button>
        </SignOutButton>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  mono = false,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[length:var(--fs-2)] uppercase tracking-[var(--ls-1)] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "tabular mt-0.5 break-all font-mono text-[length:var(--fs-3)]"
            : "mt-0.5 text-[length:var(--fs-4)] font-medium"
        }
      >
        {value}
      </dd>
      {hint ? (
        <p className="mt-1 text-[length:var(--fs-2)] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
