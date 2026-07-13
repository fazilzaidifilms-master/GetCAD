import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "Security & Architecture",
  "Designer identity protected. All actions logged. Independent QC required. How the anonymity and audit architecture actually works.",
  "/security",
);

export default function SecurityPage() {
  return (
    <>
      <section className="container max-w-2xl py-16">
        <p className="text-sm font-medium text-primary">Architecture, not marketing</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Designer identity protected. All actions logged. Independent QC required.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          These aren&apos;t claims — they&apos;re how the system is built. This page explains the
          architecture in plain terms, not marketing language.
        </p>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-lg font-semibold">Identity is never exchanged</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            An order carries no identifying information about either party — not a name, not
            contact details, nothing that would let a client and designer identify each other. This
            isn&apos;t enforced by a policy someone could bypass; the underlying records for an
            order simply have nowhere to hold that information.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Communication happens through a message channel scoped to the order. Each participant
            sees the other only by role — &quot;Client&quot; or &quot;Designer&quot; — never by
            name. A participant can read the full conversation and still learn nothing about who
            they&apos;re talking to.
          </p>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-lg font-semibold">Every action is logged, permanently</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Every state change on an order — submission, quoting, assignment, payment, QC decision,
            dispute, delivery — is written to an append-only record. Each entry is cryptographically
            chained to the one before it, so altering any past entry would break every entry after
            it. Existing records cannot be edited or deleted, by anyone, including the platform
            operator.
          </p>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-lg font-semibold">Independent QC is not optional</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            An order cannot reach delivery without passing through independent review by someone
            other than the designer who produced it. This is enforced the same way identity
            protection is: it is a required stage in the order&apos;s sequence, not a step that can
            be skipped or waived.
          </p>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-lg font-semibold">Access is scoped by default</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Every party — client, designer, reviewer, staff — sees only what their role and
            relationship to a specific order permits. There is no broad internal view that exposes
            more than a role requires, and access defaults to denied unless explicitly granted.
          </p>
        </div>
      </section>

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
