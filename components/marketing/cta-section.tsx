import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="border-t border-border">
      <div className="container grid gap-px overflow-hidden rounded-lg border border-border bg-border py-0 sm:grid-cols-2 sm:rounded-lg">
        <div className="bg-card p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Jewelry Businesses
          </p>
          <p className="mt-2 text-lg font-medium">
            Get production-ready CAD, without the overhead.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Submit a requirement and let the platform handle designer
            assignment, review, and delivery.
          </p>
          <div className="mt-5 flex items-center gap-4">
            <Link href="/sign-up" className={buttonVariants({})}>
              Get started
            </Link>
            <Link
              href="/contact"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Prefer to talk first? Contact sales →
            </Link>
          </div>
        </div>
        <div className="bg-card p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            CAD Designers
          </p>
          <p className="mt-2 text-lg font-medium">
            Consistent work. No client acquisition.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign up, complete onboarding, and get assigned work — without
            chasing clients or payments.
          </p>
          <Link
            href="/for-designers"
            className={buttonVariants({
              variant: "outline",
              className: "mt-5",
            })}
          >
            Learn more
          </Link>
        </div>
      </div>
    </section>
  );
}
