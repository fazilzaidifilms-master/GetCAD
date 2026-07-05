import Link from "next/link";
import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "For CAD Designers",
  "Consistent work, no client acquisition, no payment chasing. Sign up and focus purely on design.",
  "/for-designers",
);

const POINTS = [
  {
    title: "No client acquisition",
    body: "Work is assigned to you through the platform. You never have to find clients, pitch, or negotiate a rate for individual jobs.",
  },
  {
    title: "No payment chasing",
    body: "Payment is held in escrow by the platform before a designer is assigned and released on delivery. You are never waiting on an invoice.",
  },
  {
    title: "No client relationship management",
    body: "Communication happens through an order-scoped channel. There's no ongoing client relationship to manage outside of the specific work.",
  },
  {
    title: "Focus purely on design",
    body: "Once assigned, the work is the job: produce the CAD against the specification. Review, delivery, and payment are handled by the platform.",
  },
];

export default function ForDesignersPage() {
  return (
    <>
      <section className="container max-w-2xl py-16">
        <p className="text-sm font-medium text-primary">For CAD designers</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Consistent work. No client acquisition. No payment chasing.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Sign up, complete onboarding, and accept the platform&apos;s operating agreement. Once
          active, you&apos;re eligible to be assigned work — the platform handles client
          acquisition, payment collection, and quality review.
        </p>
        <Link href="/sign-up" className={buttonVariants({ size: "lg", className: "mt-6" })}>
          Apply as a designer
        </Link>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            {POINTS.map((p) => (
              <div key={p.title} className="bg-card p-6">
                <p className="font-medium">{p.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="container max-w-2xl">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Onboarding
          </h2>
          <p className="mt-4 text-sm text-muted-foreground">
            After signing up, you&apos;ll apply as a designer and review the platform&apos;s
            operating agreement before you can be assigned work. This is a fixed, one-time step —
            not a recurring negotiation.
          </p>
        </div>
      </section>
    </>
  );
}
