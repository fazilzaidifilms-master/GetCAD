import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS, isNotificationKind, pushMessageFor } from "./push";

const ORDER = "ord_7Qx4Kb2vN9";

describe("what reaches a lock screen", () => {
  // The whole point of the module. A lock screen is read by whoever holds the
  // phone, and this product's premise is that the two sides never learn who the
  // other is.
  it("never contains anything but fixed, context-free wording", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const msg = pushMessageFor(kind, ORDER)!;
      expect(msg.title).toBeTruthy();
      expect(msg.body).toBeTruthy();
      // No digits at all in visible text: an id, an amount, a count and a date
      // all contain them, and none of those belong on a lock screen.
      expect(`${msg.title} ${msg.body}`, kind).not.toMatch(/\d/);
      // The order id is legitimate in routing, never in what is displayed.
      expect(msg.title, kind).not.toContain(ORDER);
      expect(msg.body, kind).not.toContain(ORDER);
    }
  });

  it("says nothing about money", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const msg = pushMessageFor(kind, ORDER)!;
      expect(`${msg.title} ${msg.body}`, kind).not.toMatch(/[₹$€£]|\brupee|\bINR\b|\bUSD\b/i);
    }
  });

  // A payload identical for every recipient of a kind is one that cannot leak
  // by construction: two different people's notifications are byte-for-byte the
  // same except for the order they point at.
  it("depends on nothing but the kind and the order id", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const a = pushMessageFor(kind, ORDER)!;
      const b = pushMessageFor(kind, ORDER)!;
      expect(a).toEqual(b);
    }
  });
});

describe("pushMessageFor", () => {
  it("covers every kind the fan-out trigger produces", () => {
    // Read the migration rather than trusting the constant: the database is the
    // thing that decides which kinds exist, and a kind added there without
    // wording here would silently never be pushed.
    const sql = readFileSync(join(process.cwd(), "db/migrations/0015_notifications.sql"), "utf8");
    const emitted = new Set(
      [...sql.matchAll(/app\.notify\([^)]*?,\s*'([A-Z_]+)'\s*,/g)].map((m) => m[1]!),
    );
    expect(emitted.size).toBeGreaterThan(5);
    for (const kind of emitted) {
      expect(pushMessageFor(kind, ORDER), `kind ${kind} has no wording`).not.toBeNull();
    }
  });

  // Fail closed. An unknown kind has no approved wording, and falling back to
  // the database's summary column is precisely what this module refuses to do.
  it("returns null rather than inventing wording for an unknown kind", () => {
    expect(pushMessageFor("SOMETHING_NEW", ORDER)).toBeNull();
    expect(pushMessageFor("", ORDER)).toBeNull();
    expect(pushMessageFor("message", ORDER)).toBeNull(); // case matters
  });

  it("routes a tap to the order it is about", () => {
    expect(pushMessageFor("MESSAGE", ORDER)!.url).toBe(`/orders/${ORDER}`);
  });

  it("falls back to the dashboard when there is no order", () => {
    expect(pushMessageFor("PAYOUT", null)!.url).toBe("/dashboard");
  });

  // Six files uploaded during one delivery must be one notification, not six
  // buzzes.
  it("collapses repeats of the same event on the same order", () => {
    const first = pushMessageFor("FILE", ORDER)!;
    const second = pushMessageFor("FILE", ORDER)!;
    expect(first.tag).toBe(second.tag);
  });

  // ...but not across orders, or the second order's message never appears.
  it("does not collapse across orders or across kinds", () => {
    expect(pushMessageFor("FILE", ORDER)!.tag).not.toBe(pushMessageFor("FILE", "ord_other")!.tag);
    expect(pushMessageFor("FILE", ORDER)!.tag).not.toBe(pushMessageFor("MESSAGE", ORDER)!.tag);
  });

  it("gives a null order a stable tag rather than undefined", () => {
    expect(pushMessageFor("PAYOUT", null)!.tag).toBe("PAYOUT:none");
  });
});

describe("isNotificationKind", () => {
  it("accepts every listed kind and nothing else", () => {
    for (const kind of NOTIFICATION_KINDS) expect(isNotificationKind(kind)).toBe(true);
    expect(isNotificationKind("NOPE")).toBe(false);
  });
});
