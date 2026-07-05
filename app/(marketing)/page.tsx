import Link from "next/link";
import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { WorkflowCompact } from "@/components/marketing/workflow-steps";
import { buttonVariants } from "@/components/ui/button";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "The Operational Infrastructure for Jewelry CAD Production",
  "The CAD Pillar is the operational layer connecting jewelry businesses with vetted CAD designers — double-blind, independently reviewed, and fully logged.",
  "/",
);

const DIFFERENTIATORS = [
  {
    title: "Double-blind anonymity",
    body: "Clients and designers never learn who the other is. Every order carries no identifying information in either direction — by construction, not by policy.",
  },
  {
    title: "Independent QC",
    body: "Every deliverable is reviewed by someone who did not design it, before the client ever sees it. This gate is mandatory and cannot be bypassed.",
  },
  {
    title: "Audited accountability",
    body: "Every state change, payment movement, and review decision is written to an append-only, tamper-evident record. Nothing happens off the books.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="container max-w-3xl py-20">
        <p className="text-sm font-medium text-primary">Operational infrastructure</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          The operational infrastructure for jewelry CAD production.
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground">
          Jewelry businesses submit requirements. Vetted designers produce the CAD. Independent
          reviewers validate every deliverable. Every step is logged. Neither side ever learns who
          the other is.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
            For Jewelry Businesses
          </Link>
          <Link href="/for-designers" className={buttonVariants({ variant: "outline", size: "lg" })}>
            For CAD Designers
          </Link>
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            How an order moves through the system
          </h2>
          <div className="mt-5">
            <WorkflowCompact />
          </div>
          <Link
            href="/how-it-works"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            See the full process →
          </Link>
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="container">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            What makes this different
          </h2>
          <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.title} className="bg-card p-6">
                <p className="font-medium">{d.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
