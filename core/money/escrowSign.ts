/**
 * Which direction each escrow movement pushes the held balance.
 *
 * This mirrors `app.escrow_sign()` in db/migrations/0021 and exists so the app
 * never re-derives it by hand. Both places used to inline the same trap:
 *
 *   kind === "HOLD" ? amount : -amount
 *
 * That is correct only while HOLD is the sole credit. The moment a REVERSAL
 * exists — a payout that failed and came back — the shortcut silently
 * SUBTRACTS money that actually returned, and the balance shown to a client is
 * wrong in the platform's favour. An unknown kind therefore throws here rather
 * than defaulting to a direction.
 */

export const ESCROW_KINDS = [
  "HOLD",
  "RELEASE",
  "REFUND",
  "PROCESSOR_FEE",
  "CHARGEBACK",
  "REVERSAL",
] as const;

export type EscrowKind = (typeof ESCROW_KINDS)[number];

const SIGN: Record<EscrowKind, 1 | -1> = {
  HOLD: 1, // client funds arrive
  REVERSAL: 1, // a failed payout/refund came back
  RELEASE: -1, // paid out to a party
  REFUND: -1, // returned to the client
  PROCESSOR_FEE: -1, // the processor's cut
  CHARGEBACK: -1, // clawed back by the client's bank
};

/** +1 if the movement adds to escrow, -1 if it takes from it. Throws on unknown kinds. */
export function escrowSign(kind: string): 1 | -1 {
  const sign = SIGN[kind as EscrowKind];
  if (sign === undefined) {
    throw new Error(`unknown escrow kind: ${kind}`);
  }
  return sign;
}

/** Net amount currently held, from a set of ledger legs. */
export function netHeld(legs: readonly { kind: string; amount: number }[]): number {
  return legs.reduce((net, leg) => net + escrowSign(leg.kind) * leg.amount, 0);
}
