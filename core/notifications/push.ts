/**
 * What a push notification says.
 *
 * THE THREAT THIS FILE EXISTS FOR. A push notification is rendered by the
 * operating system on a lock screen. It is read by whoever is holding the
 * phone — a colleague, a spouse, someone on a train sitting next to a jeweller
 * whose shop name is on their tote bag. It is the only surface in this product
 * where content is displayed to a person who has not authenticated, and it is
 * the one place where our double-blind guarantee cannot be enforced by RLS,
 * because the bytes have already left the database.
 *
 * SO THE BODIES ARE CONSTANTS. `pushMessageFor` takes a kind and an opaque
 * order id and nothing else. It does NOT take the notification's `summary`
 * column, even though those summaries are identity-free today and tested to be
 * so. The reason is that `summary` is a text column written by a database
 * trigger; a future event could interpolate a name into it, and the review that
 * let that through would be looking at a migration, not at this file. By
 * refusing the input entirely, no change to the database can put a name on a
 * lock screen. That is a stronger guarantee than checking the string, and it
 * costs us nothing: there is nothing useful a summary could add that the fixed
 * text does not already say.
 *
 * WHAT IS SAFE TO INCLUDE. The order id. It is opaque (see core/ids), it means
 * nothing to a stranger, and the recipient needs it to be routed to the right
 * screen. It goes in the URL and the tag — never in the visible text, where it
 * would be noise.
 */

/** The kinds `app.fanout_notifications` (0015) can produce. */
export const NOTIFICATION_KINDS = [
  "MESSAGE",
  "FILE",
  "QUOTED",
  "PAYOUT",
  "REFUNDED",
  "DISPUTE",
  "ASSIGNED",
  "PREVIEW",
  "DELIVERED",
  "SUBMITTED",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap lands. */
  url: string;
  /**
   * Collapse key. Two notifications with the same tag replace each other on the
   * device rather than stacking.
   *
   * This is load-bearing, not polish. A delivery is six or more files uploaded
   * in a row, each firing FILE_VERSION_ADDED; without a tag that is six
   * buzzes and six lines on the lock screen for one event. Keyed by order AND
   * kind, so a message on one order still shows separately from a message on
   * another — collapsing those would hide the second one entirely.
   */
  tag: string;
}

interface Copy {
  title: string;
  body: string;
}

/**
 * The complete vocabulary of anything this product will ever put on a lock
 * screen.
 *
 * Written to be true without context. "Work has been submitted" reads the same
 * whether you have one order or forty, and says nothing about who, what, or how
 * much. No amounts: a payout figure on a lock screen tells a bystander what
 * this person earns.
 */
const COPY: Record<NotificationKind, Copy> = {
  MESSAGE: { title: "New message", body: "There's a new message on one of your orders." },
  FILE: { title: "New files", body: "Files were added to one of your orders." },
  QUOTED: { title: "Quote ready", body: "One of your orders has been quoted." },
  PAYOUT: { title: "Payout released", body: "A payout has been released to you." },
  REFUNDED: { title: "Order refunded", body: "One of your orders has been refunded." },
  DISPUTE: { title: "Dispute update", body: "There's an update to a dispute on one of your orders." },
  ASSIGNED: { title: "New assignment", body: "You've been assigned to an order." },
  PREVIEW: { title: "Ready for review", body: "One of your orders is ready for you to review." },
  DELIVERED: { title: "Order delivered", body: "One of your orders has been delivered." },
  SUBMITTED: { title: "Work submitted", body: "Work has been submitted on one of your orders." },
};

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/**
 * Build the payload for one notification row, or null if it should not be
 * pushed at all.
 *
 * Null for an unrecognised kind. A kind this file has never heard of has no
 * approved wording, and inventing one — or falling back to the database's
 * summary — is exactly the disclosure the fixed table prevents. A missed
 * notification is a nuisance; a name on a lock screen is the product failing.
 */
export function pushMessageFor(kind: string, orderId: string | null): PushMessage | null {
  if (!isNotificationKind(kind)) return null;

  const copy = COPY[kind];
  return {
    title: copy.title,
    body: copy.body,
    // Without an order there is nowhere specific to go; the dashboard lists
    // everything and is never wrong.
    url: orderId ? `/orders/${orderId}` : "/dashboard",
    tag: `${kind}:${orderId ?? "none"}`,
  };
}
