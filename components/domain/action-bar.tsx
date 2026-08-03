"use client";

import { useState } from "react";

import type { OrderAction } from "@/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The actions available on an order, rendered from the table in
 * `core/orders/actions`.
 *
 * This component decides NOTHING about which actions exist, what they are
 * called, or which is the important one — it is handed a list and renders it.
 * All of that lives in core, framework-free and unit-tested, so a rule change
 * lands in one file and every surface follows.
 *
 * What it does own is the two interaction guarantees that a phone makes
 * necessary:
 *
 *   - Confirmation is INLINE, not a dialog. A modal over a small screen hides
 *     the order you are deciding about, and "Approve and release" is a decision
 *     you want to make while still looking at the thing.
 *   - A reason is collected BEFORE the request, not after a failure. The
 *     database refuses these transitions without one; discovering that via a
 *     server error, having lost what you typed, is the worst version of it.
 */
const INTENT_VARIANT = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
} as const;

export function ActionBar({
  actions,
  onAct,
  pending = false,
  className,
}: {
  actions: OrderAction[];
  /** Runs the transition. Reason is present exactly when the action requires one. */
  onAct: (action: OrderAction, reason?: string) => void;
  pending?: boolean;
  className?: string;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (actions.length === 0) return null;

  const active = actions.find((a) => a.to === openFor) ?? null;
  const needsReason = active?.requiresReason ?? false;
  const reasonReady = !needsReason || reason.trim().length > 0;

  function begin(action: OrderAction) {
    // Straight through when there is nothing to confirm and nothing to say.
    if (!action.confirm && !action.requiresReason) {
      onAct(action);
      return;
    }
    setReason("");
    setOpenFor(action.to);
  }

  return (
    <div
      className={cn(
        // Sticky and safe-area aware: on a phone this sits above the home
        // indicator, and the primary action must never be the thing below the
        // fold on a screen whose whole purpose is to take an action.
        "sticky bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur",
        "px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3",
        className,
      )}
    >
      {active ? (
        <div className="space-y-3">
          {active.confirm ? (
            <p className="text-sm text-muted-foreground">{active.confirm}</p>
          ) : null}

          {needsReason ? (
            <div className="space-y-1.5">
              <label htmlFor="action-reason" className="text-sm font-medium">
                Why?
              </label>
              <Textarea
                id="action-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="This is recorded on the order and shown to the other side."
                autoFocus
              />
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              variant={INTENT_VARIANT[active.intent]}
              className="min-h-[var(--ctl)] flex-1"
              disabled={pending || !reasonReady}
              onClick={() => onAct(active, needsReason ? reason.trim() : undefined)}
            >
              {pending ? "Working…" : active.label}
            </Button>
            <Button
              variant="ghost"
              className="min-h-[var(--ctl)]"
              disabled={pending}
              onClick={() => setOpenFor(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {actions.map((action) => (
            <Button
              key={action.to}
              variant={INTENT_VARIANT[action.intent]}
              className="min-h-[var(--ctl)] w-full"
              disabled={pending}
              onClick={() => begin(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
