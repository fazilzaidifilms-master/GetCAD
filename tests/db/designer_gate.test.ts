import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const clientU = generateId();
const opsU = generateId();
const designerU = generateId(); // starts with NO users row — applies fresh
const order = generateId();

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

async function tryAssign(orderId: string) {
  return asUser(opsU, () =>
    db.query("SELECT public.transition_order($1,'ASSIGNED'::order_status,$2::jsonb) AS v", [
      orderId,
      JSON.stringify({ designer_id: designerU }),
    ]),
  );
}

async function statusOf(orderId: string): Promise<string> {
  const { rows } = await db.query("SELECT status FROM orders WHERE id = $1", [orderId]);
  return rows[0].status;
}

beforeAll(async () => {
  db = await connectFreshDb();
  // client + ops exist; an order sits at PAYMENT_HELD, ready to be assigned.
  await db.query(
    `INSERT INTO users (id, role, status) VALUES ($1,'CLIENT','ACTIVE'), ($2,'OPS','ACTIVE')`,
    [clientU, opsU],
  );
  await db.query(
    `INSERT INTO orders (id, client_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,'CAD_MODEL','PAYMENT_HELD','USD',10000,6000,1000,3000)`,
    [order, clientU],
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test N — designer agreement gate", () => {
  it("a fresh user applies as a designer (PENDING, audited)", async () => {
    const res = await asUser(designerU, () =>
      db.query("SELECT public.apply_as_designer($1,$2,$3) AS v", [
        generateId(),
        "Dana Designer",
        "dana@studio.example",
      ]),
    );
    expect(res.rows[0].v.status).toBe("PENDING");

    const u = await db.query("SELECT role, status FROM users WHERE id = $1", [designerU]);
    expect(u.rows[0].role).toBe("DESIGNER");
    expect(u.rows[0].status).toBe("PENDING");

    const a = await db.query(
      "SELECT action FROM audit.audit_log WHERE entity_id = $1 AND action = 'DESIGNER_APPLIED'",
      [designerU],
    );
    expect(a.rows).toHaveLength(1);
  });

  it("BLOCKS assignment before the agreement is accepted", async () => {
    await expect(tryAssign(order)).rejects.toThrow(/not assignable|accepted the agreement/i);
    expect(await statusOf(order)).toBe("PAYMENT_HELD"); // unchanged
  });

  it("accepting the agreement is audited and flips the designer to ACTIVE", async () => {
    const res = await asUser(designerU, () =>
      db.query("SELECT public.accept_designer_agreement('UNWIRED_V0') AS v"),
    );
    expect(res.rows[0].v.accepted).toBe(true);

    const u = await db.query("SELECT status FROM users WHERE id = $1", [designerU]);
    expect(u.rows[0].status).toBe("ACTIVE");
    const dp = await db.query(
      "SELECT agreement_accepted_at, agreement_version FROM designer_profiles WHERE user_id = $1",
      [designerU],
    );
    expect(dp.rows[0].agreement_accepted_at).not.toBeNull();
    expect(dp.rows[0].agreement_version).toBe("UNWIRED_V0");

    const a = await db.query(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE entity_id = $1 AND action = 'DESIGNER_AGREEMENT_ACCEPTED'",
      [designerU],
    );
    expect(a.rows[0].n).toBe(1);
  });

  it("ALLOWS assignment once the gate is passed", async () => {
    const res = await tryAssign(order);
    expect(res.rows[0].v.to).toBe("ASSIGNED");
    expect(await statusOf(order)).toBe("ASSIGNED");
    const d = await db.query("SELECT designer_id FROM orders WHERE id = $1", [order]);
    expect(d.rows[0].designer_id).toBe(designerU);
  });

  it("a second acceptance is idempotent (no duplicate audit entry)", async () => {
    await asUser(designerU, () => db.query("SELECT public.accept_designer_agreement('UNWIRED_V0')"));
    const a = await db.query(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE entity_id = $1 AND action = 'DESIGNER_AGREEMENT_ACCEPTED'",
      [designerU],
    );
    expect(a.rows[0].n).toBe(1);
  });

  it("a non-designer cannot accept the agreement", async () => {
    await expect(
      asUser(clientU, () => db.query("SELECT public.accept_designer_agreement('UNWIRED_V0')")),
    ).rejects.toThrow(/apply as a designer first/i);
  });

  it("the audit chain stays valid throughout", async () => {
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
