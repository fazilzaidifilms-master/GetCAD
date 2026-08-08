import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { POST_AUTH_PATH } from "@/config/auth-redirects";

const NAV = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/quality-control", label: "Quality Control" },
  { href: "/security", label: "Security" },
  { href: "/for-designers", label: "For Designers" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" aria-label="The CAD Pillar — home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/contact"
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "hidden sm:inline-flex",
            })}
          >
            Contact sales
          </Link>
          {/* Signed in, this header used to keep offering "Sign in" and
              "Get started" and gave no way into the product at all. Combined
              with Clerk returning people here after authenticating, the whole
              flow appeared to do nothing — you signed in and arrived at a page
              still asking you to sign in. */}
          <SignedOut>
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Sign in
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
              Get started
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href={POST_AUTH_PATH}
              className={buttonVariants({ size: "sm" })}
            >
              Open the app
            </Link>
            <div className="ml-1 flex items-center">
              <UserButton />
            </div>
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
