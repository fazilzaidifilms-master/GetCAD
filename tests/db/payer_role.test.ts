import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;
const owner = generateId(); // owns the order, but wears a staff role

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query("INSERT INTO users (id, role, status) VALUES ($1,'SALES','ACTIVE')", [owner]);
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Acme','a@acme.example')",
    [generateId(), owner],
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

/**
 * Test AV — party alone is not authority.
 *
 * A staff member can end up owning an order (they created it before their role
 * changed, or a single account is wearing several hats during testing). Owning
 * it must NOT grant the client's actions while they are acting as staff —
 * that is the contract the removed hold_escrow enforced, and the one every
 * other party-scoped action follows.
 */
describe("Test AV — client actions require role CLIENT, not just ownership", () => {
  it("a SALES user who owns the order cannot raise a dispute on it", async () => {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,'CAD_MODEL','IN_PROGRESS','INR',50000,30000,10000,10000)`,
      [id, owner],
    );
    await expect(
      asUser(owner, () => db.query("SELECT public.raise_dispute($1,'not happy')", [id])),
    ).rejects.toThrow(/only the order's client|client/i);
  });

  it("the same user CAN once they are acting as a CLIENT", async () => {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,'CAD_MODEL','IN_PROGRESS','INR',50000,30000,10000,10000)`,
      [id, owner],
    );
    await db.query("UPDATE users SET role='CLIENT' WHERE id=$1", [owner]);
    try {
      const res = await asUser(owner, () =>
        db.query("SELECT public.raise_dispute($1,'not happy') AS r", [id]),
      );
      expect(res.rows[0].r.status).toBe("DISPUTED");
    } finally {
      await db.query("UPDATE users SET role='SALES' WHERE id=$1", [owner]);
    }
  });
});
