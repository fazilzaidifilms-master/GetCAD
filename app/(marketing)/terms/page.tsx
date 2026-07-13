import type { Metadata } from "next";

import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "Terms of Service",
  "The CAD Pillar's terms of service.",
  "/terms",
);

export default function TermsPage() {
  return (
    <section className="container max-w-2xl py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-4 text-sm text-muted-foreground">Coming soon.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This page is a placeholder. Complete terms of service will be published here before the
        platform is generally available.
      </p>
    </section>
  );
}
