import type { Metadata } from "next";

import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "Privacy Policy",
  "The CAD Pillar's privacy policy.",
  "/privacy",
);

export default function PrivacyPage() {
  return (
    <section className="container max-w-2xl py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-4 text-sm text-muted-foreground">Coming soon.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This page is a placeholder. A complete privacy policy will be published here before the
        platform is generally available.
      </p>
    </section>
  );
}
