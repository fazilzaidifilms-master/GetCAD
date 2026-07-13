import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { pageMetadata } from "@/lib/seo";

import { submitLeadAction } from "./actions";

export const metadata: Metadata = pageMetadata(
  "Contact Sales",
  "Get in touch — for jewelry businesses evaluating The CAD Pillar, or CAD designers with questions before applying.",
  "/contact",
);

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const submitted = (await searchParams).submitted === "1";

  return (
    <section className="container max-w-xl py-16">
      <p className="text-sm font-medium text-primary">Contact sales</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Get in touch</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Evaluating The CAD Pillar for your business, or have a question before signing up? Tell us
        a bit about what you need and we&apos;ll follow up by email.
      </p>

      {submitted ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium">Message received</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks for reaching out — we&apos;ll respond by email shortly.
          </p>
        </div>
      ) : (
        <form action={submitLeadAction} className="mt-8 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">
                Company <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="company" name="company" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">I am a</Label>
            <select id="role" name="role" defaultValue="BUSINESS" className={selectCls}>
              <option value="BUSINESS">Jewelry business</option>
              <option value="DESIGNER">CAD designer</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <Textarea id="message" name="message" rows={5} required maxLength={5000} />
          </div>
          <Button type="submit">Send message</Button>
        </form>
      )}
    </section>
  );
}
