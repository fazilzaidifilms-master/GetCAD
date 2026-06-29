import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";

// Throwaway home page — proves the app boots and links into the auth flow.
// No business logic lives in app/.
export default function Home() {
  return (
    <main className="container flex min-h-[80vh] flex-col items-center justify-center gap-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">GetCAD</h1>
      <p className="max-w-md text-muted-foreground">
        Sign in to reach your dashboard. Your session is verified server-side and
        carried into the database, where RLS shows you only what is yours.
      </p>
      <SignedOut>
        <SignInButton mode="modal">
          <Button>Sign in</Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link href="/dashboard" className={buttonVariants()}>
          Go to your dashboard
        </Link>
      </SignedIn>
    </main>
  );
}
