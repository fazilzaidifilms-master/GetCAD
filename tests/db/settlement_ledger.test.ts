import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb, givePayoutAccount } from "../helpers/db";

let db: Client;

const client = generateId();
const designer = generateId();
const qc = generateId();
const finance = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'DESIGNER','ACTIVE'), ($3,'QC','ACTIVE'), ($4,'FINANCE','ACTIVE')`,
    [client, designer, qc, finance],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Acme','a@acme.example')",
    [generateId(), client],
  );
  // Since 0023, release_escrow refuses to pay a payee with no verified payout
  // account. These suites exercise the ledger, not the KYC gate.
  await givePayoutAccount(db, designer);
  await givePayoutAccount(db, qc);
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

/** A funded order in the given status, with `held` in escrow. */
async function fundedOrder(status: string, held = 1000): Promise<string> {
  const id = generateId();
  await db.query(
    `INSERT INTO orders (id, client_id, designer_id, qc_reviewer_id, product_type, status,
       currency, price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,$3,$4,'CAD_MODEL',$5,'USD',1000,600,200,200)`,
    [id, client, designer, qc, status],
  );
  await db.query(
    `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
     VALUES ($1,'HOLD','CLIENT',$2,'USD',$3)`,
    [id, held, client],
  );
  return id;
}

const held = async (id: string) =>
  (await db.query("SELECT app.escrow_held($1) AS h", [id])).rows[0].h as number;
const settlement = async (id: string) =>
  (await db.query("SELECT public.settlement_state($1) AS s", [id])).rows[0].s;

describe("Test AT3 — escrow sign is defined per kind, in one place", () => {
  it("credits HOLD and REVERSAL, debits the rest", async () => {
    const { rows } = await db.query(
      `SELECT k, app.escrow_sign(k) AS sign FROM unnest(
         ARRAY['HOLD','REVERSAL','RELEASE','REFUND','PROCESSOR_FEE','CHARGEBACK']) AS k`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.k, r.sign]))).toEqual({
      HOLD: 1,
      REVERSAL: 1,
      RELEASE: -1,
      REFUND: -1,
      PROCESSOR_FEE: -1,
      CHARGEBACK: -1,
    });
  });

  it("a REVERSAL adds funds back — the case the old inline shortcut got backwards", async () => {
    const id = await fundedOrder("CLOSED");
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id]));
    expect(await held(id)).toBe(0);

    // The designer's payout failed at the processor and came back.
    await db.query(
      "SELECT public.record_settlement_event($1,'REVERSAL',600,$2)",
      [id, `rev_${id}`],
    );
    expect(await held(id)).toBe(600);
  });
});

describe("Test AT4 — conservation is enforced by the table, not just the functions", () => {
  it("REFUSES a direct debit larger than what is held, even bypassing the functions", async () => {
    const id = await fundedOrder("PAYMENT_HELD", 500);
    await expect(
      db.query(
        `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
         VALUES ($1,'RELEASE','DESIGNER',900,'USD',$2)`,
        [id, finance],
      ),
    ).rejects.toThrow(/escrow conservation/i);
    expect(await held(id)).toBe(500);
  });

  it("REFUSES draining an order twice", async () => {
    const id = await fundedOrder("PAYMENT_HELD", 300);
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
       VALUES ($1,'RELEASE','DESIGNER',300,'USD',$2)`,
      [id, finance],
    );
    expect(await held(id)).toBe(0);
    await expect(
      db.query(
        `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
         VALUES ($1,'RELEASE','DESIGNER',300,'USD',$2)`,
        [id, finance],
      ),
    ).rejects.toThrow(/escrow conservation/i);
  });

  it("allows credits without limit (money arriving is never over-drawn)", async () => {
    const id = await fundedOrder("PAYMENT_HELD", 100);
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
       VALUES ($1,'HOLD','CLIENT',50,'USD',$2)`,
      [id, client],
    );
    expect(await held(id)).toBe(150);
  });
});

describe("Test AT5 — partial refunds", () => {
  it("refunds part of the hold and leaves the order funded", async () => {
    const id = await fundedOrder("PAYMENT_HELD");
    const r = await asUser(finance, () =>
      db.query("SELECT public.refund_escrow($1, 400) AS r", [id]),
    );
    expect(r.rows[0].r.refunded).toBe(400);
    expect(await held(id)).toBe(600);

    // A PARTIAL refund must not end the order.
    const row = await db.query("SELECT status FROM orders WHERE id=$1", [id]);
    expect(row.rows[0].status).toBe("PAYMENT_HELD");
    expect((await settlement(id)).state).toBe("PARTIALLY_REFUNDED");
  });

  it("a refund that empties escrow DOES end the order as REFUNDED", async () => {
    const id = await fundedOrder("PAYMENT_HELD");
    await asUser(finance, () => db.query("SELECT public.refund_escrow($1)", [id]));
    expect(await held(id)).toBe(0);
    const row = await db.query("SELECT status FROM orders WHERE id=$1", [id]);
    expect(row.rows[0].status).toBe("REFUNDED");
    expect((await settlement(id)).state).toBe("REFUNDED");
  });

  it("REFUSES refunding more than is held, or a non-positive amount", async () => {
    const id = await fundedOrder("PAYMENT_HELD", 500);
    await expect(
      asUser(finance, () => db.query("SELECT public.refund_escrow($1, 900)", [id])),
    ).rejects.toThrow(/only 500 is held/i);
    await expect(
      asUser(finance, () => db.query("SELECT public.refund_escrow($1, 0)", [id])),
    ).rejects.toThrow(/must be positive/i);
    expect(await held(id)).toBe(500);
  });

  it("still refuses a non-FINANCE caller", async () => {
    const id = await fundedOrder("PAYMENT_HELD");
    await expect(
      asUser(client, () => db.query("SELECT public.refund_escrow($1, 100)", [id])),
    ).rejects.toThrow(/only FINANCE may refund/i);
  });
});

describe("Test AT6 — processor-driven events", () => {
  it("records a chargeback WITHOUT rewriting the order's lifecycle status", async () => {
    const id = await fundedOrder("CLOSED");
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id]));
    const before = (await db.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status;
    expect(before).toBe("PAYOUT_RELEASED");

    // The bank claws the money back long after the order finished. Previously
    // unrepresentable: PAYOUT_RELEASED has no outbound edge.
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, idempotency_key)
       VALUES ($1,'HOLD','CLIENT',1000,'USD',$2)`,
      [id, `refund_hold_${id}`],
    );
    await db.query("SELECT public.record_settlement_event($1,'CHARGEBACK',1000,$2,'dp_123')", [
      id,
      `cb_${id}`,
    ]);

    const after = (await db.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status;
    expect(after).toBe("PAYOUT_RELEASED"); // fulfilment history is not corrupted
    const s = await settlement(id);
    expect(s.state).toBe("CHARGED_BACK"); // ...but the money truth is recorded
    expect(s.charged_back).toBe(1000);
  });

  it("is IDEMPOTENT: a redelivered webhook cannot double-count", async () => {
    const id = await fundedOrder("PAYMENT_HELD");
    const key = `fee_${id}`;
    await db.query("SELECT public.record_settlement_event($1,'PROCESSOR_FEE',29,$2,'ch_1')", [id, key]);
    expect(await held(id)).toBe(971);

    // Same event delivered again — the UNIQUE key rejects it.
    await expect(
      db.query("SELECT public.record_settlement_event($1,'PROCESSOR_FEE',29,$2,'ch_1')", [id, key]),
    ).rejects.toThrow(/duplicate key|unique/i);
    expect(await held(id)).toBe(971);
  });

  it("requires an idempotency key and a settlement-only kind", async () => {
    const id = await fundedOrder("PAYMENT_HELD");
    await expect(
      db.query("SELECT public.record_settlement_event($1,'PROCESSOR_FEE',10,NULL)", [id]),
    ).rejects.toThrow(/idempotency key is required/i);
    await expect(
      db.query("SELECT public.record_settlement_event($1,'RELEASE',10,$2)", [id, `x_${id}`]),
    ).rejects.toThrow(/PROCESSOR_FEE, CHARGEBACK and REVERSAL only/i);
  });

  it("is server-to-server only — an authenticated user cannot call it", async () => {
    const id = await fundedOrder("PAYMENT_HELD");
    await expect(
      asUser(finance, () =>
        db.query("SELECT public.record_settlement_event($1,'PROCESSOR_FEE',10,$2)", [id, `y_${id}`]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Test AT7 — settlement state is derived from the ledger", () => {
  it("reports UNFUNDED, HELD and SETTLED across the lifecycle", async () => {
    const unfunded = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,'CAD_MODEL','DRAFT','USD',0,0,0,0)`,
      [unfunded, client],
    );
    expect((await settlement(unfunded)).state).toBe("UNFUNDED");

    const funded = await fundedOrder("PAYMENT_HELD");
    expect((await settlement(funded)).state).toBe("HELD");

    const closed = await fundedOrder("CLOSED");
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [closed]));
    const s = await settlement(closed);
    expect(s.state).toBe("SETTLED");
    expect(s.released).toBe(1000);
    expect(s.held).toBe(0);
  });

  it("the audit chain stays valid through every money event", async () => {
    const chain = await db.query("SELECT audit.verify_chain() AS result");
    expect(chain.rows[0].result.valid).toBe(true);
  });
});
