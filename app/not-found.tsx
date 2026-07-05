import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="container flex max-w-lg flex-col items-start py-16">
      <p className="text-sm font-medium text-primary">Page not found</p>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist, or the link is out of date.
      </p>
      <Link href="/dashboard" className="mt-5 inline-flex">
        <Button>Go to dashboard</Button>
      </Link>
    </main>
  );
}
