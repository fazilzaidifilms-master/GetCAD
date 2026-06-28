import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId, isOpaqueId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

// Seed a client user + profile so we can create orders that satisfy the FK.
async function seedClient(): Promise<string> {
  const userId = generateId();
  await db.query("INSERT INTO users (id, role, status) VALUES ($1, 'CLIENT', 'ACTIVE')", [userId]);
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1, $2, $3, $4)",
    [generateId(), userId, "Acme Corp", "ops@acme.example"],
  );
  return userId;
}

async function insertOrder(status: string): Promise<string> {
  const clientId = await seedClient();
  const id = generateId();
  await db.query(
    `INSERT INTO orders
       (id, client_id, product_type, status, currency,
        price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1, $2, 'CAD_MODEL', $3, 'USD', 10000, 6000, 1000, 3000)`,
    [id, clientId, status],
  );
  return id;
}

beforeAll(async () => {
  db = await connectFreshDb();
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test B — ENUM rejects bad status", () => {
  it("rejects inserting an order with status 'BANANA'", async () => {
    const clientId = await seedClient();
    await expect(
      db.query(
        `INSERT INTO orders
           (id, client_id, product_type, status, currency,
            price_total, designer_payout, qc_payout, platform_commission)
         VALUES ($1, $2, 'CAD_MODEL', 'BANANA', 'USD', 1, 1, 1, 1)`,
        [generateId(), clientId],
      ),
    ).rejects.toThrow(/invalid input value for enum order_status/i);
  });

  it("accepts a valid status from the enum", async () => {
    const id = await insertOrder("DRAFT");
    const { rows } = await db.query("SELECT status FROM orders WHERE id = $1", [id]);
    expect(rows[0].status).toBe("DRAFT");
  });
});

describe("Test C — opaque IDs, never sequential", () => {
  it("a new order's id is a nanoid string, not 1/2/3", async () => {
    const id = await insertOrder("DRAFT");
    const { rows } = await db.query("SELECT id FROM orders WHERE id = $1", [id]);
    const stored = rows[0].id as string;
    expect(isOpaqueId(stored)).toBe(true);
    expect(/^\d+$/.test(stored)).toBe(false); // not "1", "2", "3", ...
  });

  it("money columns reject negatives (CHECK >= 0)", async () => {
    const clientId = await seedClient();
    await expect(
      db.query(
        `INSERT INTO orders
           (id, client_id, product_type, status, currency,
            price_total, designer_payout, qc_payout, platform_commission)
         VALUES ($1, $2, 'CAD_MODEL', 'DRAFT', 'USD', -1, 0, 0, 0)`,
        [generateId(), clientId],
      ),
    ).rejects.toThrow(/violates check constraint/i);
  });
});

describe("Test D — RLS fails closed", () => {
  it("anon sees ZERO rows of orders, with no error, even when rows exist", async () => {
    // Insert as the (superuser) migration role, which bypasses RLS.
    await insertOrder("SUBMITTED");
    const ownerCount = await db.query("SELECT count(*)::int AS n FROM orders");
    expect(ownerCount.rows[0].n).toBeGreaterThan(0);

    // Now become anon. Default-deny RLS must return zero rows — NOT an error.
    await db.query("SET ROLE anon");
    const asAnon = await db.query("SELECT * FROM orders");
    expect(asAnon.rows.length).toBe(0);
    await db.query("RESET ROLE");
  });

  it("anon is locked out of every table (default-deny everywhere)", async () => {
    await db.query("SET ROLE anon");
    for (const table of ["users", "client_profiles", "designer_profiles", "orders"]) {
      const res = await db.query(`SELECT * FROM ${table}`);
      expect(res.rows.length).toBe(0);
    }
    await db.query("RESET ROLE");
  });
});
