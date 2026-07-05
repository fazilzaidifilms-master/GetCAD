import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "Quality Control",
  "Every deliverable is reviewed by an independent reviewer before the client sees it — what's checked, and why review is mandatory and independent.",
  "/quality-control",
);

const CHECKS = [
  {
    title: "Manufacturing feasibility",
    body: "Whether the model can actually be produced with standard jewelry manufacturing methods — not just whether it renders correctly.",
  },
  {
    title: "Stone-setting accuracy",
    body: "Seat geometry, prong placement, and clearance for the specified stones, checked against the original requirement.",
  },
  {
    title: "Casting considerations",
    body: "Wall thickness, structural points, and other factors that determine whether a cast piece will hold up once produced.",
  },
  {
    title: "Production-readiness",
    body: "File integrity and completeness — that what's being handed off is actually usable by a manufacturing partner, not just visually correct.",
  },
];

export default function QualityControlPage() {
  return (
    <>
      <section className="container max-w-2xl py-16">
        <p className="text-sm font-medium text-primary">Independent QC</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Every deliverable is reviewed before the client sees it.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Independent QC is a mandatory stage in the order sequence, not an optional add-on. A
          reviewer who did not produce the work checks it against manufacturing and quality
          standards before it reaches the client for preview.
        </p>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            What independent QC checks
          </h2>
          <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            {CHECKS.map((c) => (
              <div key={c.title} className="bg-card p-6">
                <p className="font-medium">{c.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Why it&apos;s independent
          </h2>
          <p className="mt-4 text-sm text-muted-foreground">
            The reviewer is never the designer who produced the work. Neither party is told who the
            reviewer is — the same identity-protection that applies between client and designer
            applies to QC. The reviewer is shown to the client only by role, never by name.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            This isn&apos;t a courtesy check. A designer cannot review their own work, and a client
            cannot request a specific reviewer. The outcome — passed, or sent back for revision — is
            recorded and visible on the order&apos;s timeline the moment it happens, with a
            timestamp, so there is never ambiguity about whether independent review took place.
          </p>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Why it exists
          </h2>
          <p className="mt-4 text-sm text-muted-foreground">
            Errors caught before manufacturing are inexpensive. Errors caught after are not. A
            mandatory, independent review step exists to catch what a single designer working alone
            — however skilled — can miss, and to give both the client and the designer a shared,
            neutral checkpoint that protects both sides of the order.
          </p>
        </div>
      </section>

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
