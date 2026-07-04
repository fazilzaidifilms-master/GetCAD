/**
 * Which status changes may the current actor make on an order right now?
 *
 * Pure mirror of the database's transition_order() rules, used to render only
 * the legal action buttons. The DATABASE remains authoritative — this never
 * grants access, it only avoids offering a move the DB would reject anyway.
 */

export interface TransitionRow {
  from_status: string;
  to_status: string;
  actor_role: string;
  actor_scope: "STAFF" | "CLIENT_PARTY" | "DESIGNER_PARTY";
}

export interface ActorContext {
  /** The actor's app role (users.role). */
  role: string;
  /** Is the actor this order's client? */
  isOrderClient: boolean;
  /** Is the actor this order's assigned designer? */
  isOrderDesigner: boolean;
}

/**
 * Legal target statuses for `actor` on an order currently in `currentStatus`,
 * given the full transition graph. De-duplicated, order preserved.
 */
export function availableTransitions(
  currentStatus: string,
  transitions: TransitionRow[],
  actor: ActorContext,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of transitions) {
    if (t.from_status !== currentStatus) continue;
    if (t.actor_role !== actor.role) continue;
    if (t.actor_scope === "CLIENT_PARTY" && !actor.isOrderClient) continue;
    if (t.actor_scope === "DESIGNER_PARTY" && !actor.isOrderDesigner) continue;
    if (seen.has(t.to_status)) continue;
    seen.add(t.to_status);
    out.push(t.to_status);
  }
  return out;
}
