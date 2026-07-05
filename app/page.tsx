import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";

import { TrustLine } from "@/components/trust-line";
import { Button, buttonVariants } from "@/components/ui/button";

// Public entry. Infrastructure positioning: precise, restrained, trust-forward.
export default function Home() {
  return (
    <main className="container flex max-w-3xl flex-col py-20">
      <p className="text-sm font-medium text-primary">Double-blind CAD marketplace</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        Manufacturing-grade CAD, with identities protected end to end.
      </h1>
      <p className="mt-5 max-w-xl text-base text-muted-foreground">
        Clients and designers never see each other. Every order moves through explicit,
        timestamped states with independent QC and escrowed payment — and every action is logged.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <SignedOut>
          <SignInButton mode="modal">
            <Button size="lg">Sign in</Button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
            Go to dashboard
          </Link>
          <Link href="/orders" className={buttonVariants({ variant: "outline", size: "lg" })}>
            View orders
          </Link>
        </SignedIn>
      </div>

      <TrustLine className="mt-10 border-t border-border pt-6" />
    </main>
  );
}
