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
          Start with a short screening application — about two minutes. If it looks like a fit,
          we follow up and walk you through the real onboarding: identity verification, the
          platform&apos;s operating agreement, and a paid test order. Once active, you&apos;re
          eligible to be assigned work — the platform handles client acquisition, payment
          collection, and quality review.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/apply-designer" className={buttonVariants({ size: "lg" })}>
            Apply as a designer
          </Link>
          <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">
            Already onboarded? Sign in →
          </Link>
        </div>
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
            Onboarding happens in two stages, deliberately. The application is a short screening
            form — no account, no login, just enough for us to understand your experience and
            portfolio. If it&apos;s a fit, the second stage is a real review: identity
            verification, reading and accepting the platform&apos;s operating agreement, and a
            paid test order before you&apos;re eligible for regular assignment. This is a fixed,
            one-time step per designer — not a recurring negotiation, and not automated end to
            end, so every accepted designer has actually been looked at by a person.
          </p>
        </div>
      </section>
    </>
  );
}
