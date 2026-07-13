import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

// Chrome for the authenticated product (client/designer/staff). Kept separate
// from the marketing site's layout so the two are visually and structurally
// isolated — this header never renders on a marketing page, and vice versa.
export default function AppLayout({ children }: { children: React.ReactNode }) {
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
              <NavLink href="/dashboard">Dashboard</NavLink>
              <NavLink href="/orders">Orders</NavLink>
              <NavLink href="/admin">Staff</NavLink>
              <NavLink href="/onboarding/designer">Designers</NavLink>
              <div className="ml-2 flex items-center">
                <UserButton />
              </div>
            </SignedIn>
          </nav>
        </div>
      </header>
      {children}
    </>
  );
}
