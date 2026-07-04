import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const clientA = generateId();
const clientB = generateId();
const sales = generateId();
const ops = generateId();
const finance = generateId();

const oDraft = generateId();
const oSubmitted = generateId();
const oPaymentHeld = generateId();
const oClosed = generateId();

async function seenBy(sub: string): Promise<string[]> {
  await db.query("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub })]);
    await db.query("SET LOCAL ROLE authenticated");
    const { rows } = await db.query("SELECT id FROM orders");
    return rows.map((r) => r.id as string).sort();
  } finally {
    await db.query("ROLLBACK");
  }
}

async function order(id: string, status: string, client: string) {
  await db.query(
    `INSERT INTO orders (id, client_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,'CAD_MODEL',$3::order_status,'USD',10000,6000,1000,3000)`,
    [id, client, status],
  );
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'CLIENT','ACTIVE'),
       ($3,'SALES','ACTIVE'), ($4,'OPS','ACTIVE'), ($5,'FINANCE','ACTIVE')`,
    [clientA, clientB, sales, ops, finance],
  );
  await order(oDraft, "DRAFT", clientA);
  await order(oSubmitted, "SUBMITTED", clientA);
  await order(oPaymentHeld, "PAYMENT_HELD", clientA);
  await order(oClosed, "CLOSED", clientA);
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test P — staff see only orders they can act on", () => {
  it("SALES sees SUBMITTED (its queue) and nothing else", async () => {
    expect(await seenBy(sales)).toEqual([oSubmitted]);
  });

  it("OPS sees PAYMENT_HELD (assignable), not the sales/finance queues", async () => {
    const seen = await seenBy(ops);
    expect(seen).toContain(oPaymentHeld);
    expect(seen).not.toContain(oSubmitted);
    expect(seen).not.toContain(oDraft);
  });

  it("FINANCE sees CLOSED (payout) and PAYMENT_HELD (refund)", async () => {
    const seen = await seenBy(finance);
    expect(seen).toContain(oClosed);
    expect(seen).toContain(oPaymentHeld);
    expect(seen).not.toContain(oSubmitted);
  });

  it("the owning CLIENT still sees all of their own orders", async () => {
    expect(await seenBy(clientA)).toEqual([oDraft, oSubmitted, oPaymentHeld, oClosed].sort());
  });

  it("a DIFFERENT client sees none of them (no staff leakage to clients)", async () => {
    expect(await seenBy(clientB)).toEqual([]);
  });
});
