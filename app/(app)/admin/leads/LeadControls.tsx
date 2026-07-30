"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { setLeadStatusAction } from "./actions";

export function LeadControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function set(next: "HANDLED" | "NEW") {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", next);
    startTransition(async () => {
      await setLeadStatusAction(fd);
      router.refresh();
    });
  }

  return status === "HANDLED" ? (
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => set("NEW")}>
      Reopen
    </Button>
  ) : (
    <Button type="button" size="sm" disabled={pending} onClick={() => set("HANDLED")}>
      Mark handled
    </Button>
  );
}
