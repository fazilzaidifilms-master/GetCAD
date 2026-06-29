import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

// Three people and two orders, seeded as the (RLS-bypassing) migration role.
const clientA = generateId();
const designerB = generateId();
const qcQ = generateId();
const order1 = generateId(); // client A, designer B, status QC_REVIEW
const order2 = generateId(); // client A, no designer, status DRAFT

/**
 * Run `fn` as the `authenticated` Postgres role with the request's verified
 * Clerk claims set to `{ sub }` (or unauthenticated when sub is null). Wrapped
 * in a transaction that is always rolled back, so role + claims never leak
 * between cases. Claims are set as the superuser BEFORE dropping to the
 * authenticated role.
 */
async function asUser<T>(sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
      sub ? JSON.stringify({ sub }) : "",
    ]);
    await db.query("SET LOCAL ROLE authenticated");
    return await fn();
  } finally {
    await db.query("ROLLBACK");
  }
}

async function ids(sql: string): Promise<string[]> {
  const { rows } = await db.query(sql);
  return rows.map((r) => r.id as string).sort();
}

beforeAll(async () => {
  db = await connectFreshDb();

  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1, 'CLIENT', 'ACTIVE'),
       ($2, 'DESIGNER', 'ACTIVE'),
       ($3, 'QC', 'ACTIVE')`,
    [clientA, designerB, qcQ],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1, $2, 'Acme Corp', 'a@acme.example')",
    [generateId(), clientA],
  );
  await db.query(
    "INSERT INTO designer_profiles (id, user_id, legal_name, email) VALUES ($1, $2, 'Dana Designer', 'd@studio.example')",
    [generateId(), designerB],
  );
  await db.query(
    `INSERT INTO orders
       (id, client_id, designer_id, product_type, status, currency,
        price_total, designer_payout, qc_payout, platform_commission)
     VALUES
       ($1, $2, $3, 'CAD_MODEL', 'QC_REVIEW', 'USD', 10000, 6000, 1000, 3000),
       ($4, $2, NULL,  'CAD_MODEL', 'DRAFT',     'USD',  5000, 3000,  500, 1500)`,
    [order1, clientA, designerB, order2],
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Identity-gated RLS — a user sees only what is theirs", () => {
  it("CLIENT A sees only their own user row, profile, and orders", async () => {
    await asUser(clientA, async () => {
      expect(await ids("SELECT id FROM users")).toEqual([clientA]);
      const profiles = await db.query("SELECT user_id FROM client_profiles");
      expect(profiles.rows.map((r) => r.user_id)).toEqual([clientA]);
      expect(await ids("SELECT id FROM orders")).toEqual([order1, order2].sort());
    });
  });

  it("DESIGNER B sees only orders assigned to them and their own profile", async () => {
    await asUser(designerB, async () => {
      expect(await ids("SELECT id FROM users")).toEqual([designerB]);
      const profiles = await db.query("SELECT user_id FROM designer_profiles");
      expect(profiles.rows.map((r) => r.user_id)).toEqual([designerB]);
      expect(await ids("SELECT id FROM orders")).toEqual([order1]); // not the DRAFT
    });
  });

  it("QC sees orders in review but no one's identity", async () => {
    await asUser(qcQ, async () => {
      expect(await ids("SELECT id FROM orders")).toEqual([order1]); // QC_REVIEW only
      expect((await db.query("SELECT * FROM client_profiles")).rows.length).toBe(0);
      expect((await db.query("SELECT * FROM designer_profiles")).rows.length).toBe(0);
    });
  });
});

describe("Double-blind invariant — neither side sees the other's identity", () => {
  it("the client cannot read the designer's identity", async () => {
    await asUser(clientA, async () => {
      expect((await db.query("SELECT * FROM designer_profiles")).rows.length).toBe(0);
    });
  });

  it("the designer cannot read the client's identity", async () => {
    await asUser(designerB, async () => {
      expect((await db.query("SELECT * FROM client_profiles")).rows.length).toBe(0);
    });
  });
});

describe("Default-deny still holds for the unauthenticated and for writes", () => {
  it("an authenticated request with no Clerk claims sees nothing", async () => {
    await asUser(null, async () => {
      expect((await db.query("SELECT * FROM orders")).rows.length).toBe(0);
      expect((await db.query("SELECT * FROM users")).rows.length).toBe(0);
    });
  });

  it("the raw anon role still sees zero rows everywhere", async () => {
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE anon");
      for (const t of ["users", "client_profiles", "designer_profiles", "orders"]) {
        expect((await db.query(`SELECT * FROM ${t}`)).rows.length).toBe(0);
      }
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("writes remain locked: a client cannot INSERT an order", async () => {
    await expect(
      asUser(clientA, async () => {
        await db.query(
          `INSERT INTO orders
             (id, client_id, product_type, status, currency,
              price_total, designer_payout, qc_payout, platform_commission)
           VALUES ($1, $2, 'CAD_MODEL', 'DRAFT', 'USD', 1, 1, 1, 1)`,
          [generateId(), clientA],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("writes remain locked: a client's UPDATE affects zero rows", async () => {
    await asUser(clientA, async () => {
      const res = await db.query("UPDATE orders SET product_type = 'HACKED' WHERE id = $1", [order1]);
      expect(res.rowCount).toBe(0);
    });
  });
});
