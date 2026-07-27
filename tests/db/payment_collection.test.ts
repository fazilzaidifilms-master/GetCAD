import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;
const client = generateId();
const other = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    "INSERT INTO users (id, role, status) VALUES ($1,'CLIENT','ACTIVE'), ($2,'CLIENT','ACTIVE')",
    [client, other],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Acme','a@acme.example')",
    [generateId(), client],
  );
});
afterAll(async () => {
  if (db) await db.end();
});

async function asUser<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub, role: "authenticated" }),
  ]);
  await db.query("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await db.query("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
  }
}

async function quotedOrder(price = 4500000): Promise<string> {
  const id = generateId();
  await db.query(
    `INSERT INTO orders (id, client_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,'CAD_MODEL','QUOTED','INR',$3,$4,$5,$6)`,
    [id, client, price, Math.round(price * 0.6), Math.round(price * 0.2), Math.round(price * 0.2)],
  );
  return id;
}

const held = async (id: string) =>
  (await db.query("SELECT app.escrow_held($1) AS h", [id])).rows[0].h as number;
const status = async (id: string) =>
  (await db.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status as string;

describe("Test AU4 — a client can no longer fund their own order", () => {
  it("hold_escrow is REVOKED from authenticated — the button is gone for good", async () => {
    const id = await quotedOrder();
    await expect(
      asUser(client, () => db.query("SELECT public.hold_escrow($1)", [id])),
    ).rejects.toThrow(/permission denied/i);
    expect(await held(id)).toBe(0);
    expect(await status(id)).toBe("QUOTED");
  });

  it("confirm_payment is server-to-server only", async () => {
    await expect(
      asUser(client, () =>
        db.query("SELECT public.confirm_payment('order_x', 1, 'INR', 'k')"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("open_payment_intent is server-to-server only", async () => {
    const id = await quotedOrder();
    await expect(
      asUser(client, () => db.query("SELECT public.open_payment_intent($1,'order_x')", [id])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Test AU5 — opening a collection", () => {
  it("records the amount from the ORDER, never from the caller", async () => {
    const id = await quotedOrder(4500000);
    await db.query("SELECT public.open_payment_intent($1,'order_rp_1')", [id]);
    const { rows } = await db.query(
      "SELECT amount, currency, status FROM payment_intents WHERE external_ref='order_rp_1'",
    );
    expect(rows[0]).toEqual({ amount: 4500000, currency: "INR", status: "PENDING" });
  });

  it("refuses an order that is not QUOTED", async () => {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,'CAD_MODEL','DRAFT','INR',0,0,0,0)`,
      [id, client],
    );
    await expect(
      db.query("SELECT public.open_payment_intent($1,'order_rp_bad')", [id]),
    ).rejects.toThrow(/only collect payment for a QUOTED order/i);
  });

  it("refuses a duplicate external reference", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_dupe')", [id]);
    const id2 = await quotedOrder();
    await expect(
      db.query("SELECT public.open_payment_intent($1,'order_rp_dupe')", [id2]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("Test AU6 — confirming a payment", () => {
  it("funds escrow and moves the order to PAYMENT_HELD", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_ok')", [id]);
    const res = await db.query(
      "SELECT public.confirm_payment('order_rp_ok', 4500000, 'INR', 'razorpay:pay_1', 'pay_1') AS r",
    );
    expect(res.rows[0].r.already_confirmed).toBe(false);
    expect(await held(id)).toBe(4500000);
    expect(await status(id)).toBe("PAYMENT_HELD");

    // The ledger row carries the processor's reference for reconciliation.
    const leg = await db.query(
      "SELECT external_ref, idempotency_key, payee_id FROM escrow_ledger WHERE order_id=$1",
      [id],
    );
    expect(leg.rows[0]).toEqual({
      external_ref: "pay_1",
      idempotency_key: "razorpay:pay_1",
      payee_id: client,
    });
  });

  it("REFUSES an amount that does not match the intent — the tampering case", async () => {
    const id = await quotedOrder(4500000);
    await db.query("SELECT public.open_payment_intent($1,'order_rp_short')", [id]);
    // A webhook claiming ₹1 was paid for a ₹45,000 order.
    await expect(
      db.query("SELECT public.confirm_payment('order_rp_short', 100, 'INR', 'k1')"),
    ).rejects.toThrow(/does not match the intent amount/i);
    expect(await held(id)).toBe(0);
    expect(await status(id)).toBe("QUOTED");
  });

  it("REFUSES a currency mismatch", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_cur')", [id]);
    await expect(
      db.query("SELECT public.confirm_payment('order_rp_cur', 4500000, 'USD', 'k2')"),
    ).rejects.toThrow(/currency/i);
    expect(await held(id)).toBe(0);
  });

  it("REFUSES an unknown external reference", async () => {
    await expect(
      db.query("SELECT public.confirm_payment('order_never_opened', 100, 'INR', 'k3')"),
    ).rejects.toThrow(/no payment intent/i);
  });

  it("is IDEMPOTENT: a redelivered webhook is a no-op, not a double-fund", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_dup')", [id]);
    await db.query(
      "SELECT public.confirm_payment('order_rp_dup', 4500000, 'INR', 'razorpay:pay_dup', 'pay_dup')",
    );
    expect(await held(id)).toBe(4500000);

    // Razorpay redelivers the same event.
    const again = await db.query(
      "SELECT public.confirm_payment('order_rp_dup', 4500000, 'INR', 'razorpay:pay_dup', 'pay_dup') AS r",
    );
    expect(again.rows[0].r.already_confirmed).toBe(true);
    expect(await held(id)).toBe(4500000); // NOT doubled
    const legs = await db.query(
      "SELECT count(*)::int AS n FROM escrow_ledger WHERE order_id=$1",
      [id],
    );
    expect(legs.rows[0].n).toBe(1);
  });

  it("requires an idempotency key", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_nokey')", [id]);
    await expect(
      db.query("SELECT public.confirm_payment('order_rp_nokey', 4500000, 'INR', NULL)"),
    ).rejects.toThrow(/idempotency key is required/i);
  });

  it("refuses to fund an order that already moved on", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_late')", [id]);
    await db.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [id]);
    await expect(
      db.query("SELECT public.confirm_payment('order_rp_late', 4500000, 'INR', 'k4')"),
    ).rejects.toThrow(/no longer awaiting payment/i);
  });
});

describe("Test AU7 — failed collections and visibility", () => {
  it("marks an intent FAILED without touching money or the order", async () => {
    const id = await quotedOrder();
    await db.query("SELECT public.open_payment_intent($1,'order_rp_fail')", [id]);
    await db.query("SELECT public.fail_payment_intent('order_rp_fail')");
    const { rows } = await db.query(
      "SELECT status FROM payment_intents WHERE external_ref='order_rp_fail'",
    );
    expect(rows[0].status).toBe("FAILED");
    expect(await held(id)).toBe(0);
    expect(await status(id)).toBe("QUOTED"); // still payable
  });

  it("payment_intents is not readable by any client role", async () => {
    await expect(
      asUser(client, () => db.query("SELECT * FROM payment_intents")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the audit chain stays valid across the whole collection flow", async () => {
    const chain = await db.query("SELECT audit.verify_chain() AS result");
    expect(chain.rows[0].result.valid).toBe(true);
  });
});
