import type { Metadata } from "next";

import { Stepper } from "@/components/stepper";
import { pageMetadata } from "@/lib/seo";

import { DesignerApplicationForm } from "./DesignerApplicationForm";

export const metadata: Metadata = pageMetadata(
  "Apply as a CAD Designer",
  "A short screening application — not a full account. Tell us about your CAD experience and we'll follow up by email.",
  "/apply-designer",
);

const STAGES = [{ label: "Application" }, { label: "Review" }, { label: "Onboarding" }];

export default async function ApplyDesignerPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const submitted = (await searchParams).submitted === "1";

  return (
    <section className="container max-w-xl py-16">
      <p className="text-sm font-medium text-primary">For CAD designers</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Apply as a designer</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        This is a short screening application — about two minutes, seven questions. It is not a
        full account: nothing here creates a login. If your application looks like a fit, we
        review it, follow up by email, and the real onboarding (identity verification, the
        platform&apos;s operating agreement, a paid test order) happens after that, one candidate
        at a time.
      </p>

      <div className="mt-6">
        <Stepper steps={STAGES} current={0} />
      </div>

      {submitted ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium">Application received</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks for applying — we&apos;ll review your submission and be in touch by email.
          </p>
        </div>
      ) : (
        <DesignerApplicationForm />
      )}
    </section>
  );
}
