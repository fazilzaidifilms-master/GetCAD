import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ErrorPanel } from "@/components/error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/stepper";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { TONE_SURFACE } from "@/lib/tone";

import { applyAsDesignerAction, signAgreementAction } from "./actions";

export const dynamic = "force-dynamic";

const STEPS = [{ label: "Apply" }, { label: "Sign agreement" }, { label: "Active" }];

interface AgreementDoc {
  id: string;
  version: string;
  title: string;
  body: string;
  content_sha256: string;
}

// Minimal, dependency-free renderer for the agreement's markdown body. The body
// is trusted platform content; we still build React nodes (no dangerouslySetHTML)
// so nothing is injected. Handles: # / ## headings, - and 1. list items, blank
// lines, **bold** inline. Anything else renders as a paragraph.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function renderMarkdown(body: string): ReactNode {
  const lines = body.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("# ")) {
      return (
        <h2 key={i} className="mt-4 text-base font-semibold">
          {renderInline(line.slice(2))}
        </h2>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h3 key={i} className="mt-3 font-medium">
          {renderInline(line.slice(3))}
        </h3>
      );
    }
    const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (listItem) {
      return (
        <li key={i} className="ml-5 list-disc">
          {renderInline(listItem[1] ?? "")}
        </li>
      );
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-sm leading-relaxed">
        {renderInline(line)}
      </p>
    );
  });
}

export default async function DesignerOnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();

  const [meRes, profileRes, docRes] = await Promise.all([
    supabase.from("users").select("role, status").maybeSingle(),
    supabase.from("designer_profiles").select("id, legal_name").maybeSingle(),
    supabase
      .from("agreement_documents")
      .select("id, version, title, body, content_sha256")
      .eq("kind", "DESIGNER")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const queryError = meRes.error ?? profileRes.error ?? docRes.error;
  if (queryError) {
    return (
      <main className="container max-w-2xl py-8">
        <h1 className="text-xl font-semibold tracking-tight">Become a designer</h1>
        <ErrorPanel
          title="Couldn't load this page"
          message={`${queryError.message} — reload the page to try again.`}
          className="mt-4"
        />
      </main>
    );
  }

  const me = meRes.data as { role: string; status: string } | null;
  const hasProfile = !!profileRes.data;
  const doc = docRes.data as AgreementDoc | null;

  // Have they signed the CURRENT version? (RLS scopes acceptances to self.)
  let signedCurrent = false;
  if (doc) {
    const sigRes = await supabase
      .from("agreement_acceptances")
      .select("agreement_id")
      .eq("agreement_id", doc.id)
      .maybeSingle();
    signedCurrent = !!sigRes.data;
  }

  const isActiveDesigner = me?.role === "DESIGNER" && me?.status === "ACTIVE";

  // Exhaustive: every combination of (hasProfile, doc, signedCurrent,
  // isActiveDesigner) maps to exactly one stage, so exactly one section below
  // always renders — never a blank page.
  const stage = !hasProfile
    ? "apply"
    : !doc
      ? "no-doc"
      : !signedCurrent
        ? "sign"
        : isActiveDesigner
          ? "active"
          : "mismatch";

  const currentStep = stage === "apply" ? 0 : stage === "active" ? 2 : 1;

  return (
    <main className="container max-w-2xl py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Become a designer</h1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
      </div>

      <Stepper steps={STEPS} current={currentStep} className="mt-5" />

      {stage === "active" && (
        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Badge className={TONE_SURFACE.success}>
              Active
            </Badge>
            <p className="text-sm font-medium">You&apos;re onboarded</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            You have signed <span className="font-medium text-foreground">{doc?.title}</span> (
            <span className="tabular font-mono">{doc?.version}</span>) and are eligible to be
            assigned work.
          </p>
          <Link href="/orders" className="mt-3 inline-block text-sm text-primary hover:underline">
            Go to orders →
          </Link>
        </section>
      )}

      {stage === "sign" && doc && (
        <section className="mt-6 space-y-4 rounded-lg border border-border bg-card p-5">
          <div>
            <p className="text-sm font-medium">{doc.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Read the agreement below and sign to become assignable. Your signature is recorded
              against this exact version and its cryptographic fingerprint — if the text changes,
              you sign again.
            </p>
          </div>
          <article className="max-h-96 overflow-y-auto rounded-md border border-border bg-subtle p-4">
            {renderMarkdown(doc.body)}
          </article>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="tabular font-mono text-xs text-muted-foreground">
              {doc.version} · {doc.content_sha256.slice(0, 16)}…
            </p>
            <form action={signAgreementAction}>
              <input type="hidden" name="expected_sha256" value={doc.content_sha256} />
              <Button type="submit">I have read and agree — sign</Button>
            </form>
          </div>
        </section>
      )}

      {stage === "no-doc" && (
        <section className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          No designer agreement is published yet — please check back shortly.
        </section>
      )}

      {/* Signed the current version, but the account's role/status isn't
          currently DESIGNER/ACTIVE (e.g. changed after signing). Surfaced
          explicitly instead of silently showing nothing. */}
      {stage === "mismatch" && (
        <section className={`mt-6 rounded-[var(--r-md)] border p-4 text-sm ${TONE_SURFACE.attention}`}>
          <p className="font-medium">Signed, but not currently active as a designer</p>
          <p className="mt-1 opacity-90">
            You&apos;ve signed the current agreement, but your account&apos;s role is{" "}
            <span className="font-mono">{me?.role ?? "unknown"}</span> and status is{" "}
            <span className="font-mono">{me?.status ?? "unknown"}</span> — designers must be{" "}
            <span className="font-mono">DESIGNER / ACTIVE</span> to be assignable. If this looks
            wrong, contact support.
          </p>
        </section>
      )}

      {stage === "apply" && (
        <section className="mt-6 space-y-4 rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Apply to join as a designer. After applying you&apos;ll review and sign the designer
            agreement; you can&apos;t be assigned work until you do.
          </p>
          <form action={applyAsDesignerAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="legal_name">Legal name</Label>
              <Input id="legal_name" name="legal_name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">
                Country <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="country" name="country" />
            </div>
            <Button type="submit">Apply as a designer</Button>
          </form>
        </section>
      )}
    </main>
  );
}
