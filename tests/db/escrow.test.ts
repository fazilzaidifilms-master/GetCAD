import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const client = generateId();
const sales = generateId();
const ops = generateId();
const finance = generateId();
const designer = generateId();

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

async function statusOf(id: string): Promise<string> {
  const { rows } = await db.query("SELECT status FROM orders WHERE id = $1", [id]);
  return rows[0].status;
}
async function held(id: string): Promise<number> {
  const { rows } = await db.query("SELECT app.escrow_held($1) AS h", [id]);
  return rows[0].h;
}
async function ledgerSum(id: string, kind: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT coalesce(sum(amount),0)::int AS s FROM escrow_ledger WHERE order_id=$1 AND kind=$2",
    [id, kind],
  );
  return rows[0].s;
}

// Create an order and walk it (via the real functions) to a given status.
async function newOrder(): Promise<string> {
  const id = generateId();
  await asUser(client, () => db.query("SELECT public.create_order($1,$2,'USD')", [id, "CAD_MODEL"]));
  await asUser(client, () =>
    db.query("SELECT public.transition_order($1,'SUBMITTED'::order_status)", [id]),
  );
  return id;
}
async function quote(id: string) {
  return asUser(sales, () =>
    db.query("SELECT public.quote_order($1,$2,$3,$4,$5)", [id, 10000, 6000, 1000, 3000]),
  );
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'),($2,'SALES','ACTIVE'),($3,'OPS','ACTIVE'),
       ($4,'FINANCE','ACTIVE'),($5,'DESIGNER','ACTIVE')`,
    [client, sales, ops, finance, designer],
  );
  await db.query(
    `INSERT INTO designer_profiles (id, user_id, legal_name, email, agreement_accepted_at, agreement_version)
     VALUES ($1,$2,'Dana','dana@x.example', now(), (SELECT version FROM app.current_agreement('DESIGNER')))`,
    [generateId(), designer],
  );
  await db.query(
    `INSERT INTO agreement_acceptances (agreement_id, user_id, content_sha256)
     SELECT id, $1, content_sha256 FROM app.current_agreement('DESIGNER')`,
    [designer],
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test U — escrow ledger + money conservation", () => {
  it("rejects a quote whose split does not sum to the total", async () => {
    const id = await newOrder();
    await expect(
      asUser(sales, () => db.query("SELECT public.quote_order($1,$2,$3,$4,$5)", [id, 10000, 6000, 1000, 2000])),
    ).rejects.toThrow(/must sum to price_total/i);
    expect(await statusOf(id)).toBe("SUBMITTED"); // unchanged
  });

  it("a conserving quote sets the money and moves to QUOTED (SALES only)", async () => {
    const id = await newOrder();
    await expect(
      asUser(client, () => db.query("SELECT public.quote_order($1,$2,$3,$4,$5)", [id, 10000, 6000, 1000, 3000])),
    ).rejects.toThrow(/only SALES/i);
    await quote(id);
    expect(await statusOf(id)).toBe("QUOTED");
    const { rows } = await db.query(
      "SELECT price_total, designer_payout, qc_payout, platform_commission FROM orders WHERE id=$1",
      [id],
    );
    expect(rows[0]).toEqual({
      price_total: 10000,
      designer_payout: 6000,
      qc_payout: 1000,
      platform_commission: 3000,
    });
  });

  it("holding records the full price and flips to PAYMENT_HELD; cannot hold twice", async () => {
    const id = await newOrder();
    await quote(id);
    // only the client may fund
    await expect(
      asUser(sales, () => db.query("SELECT public.hold_escrow($1)", [id])),
    ).rejects.toThrow(/only the order's client/i);

    await asUser(client, () => db.query("SELECT public.hold_escrow($1)", [id]));
    expect(await statusOf(id)).toBe("PAYMENT_HELD");
    expect(await held(id)).toBe(10000);

    // a second hold is impossible (status no longer QUOTED, and the unique index)
    await expect(
      asUser(client, () => db.query("SELECT public.hold_escrow($1)", [id])),
    ).rejects.toThrow(/only fund a QUOTED order/i);
  });

  it("releasing pays legs that sum to the held amount; net held returns to 0 (FINANCE only)", async () => {
    const id = await newOrder();
    await quote(id);
    // Walk to CLOSED using a QC user for the QC-role steps.
    const qc = generateId();
    await db.query("INSERT INTO users (id, role, status) VALUES ($1,'QC','ACTIVE')", [qc]);
    await asUser(client, () => db.query("SELECT public.hold_escrow($1)", [id]));
    await asUser(ops, () =>
      db.query("SELECT public.transition_order($1,'ASSIGNED'::order_status,$2::jsonb)", [
        id,
        JSON.stringify({ designer_id: designer }),
      ]),
    );
    await asUser(designer, () => db.query("SELECT public.transition_order($1,'IN_PROGRESS'::order_status)", [id]));
    await asUser(designer, () => db.query("SELECT public.transition_order($1,'DESIGNER_SUBMITTED'::order_status)", [id]));
    await asUser(ops, () => db.query("SELECT public.transition_order($1,'QC_REVIEW'::order_status)", [id]));
    await asUser(qc, () => db.query("SELECT public.transition_order($1,'CLIENT_PREVIEW'::order_status)", [id]));
    await asUser(client, () => db.query("SELECT public.transition_order($1,'APPROVED'::order_status)", [id]));
    await asUser(ops, () => db.query("SELECT public.transition_order($1,'DELIVERED'::order_status)", [id]));
    await asUser(client, () => db.query("SELECT public.transition_order($1,'CLOSED'::order_status)", [id]));
    expect(await statusOf(id)).toBe("CLOSED");

    // non-FINANCE cannot release
    await expect(
      asUser(ops, () => db.query("SELECT public.release_escrow($1)", [id])),
    ).rejects.toThrow(/only FINANCE/i);

    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id]));
    expect(await statusOf(id)).toBe("PAYOUT_RELEASED");
    expect(await held(id)).toBe(0); // conservation: everything held is now released
    expect(await ledgerSum(id, "RELEASE")).toBe(10000); // legs sum to the hold
    expect(await ledgerSum(id, "HOLD")).toBe(10000);
  });

  it("refunding returns the held amount and flips to REFUNDED; release is then impossible", async () => {
    const id = await newOrder();
    await quote(id);
    await asUser(client, () => db.query("SELECT public.hold_escrow($1)", [id]));

    await asUser(finance, () => db.query("SELECT public.refund_escrow($1)", [id]));
    expect(await statusOf(id)).toBe("REFUNDED");
    expect(await held(id)).toBe(0);
    expect(await ledgerSum(id, "REFUND")).toBe(10000);

    // cannot then release (not CLOSED, and nothing held)
    await expect(
      asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id])),
    ).rejects.toThrow(/only release a CLOSED order/i);
  });

  it("the ledger is append-only and the audit chain stays valid", async () => {
    const id = await newOrder();
    await quote(id);
    await asUser(client, () => db.query("SELECT public.hold_escrow($1)", [id]));
    await expect(
      db.query("UPDATE escrow_ledger SET amount = 1 WHERE order_id = $1", [id]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.query("DELETE FROM escrow_ledger WHERE order_id = $1", [id]),
    ).rejects.toThrow(/append-only/i);

    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
