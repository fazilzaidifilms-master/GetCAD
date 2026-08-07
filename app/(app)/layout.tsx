import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { BottomNav } from "@/components/nav/bottom-nav";
import { SideNav } from "@/components/nav/side-nav";
import { ConnectionStatus } from "@/components/pwa/connection-status";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { POST_AUTH_PATH } from "@/config/auth-redirects";
import { tabsForRole } from "@/core";
import { cn } from "@/lib/utils";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Chrome for the authenticated product (client / designer / staff). Kept
 * separate from the marketing layout so the two are visually and structurally
 * isolated — this header never renders on a marketing page, and vice versa.
 *
 * Navigation is ROLE-SCOPED. It once rendered Dashboard, Orders, Staff and
 * Designers to every signed-in user, which showed customers that internal
 * tooling exists. Those pages were never reachable — the database refuses them —
 * but advertising a door you cannot open is still a disclosure, and an
 * anonymity-critical product should not be making it.
 *
 * Which tabs a role gets is decided in `core/nav/tabs`, unit-tested, so the
 * rule cannot quietly drift as screens are added.
 *
 * THE SHELL. One navigation, drawn two ways, never both at once:
 *
 *   - below 768px  — a slim header carrying only the wordmark and the account
 *                    control, and the bottom tab bar doing the navigating.
 *   - 768px and up — a persistent left sidebar. This is the change: desktop
 *                    used to navigate from a row of text links in the header,
 *                    which is the shape of a website, not of an app. The
 *                    destinations are identical; only their drawing differs.
 *
 * Signed out there is no role and nothing to navigate to, so the header keeps
 * its full-width form with Sign in / Get started and no shell appears at all.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();

  // Signed out there is no role to scope by. The per-page auth guards handle
  // the redirect; this only avoids a pointless query.
  let tabs = null;
  if (userId) {
    const supabase = await createUserSupabaseClient();
    const { data } = await supabase.from("users").select("role").maybeSingle();
    tabs = tabsForRole(data?.role ?? "CLIENT");
  }

  return (
    <>
      {tabs ? <SideNav tabs={tabs} /> : null}

      {/* The sidebar is fixed, so the content column is inset past it rather
          than flowing under it. Done once here, not as a class every page has
          to remember. */}
      <div className={tabs ? "md:pl-64" : undefined}>
        <header
          className={cn(
            "sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur",
            // With a sidebar on screen this header is phone-only chrome. The
            // wordmark and the account control both live in the sidebar there,
            // and a second copy of them across the top is the website look this
            // is getting rid of.
            tabs && "md:hidden",
          )}
        >
          <div className="container flex h-14 items-center justify-between">
            <Link href="/dashboard" aria-label="The CAD Pillar — dashboard">
              <Wordmark />
            </Link>
            <nav className="flex items-center gap-1">
              <SignedOut>
                <SignInButton mode="modal" fallbackRedirectUrl={POST_AUTH_PATH}>
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </SignInButton>
                <SignUpButton mode="modal" fallbackRedirectUrl={POST_AUTH_PATH}>
                  <Button size="sm">Get started</Button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </nav>
          </div>
        </header>

        {/* Above everything else, so the answer to "did that save?" is on
            screen before the question is asked. Its sticky offset follows the
            header: 56px under it on a phone, flush to the top once the header
            is gone and the sidebar has taken over. */}
        <ConnectionStatus className={tabs ? "top-14 md:top-0" : "top-14"} />

        {/* The tab bar is fixed too, so every screen needs clearance beneath it
            or its last row sits under the bar. */}
        <div className={tabs ? "pb-24 md:pb-0" : undefined}>{children}</div>
      </div>

      {tabs ? <BottomNav tabs={tabs} /> : null}
    </>
  );
}
