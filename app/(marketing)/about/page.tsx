import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "About",
  "The CAD Pillar is building the operational infrastructure layer for the jewelry CAD industry.",
  "/about",
);

export default function AboutPage() {
  return (
    <>
      <section className="container max-w-2xl py-16">
        <p className="text-sm font-medium text-primary">About</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          The operational layer for jewelry CAD production.
        </h1>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl space-y-4 text-sm text-muted-foreground">
          <p>
            Jewelry CAD production today runs on informal relationships: a business finds a
            designer, negotiates directly, and hopes the work holds up once it reaches
            manufacturing. There is no independent review step, no consistent record of what was
            agreed or delivered, and no structural protection for either side if something goes
            wrong.
          </p>
          <p>
            The CAD Pillar exists to replace that with infrastructure: a fixed operational sequence
            every order moves through, an independent quality gate that cannot be skipped, and a
            permanent, tamper-evident record of every decision. Identity protection isn&apos;t a
            feature layered on top — it&apos;s the condition that makes the rest of the system
            possible, because neither side has to trust the other directly. They only have to trust
            the process.
          </p>
          <p>
            The goal is to become the operational infrastructure the jewelry CAD industry runs on —
            the same way payment processing or source control became infrastructure other
            industries stopped thinking about. That is a long-term, category-defining position, and
            it is built one operational guarantee at a time.
          </p>
        </div>
      </section>

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
