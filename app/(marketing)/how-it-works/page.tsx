import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { WorkflowDetailed } from "@/components/marketing/workflow-steps";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "How It Works",
  "The full operational sequence an order moves through — what happens at each stage, and why it exists.",
  "/how-it-works",
);

export default function HowItWorksPage() {
  return (
    <>
      <section className="container max-w-2xl py-16">
        <p className="text-sm font-medium text-primary">Operational sequence</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">How it works</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Every order moves through the same fixed sequence. No stage is optional, and no stage can
          be skipped. This is not a list of features — it&apos;s the actual operating process, and
          each stage exists to close a specific gap: an unclear brief, an unaccountable reviewer, an
          untracked decision.
        </p>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <WorkflowDetailed />
        </div>
      </section>

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
