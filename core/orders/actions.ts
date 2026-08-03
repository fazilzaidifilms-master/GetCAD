/**
 * What an actor may DO on an order right now, expressed as buttons.
 *
 * `availableTransitions` answers which target statuses are legal. That is not
 * enough to render a screen: a status is not a verb. `DELIVERED` has to become
 * "Release the files", `REVISION_REQUESTED` has to become "Request a revision",
 * and one of them needs a written reason before it can be sent while the other
 * does not.
 *
 * WHY THIS IS ONE TABLE AND NOT FIFTEEN COMPONENTS. Without it, every screen
 * that shows an order re-derives the same judgement — which button is the
 * primary one, which is destructive, which needs confirming — and they drift.
 * The drift is not cosmetic: a screen that forgets `DISPUTED` is destructive
 * renders "Raise a dispute" as the friendly blue button next to "Approve".
 *
 * So: adding a transition to the database means adding one row here, and every
 * surface in the application picks it up at once. That is the property that
 * makes later change cheap, and it only holds while this stays the single
 * source of presentation for actions.
 *
 * Framework-free on purpose (no next/*, no react) — it is the rules, not the
 * rendering, and it is unit-tested as such.
 */

import { availableTransitions, type ActorContext, type TransitionRow } from "./availableTransitions";

/**
 * How much weight a button carries.
 *
 * `primary` — the expected next step. At most ONE per screen; when two
 * transitions both claim it, `orderActions` keeps the higher-ranked one and
 * demotes the rest, because two equally-loud buttons is the same as none.
 * `danger` — money moves the wrong way, or the order leaves the happy path.
 */
export type ActionIntent = "primary" | "secondary" | "danger";

export interface OrderAction {
  /** The status this action moves the order to — what the DB will be asked for. */
  to: string;
  /** Verb shown on the button. Imperative, and specific about consequence. */
  label: string;
  intent: ActionIntent;
  /**
   * Text for a confirmation step, or null to act immediately. Present wherever
   * the action is effectively irreversible from the actor's side.
   */
  confirm: string | null;
  /**
   * Whether the actor must type a reason. Mirrors the database, which refuses
   * these transitions without one — asking here is a courtesy, not the control.
   */
  requiresReason: boolean;
}

interface ActionSpec {
  label: string;
  intent: ActionIntent;
  confirm?: string;
  requiresReason?: boolean;
  /** Higher wins when two actions would both be primary. */
  rank?: number;
}

/**
 * One row per target status, with an optional per-origin override where the
 * same destination means something different depending on where you came from.
 *
 * `CLIENT_PREVIEW` is the case that forces the override mechanism to exist:
 * reached from `QC_REVIEW` it is a reviewer passing work forward, and reached
 * from `REVISION_REQUESTED` it is a designer re-submitting. Same target, two
 * different sentences.
 */
const BY_TARGET: Record<string, ActionSpec> = {
  SUBMITTED: { label: "Submit for a quote", intent: "primary", rank: 60 },
  QUOTED: { label: "Send the quote", intent: "primary", rank: 60 },
  ASSIGNED: { label: "Assign a designer", intent: "primary", rank: 70 },
  IN_PROGRESS: { label: "Start work", intent: "primary", rank: 60 },
  DESIGNER_SUBMITTED: { label: "Submit this version", intent: "primary", rank: 70 },
  QC_REVIEW: { label: "Send to QC review", intent: "primary", rank: 70 },
  CLIENT_PREVIEW: { label: "Pass review", intent: "primary", rank: 70 },
  APPROVED: {
    label: "Approve and release",
    intent: "primary",
    rank: 90,
    // The client's approval is what unlocks the money. Nothing downstream asks
    // them again, so this is the last point at which "are you sure" is useful.
    confirm: "Approving releases the payment from escrow. This cannot be undone.",
  },
  DELIVERED: { label: "Release the files", intent: "primary", rank: 70 },
  CLOSED: { label: "Close the order", intent: "secondary", rank: 40 },
  PAYOUT_RELEASED: {
    label: "Send payouts",
    intent: "primary",
    rank: 80,
    confirm: "This pays the designer and the reviewer. It cannot be reversed here.",
  },
  REVISION_REQUESTED: {
    label: "Request a revision",
    intent: "secondary",
    rank: 50,
    requiresReason: true,
  },
  DISPUTED: {
    label: "Raise a dispute",
    intent: "danger",
    requiresReason: true,
    confirm: "Escrow freezes until this is resolved. Work stops.",
  },
  CANCELLED: {
    label: "Cancel this order",
    intent: "danger",
    confirm: "The order is closed and cannot be reopened.",
  },
  REFUNDED: {
    label: "Refund the client",
    intent: "danger",
    requiresReason: true,
    confirm: "Money is returned to the client. This cannot be reversed here.",
  },
};

/** Overrides keyed `FROM>TO`, for targets whose meaning depends on the origin. */
const BY_EDGE: Record<string, Partial<ActionSpec>> = {
  "REVISION_REQUESTED>CLIENT_PREVIEW": { label: "Submit the revision" },
  "DISPUTED>CLOSED": { label: "Resolve and close", rank: 80, intent: "primary" },
  // Re-quoting an order that was already priced: the client has seen a number,
  // so this replaces it rather than setting it.
  "QUOTED>QUOTED": { label: "Revise the quote", intent: "secondary" },
};

function specFor(from: string, to: string): ActionSpec {
  const base = BY_TARGET[to] ?? {
    // An unknown target is still offered — the database is authoritative and
    // may legally allow something this table has not been taught yet. It just
    // never gets to be the primary button.
    label: to
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase()),
    intent: "secondary" as ActionIntent,
    rank: 0,
  };
  return { ...base, ...(BY_EDGE[`${from}>${to}`] ?? {}) };
}

/**
 * The actions to render, most important first, with at most one primary.
 *
 * Ordering is by rank rather than by the transition table's own order, so the
 * button a person is most likely to want is first on a phone — where the list
 * is vertical and the last item may be below the fold.
 */
export function orderActions(
  currentStatus: string,
  transitions: TransitionRow[],
  actor: ActorContext,
): OrderAction[] {
  const targets = availableTransitions(currentStatus, transitions, actor);

  const ranked = targets
    .map((to) => ({ to, spec: specFor(currentStatus, to) }))
    .sort((a, b) => (b.spec.rank ?? 0) - (a.spec.rank ?? 0));

  let primaryTaken = false;
  return ranked.map(({ to, spec }) => {
    let intent = spec.intent;
    if (intent === "primary") {
      if (primaryTaken) intent = "secondary";
      else primaryTaken = true;
    }
    return {
      to,
      label: spec.label,
      intent,
      confirm: spec.confirm ?? null,
      requiresReason: spec.requiresReason ?? false,
    };
  });
}

/** The single action to feature, if there is one. Null when the actor is waiting. */
export function primaryAction(actions: OrderAction[]): OrderAction | null {
  return actions.find((a) => a.intent === "primary") ?? null;
}
