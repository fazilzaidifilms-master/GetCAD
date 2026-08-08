"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { reviewApplicationAction } from "./actions";

/**
 * Accept / reject / reopen an application, with an optional note.
 *
 * A note is *required* for a rejection — a "no" the team can't explain later is
 * worse than useless — and optional for an accept.
 */
export function ReviewControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(decision: "ACCEPTED" | "REJECTED" | "PENDING_REVIEW") {
    setError(null);
    if (decision === "REJECTED" && notes.trim().length === 0) {
      setError("Add a short note on why, so the decision is legible later.");
      return;
    }
    const fd = new FormData();
    fd.set("id", id);
    fd.set("decision", decision);
    fd.set("notes", notes);
    startTransition(async () => {
      const result = await reviewApplicationAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Review note (required to reject)"
        rows={2}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-[length:var(--fs-3)] leading-[var(--lh-3)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap gap-2">
        {status !== "ACCEPTED" && (
          <Button type="button" size="sm" disabled={pending} onClick={() => submit("ACCEPTED")}>
            Accept
          </Button>
        )}
        {status !== "REJECTED" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => submit("REJECTED")}
          >
            Reject
          </Button>
        )}
        {status !== "PENDING_REVIEW" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => submit("PENDING_REVIEW")}
          >
            Reopen
          </Button>
        )}
      </div>
      {error && <p className="text-[length:var(--fs-2)] leading-[var(--lh-2)] text-destructive">{error}</p>}
    </div>
  );
}
