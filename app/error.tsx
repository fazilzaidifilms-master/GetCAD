"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="container flex max-w-lg flex-col items-start py-16">
      <p className="text-sm font-medium text-destructive">This action didn&apos;t go through</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="tabular mt-2 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/dashboard" className="inline-flex">
          <Button variant="outline">Go to dashboard</Button>
        </Link>
      </div>
    </main>
  );
}
