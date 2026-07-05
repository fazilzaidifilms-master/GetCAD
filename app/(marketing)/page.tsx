import Link from "next/link";
import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { WorkflowCompact } from "@/components/marketing/workflow-steps";
import { FaqSection } from "@/components/marketing/faq-section";
import { BLOG_POSTS } from "@/components/marketing/blog-posts";
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

const FAQ_ITEMS = [
  {
    question: "Do I ever learn who the designer is, or does the designer learn who I am?",
    answer:
      "No, in either direction. Order records, files, and messages carry no identifying information about either party. Both sides are referred to only by role — Client, Designer, Reviewer — for the life of the order.",
  },
  {
    question: "What happens if the delivered CAD doesn't meet the brief?",
    answer:
      "Every deliverable passes through an independent QC reviewer before you see it. If a delivery still doesn't meet the brief once it reaches you, you can raise a dispute directly on the order — the full history of files, messages, and QC decisions is available to resolve it.",
  },
  {
    question: "How is payment protected?",
    answer:
      "Funds are held until a deliverable clears independent QC and is accepted. Nothing is released to a designer on the basis of a claim alone — release is tied to a recorded, reviewed state change on the order.",
  },
  {
    question: "Is every decision on my order recorded?",
    answer:
      "Yes. Every state change — submission, assignment, QC pass or reject, delivery, payment release — is written to an append-only record at the time it happens. Nothing about an order's history can be edited after the fact.",
  },
  {
    question: "What if there's a dispute between a client and a designer?",
    answer:
      "Disputes are handled by staff with access to the complete, tamper-evident order record — files, messages, and QC outcomes — without either party's identity being revealed to the other as part of that process.",
  },
  {
    question: "Can I request a specific designer for future orders?",
    answer:
      "No. Assignment is handled by the platform, not chosen by either side. This is a deliberate trade-off: it's what keeps the anonymity guarantee structural rather than optional.",
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

      <section className="border-t border-border py-16">
        <div className="container">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              From the blog
            </h2>
            <Link href="/blog" className="text-sm text-primary hover:underline">
              Read the blog →
            </Link>
          </div>
          <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {BLOG_POSTS.slice(0, 3).map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="bg-card p-6 hover:bg-accent">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {post.category}
                </p>
                <p className="mt-2 font-medium">{post.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{post.excerpt}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FaqSection items={FAQ_ITEMS} />

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
