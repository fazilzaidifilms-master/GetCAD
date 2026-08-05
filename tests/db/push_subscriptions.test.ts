import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const alice = generateId();
const bob = generateId();
const order = generateId();

/** One browser profile — the same endpoint whoever is signed in. */
const SHARED_ENDPOINT = "https://fcm.googleapis.com/fcm/send/shared-workshop-laptop";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);

async function asUser<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub })]);
  await db.query("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await db.query("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
  }
}

function subscribe(sub: string, endpoint = SHARED_ENDPOINT) {
  return asUser(sub, () =>
    db.query("SELECT public.save_push_subscription($1,$2,$3) AS id", [endpoint, P256DH, AUTH]),
  );
}

async function ownerOf(endpoint: string): Promise<string | null> {
  const { rows } = await db.query("SELECT user_id FROM push_subscriptions WHERE endpoint = $1", [
    endpoint,
  ]);
  return rows[0]?.user_id ?? null;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES ($1,'DESIGNER','ACTIVE'), ($2,'DESIGNER','ACTIVE')`,
    [alice, bob],
  );
  await db.query(
    `INSERT INTO orders (id, client_id, designer_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,$3,'CAD_MODEL','IN_PROGRESS','INR',100000,60000,10000,30000)`,
    [order, alice, bob],
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("registering a device", () => {
  it("binds the subscription to the caller", async () => {
    await subscribe(alice);
    expect(await ownerOf(SHARED_ENDPOINT)).toBe(alice);
  });

  // THE ONE THAT MATTERS. A shared workshop laptop: Alice signs out, Bob signs
  // in, and the push service hands that browser the SAME endpoint. If the row
  // kept Alice, Bob's lock screen would show notifications about Alice's
  // orders — across the double-blind, to someone who never authenticated as her.
  it("transfers ownership when a different user registers the same browser", async () => {
    await subscribe(bob);
    expect(await ownerOf(SHARED_ENDPOINT)).toBe(bob);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM push_subscriptions");
    expect(rows[0].n).toBe(1); // replaced, not duplicated
  });

  it("refuses anything that is not an https endpoint", async () => {
    await expect(subscribe(alice, "http://evil.example/push")).rejects.toThrow(/https/i);
    await expect(subscribe(alice, "not a url")).rejects.toThrow(/https/i);
  });

  it("refuses an anonymous caller", async () => {
    await expect(
      db.query("SELECT public.save_push_subscription($1,$2,$3)", ["https://x.example/abc", P256DH, AUTH]),
    ).rejects.toThrow(/not authenticated/i);
  });

  it("rejects keys that are not the right shape", async () => {
    await expect(
      asUser(alice, () =>
        db.query("SELECT public.save_push_subscription($1,$2,$3)", [
          "https://fcm.googleapis.com/fcm/send/bad-keys",
          "has spaces",
          AUTH,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("reading a device", () => {
  // An endpoint is a capability: whoever holds it can push to that lock screen
  // forever, without authenticating to us. Reading someone else's is worse than
  // most read leaks because the victim cannot tell where it came from.
  it("shows a user only their own subscriptions", async () => {
    const seenByBob = await asUser(bob, async () => {
      const { rows } = await db.query("SELECT count(*)::int AS n FROM push_subscriptions");
      return rows[0].n as number;
    });
    const seenByAlice = await asUser(alice, async () => {
      const { rows } = await db.query("SELECT count(*)::int AS n FROM push_subscriptions");
      return rows[0].n as number;
    });
    expect(seenByBob).toBe(1); // bob owns it after the transfer above
    expect(seenByAlice).toBe(0);
  });

  it("blocks a direct write even from the owner", async () => {
    await expect(
      asUser(bob, () =>
        db.query("UPDATE push_subscriptions SET endpoint = 'https://x.example/y' WHERE user_id = $1", [
          bob,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("removing a device", () => {
  it("lets the owner turn notifications off", async () => {
    const { rows } = await asUser(bob, () =>
      db.query("SELECT public.delete_push_subscription($1) AS n", [SHARED_ENDPOINT]),
    );
    expect(rows[0].n).toBe(1);
    expect(await ownerOf(SHARED_ENDPOINT)).toBeNull();
  });

  // Knowing an endpoint must not let you silence its owner.
  it("does not let one user delete another's subscription", async () => {
    await subscribe(alice);
    const { rows } = await asUser(bob, () =>
      db.query("SELECT public.delete_push_subscription($1) AS n", [SHARED_ENDPOINT]),
    );
    expect(rows[0].n).toBe(0);
    expect(await ownerOf(SHARED_ENDPOINT)).toBe(alice);
  });
});

describe("the push queue", () => {
  async function pending(): Promise<number> {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM notifications WHERE pushed_at IS NULL",
    );
    return rows[0].n as number;
  }

  it("starts empty — the migration retires everything that predates push", async () => {
    expect(await pending()).toBe(0);
  });

  it("queues a notification produced by the fan-out trigger", async () => {
    // Bob (the designer) posts; the fan-out notifies alice (the client).
    await db.query("SELECT app.notify($1,$2,'MESSAGE',$3,'New message on your order.')", [
      alice,
      bob,
      order,
    ]);
    expect(await pending()).toBe(1);
  });

  it("claims a batch and counts the attempt", async () => {
    const { rows } = await db.query("SELECT * FROM public.claim_push_notifications(10)");
    expect(rows).toHaveLength(1);
    expect(rows[0].push_attempts).toBe(1);
    // Still pending — claiming is not delivering.
    expect(await pending()).toBe(1);
  });

  it("stops retrying a notification that keeps failing", async () => {
    await db.query("SELECT * FROM public.claim_push_notifications(10)"); // 2
    await db.query("SELECT * FROM public.claim_push_notifications(10)"); // 3
    const { rows } = await db.query("SELECT * FROM public.claim_push_notifications(10)");
    expect(rows).toHaveLength(0);
  });

  it("marks a batch delivered", async () => {
    const { rows } = await db.query(
      "SELECT public.mark_push_sent(ARRAY(SELECT id FROM notifications WHERE pushed_at IS NULL)) AS n",
    );
    expect(rows[0].n).toBe(1);
    expect(await pending()).toBe(0);
  });

  // A phone that was off for three days must not vibrate eleven times about
  // things the person has already read in the app.
  it("retires a stale notification instead of delivering it late", async () => {
    await db.query("SELECT app.notify($1,$2,'PREVIEW',$3,'Your order is ready to preview.')", [
      alice,
      bob,
      order,
    ]);
    await db.query(
      "UPDATE notifications SET created_at = now() - interval '3 days' WHERE pushed_at IS NULL",
    );
    const { rows } = await db.query("SELECT * FROM public.claim_push_notifications(10)");
    expect(rows).toHaveLength(0);
    expect(await pending()).toBe(0);
  });

  it("is not reachable by an ordinary signed-in user", async () => {
    await expect(
      asUser(alice, () => db.query("SELECT * FROM public.claim_push_notifications(10)")),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(alice, () => db.query("SELECT public.expire_push_subscription($1)", [SHARED_ENDPOINT])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps the audit chain valid throughout", async () => {
    const { rows } = await db.query("SELECT audit.verify_chain() AS v");
    expect(rows[0].v.valid).toBe(true);
  });
});
