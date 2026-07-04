import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { applyAsDesignerAction, signAgreementAction } from "./actions";

export const dynamic = "force-dynamic";

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
        <h2 key={i} className="mt-4 text-lg font-semibold">
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

  return (
    <main className="container max-w-2xl py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Become a designer</h1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
      </div>

      {/* State C: signed the current version — fully onboarded. */}
      {hasProfile && signedCurrent && isActiveDesigner && (
        <section className="mt-6 rounded-lg border p-4">
          <p className="text-sm">
            ✅ You&apos;re onboarded. You have signed{" "}
            <span className="font-medium">{doc?.title}</span> (
            <span className="font-mono">{doc?.version}</span>) and are eligible to be assigned work.
          </p>
          <Link
            href="/orders"
            className="mt-3 inline-block text-sm text-muted-foreground underline hover:text-foreground"
          >
            Go to orders →
          </Link>
        </section>
      )}

      {/* State B: applicant who has not signed the CURRENT version (new or re-gated). */}
      {hasProfile && doc && !signedCurrent && (
        <section className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Read the agreement below and sign to become assignable. Your signature is recorded
            against this exact version and its cryptographic fingerprint.
          </p>
          <article className="max-h-96 overflow-y-auto rounded-lg border p-4">
            {renderMarkdown(doc.body)}
          </article>
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-xs text-muted-foreground">
              {doc.version} · {doc.content_sha256.slice(0, 16)}…
            </p>
            <form action={signAgreementAction}>
              <input type="hidden" name="expected_sha256" value={doc.content_sha256} />
              <Button type="submit">I have read and agree — sign</Button>
            </form>
          </div>
        </section>
      )}

      {/* State B fallback: applicant but no document is published. */}
      {hasProfile && !doc && (
        <section className="mt-6 rounded-lg border p-4">
          <p className="text-sm text-red-600">
            No designer agreement is published yet — please check back shortly.
          </p>
        </section>
      )}

      {/* State A: not yet an applicant — show the apply form. */}
      {!hasProfile && (
        <section className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Apply to join as a designer. After applying you&apos;ll review and sign the designer
            agreement; you can&apos;t be assigned work until you do.
          </p>
          <form action={applyAsDesignerAction} className="space-y-3">
            <div>
              <label htmlFor="legal_name" className="text-sm">
                Legal name
              </label>
              <input
                id="legal_name"
                name="legal_name"
                required
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="email" className="text-sm">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="country" className="text-sm">
                Country <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="country"
                name="country"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit">Apply as a designer</Button>
          </form>
        </section>
      )}
    </main>
  );
}
