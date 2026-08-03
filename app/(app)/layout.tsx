import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { tabsForRole } from "@/core";
import { BottomNav } from "@/components/nav/bottom-nav";
import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Chrome for the authenticated product (client / designer / staff). Kept
 * separate from the marketing layout so the two are visually and structurally
 * isolated — this header never renders on a marketing page, and vice versa.
 *
 * Navigation is now ROLE-SCOPED. It previously rendered Dashboard, Orders,
 * Staff and Designers to every signed-in user, which showed customers that
 * internal tooling exists. Those pages were never reachable — the database
 * refuses them — but advertising a door you cannot open is still a disclosure,
 * and an anonymity-critical product should not be making it.
 *
 * Which tabs a role gets is decided in `core/nav/tabs`, unit-tested, so the
 * rule cannot quietly drift as screens are added.
 *
 * Two navigations, one source: the header on desktop, the bottom bar on a
 * phone. They never appear together.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();

  // Signed out there is no role to scope by and nothing to navigate to. The
  // per-page auth guards handle the redirect; this only avoids a pointless
  // query and renders the signed-out header.
  let tabs = null;
  if (userId) {
    const supabase = await createUserSupabaseClient();
    const { data } = await supabase.from("users").select("role").maybeSingle();
    tabs = tabsForRole(data?.role ?? "CLIENT");
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/dashboard" aria-label="The CAD Pillar — dashboard">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-1">
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm">Get started</Button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              {/* Hidden on a phone: the bottom bar is the navigation there, and
                  two competing navigations means neither is obviously the one
                  to use. */}
              <span className="hidden items-center gap-1 md:flex">
                {(tabs ?? []).map((tab) => (
                  <NavLink key={tab.key} href={tab.href}>
                    {tab.label}
                  </NavLink>
                ))}
              </span>
              <div className="ml-2 flex items-center">
                <UserButton />
              </div>
            </SignedIn>
          </nav>
        </div>
      </header>

      {/* The tab bar is fixed, so every screen needs clearance beneath it or
          its last row sits under the bar. Done once here rather than as a
          padding class every page has to remember. */}
      <div className={tabs ? "pb-24 md:pb-0" : undefined}>{children}</div>

      {tabs ? <BottomNav tabs={tabs} /> : null}
    </>
  );
}
