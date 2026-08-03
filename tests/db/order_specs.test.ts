import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

/**
 * Test BE — the brief.
 *
 * The properties worth pinning are the ones that cost money when they break:
 * a brief nobody agreed to, a brief that changed after it was priced, and a
 * brief that contradicts itself (no centre stone, but here are its dimensions).
 */
let db: Client;

const client = generateId();
const stranger = generateId();
const designer = generateId();
const sales = generateId();

const ORDER = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'CLIENT','ACTIVE'),
       ($3,'DESIGNER','ACTIVE'), ($4,'SALES','ACTIVE')`,
    [client, stranger, designer, sales],
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

/** A DRAFT order owned by `client`. */
async function makeOrder(id: string, status = "DRAFT"): Promise<string> {
  await db.query(
    `INSERT INTO orders (id, client_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,'CAD_MODEL',$3::order_status,'INR',0,0,0,0)`,
    [id, client, status],
  );
  return id;
}

/** The minimum viable brief: no centre stone, everything else answered. */
function saveBasic(sub: string, orderId: string, over: Record<string, unknown> = {}) {
  return asUser(sub, () =>
    db.query(
      `SELECT public.upsert_order_spec(
         p_order_id => $1, p_reference_name => $2, p_product => 'RING',
         p_metal => 'YELLOW', p_karatage => '18K', p_purpose => 'CASTING',
         p_format => 'BOTH', p_finish => 'HIGH_POLISH')`,
      [orderId, (over.name as string) ?? "Anniversary band"],
    ),
  );
}

describe("Test BE1 — a brief belongs to the person buying", () => {
  it("saves for the order's own client", async () => {
    await makeOrder(ORDER);
    await saveBasic(client, ORDER);
    const { rows } = await db.query("SELECT reference_name, product FROM order_specs WHERE order_id=$1", [
      ORDER,
    ]);
    expect(rows[0]).toMatchObject({ reference_name: "Anniversary band", product: "RING" });
  });

  it("refuses a stranger", async () => {
    await expect(saveBasic(stranger, ORDER)).rejects.toThrow(/only the client who owns/i);
  });

  // Staff writing the brief would mean a brief nobody agreed to.
  it("refuses staff, who do not write briefs on someone's behalf", async () => {
    await expect(saveBasic(sales, ORDER)).rejects.toThrow(/only the client who owns/i);
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(
      db.query(
        `SELECT public.upsert_order_spec($1,'x','RING','YELLOW','18K','CASTING','BOTH','HIGH_POLISH')`,
        [ORDER],
      ),
    ).rejects.toThrow(/not authenticated/i);
  });
});

describe("Test BE2 — the brief freezes once it has been priced", () => {
  it("still accepts edits while SUBMITTED", async () => {
    const id = await makeOrder(generateId(), "SUBMITTED");
    await expect(saveBasic(client, id)).resolves.toBeTruthy();
  });

  // The failure being prevented: a client silently enlarging the centre stone
  // after a quote, so the price describes one job and the work is another.
  it("refuses once the order is QUOTED", async () => {
    const id = await makeOrder(generateId(), "QUOTED");
    await expect(saveBasic(client, id)).rejects.toThrow(/fixed once the order has been quoted/i);
  });

  it("refuses once money is held", async () => {
    const id = await makeOrder(generateId(), "PAYMENT_HELD");
    await expect(saveBasic(client, id)).rejects.toThrow(/fixed once the order has been quoted/i);
  });
});

describe("Test BE3 — a brief cannot contradict itself", () => {
  it("refuses a centre stone with no shape or setting", async () => {
    const id = await makeOrder(generateId());
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.upsert_order_spec(
             p_order_id => $1, p_reference_name => 'x', p_product => 'RING',
             p_metal => 'WHITE', p_karatage => '18K', p_purpose => 'CASTING',
             p_format => 'STL', p_finish => 'MATTE',
             p_has_centre_stone => true)`,
          [id],
        ),
      ),
    ).rejects.toThrow(/order_specs_centre_coherent/);
  });

  // Clearing "is there a centre stone?" must not leave a ghost 6.5mm round
  // behind for the designer to build a head around.
  it("refuses dimensions on an order with no centre stone", async () => {
    const id = await makeOrder(generateId());
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.upsert_order_spec(
             p_order_id => $1, p_reference_name => 'x', p_product => 'RING',
             p_metal => 'WHITE', p_karatage => '18K', p_purpose => 'CASTING',
             p_format => 'STL', p_finish => 'MATTE',
             p_has_centre_stone => false, p_centre_length_um => 6500)`,
          [id],
        ),
      ),
    ).rejects.toThrow(/order_specs_centre_coherent/);
  });

  it("accepts a complete centre stone", async () => {
    const id = await makeOrder(generateId());
    await asUser(client, () =>
      db.query(
        `SELECT public.upsert_order_spec(
           p_order_id => $1, p_reference_name => 'Solitaire', p_product => 'RING',
           p_metal => 'WHITE', p_karatage => '18K', p_purpose => 'CASTING',
           p_format => 'BOTH', p_finish => 'HIGH_POLISH',
           p_has_centre_stone => true, p_centre_shape => 'ROUND',
           p_centre_length_um => 6500, p_centre_width_um => 6500,
           p_centre_quantity => 1, p_centre_setting => 'PRONG_6')`,
        [id],
      ),
    );
    const { rows } = await db.query(
      "SELECT centre_length_um, centre_setting FROM order_specs WHERE order_id=$1",
      [id],
    );
    expect(rows[0]).toMatchObject({ centre_length_um: 6500, centre_setting: "PRONG_6" });
  });

  it("refuses a stone too large to cut a seat for", async () => {
    const id = await makeOrder(generateId());
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.upsert_order_spec(
             p_order_id => $1, p_reference_name => 'x', p_product => 'RING',
             p_metal => 'WHITE', p_karatage => '18K', p_purpose => 'CASTING',
             p_format => 'STL', p_finish => 'MATTE',
             p_has_centre_stone => true, p_centre_shape => 'ROUND',
             p_centre_length_um => 400000, p_centre_width_um => 400000,
             p_centre_quantity => 1, p_centre_setting => 'BEZEL')`,
          [id],
        ),
      ),
    ).rejects.toThrow(/centre_length_um/);
  });
});

describe("Test BE4 — lineage stays inside your own orders", () => {
  it("refuses basing a job on a stranger's order", async () => {
    const mine = await makeOrder(generateId());
    const theirs = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,'CAD_MODEL','DRAFT','INR',0,0,0,0)`,
      [theirs, stranger],
    );
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.upsert_order_spec(
             p_order_id => $1, p_reference_name => 'x', p_product => 'RING',
             p_metal => 'WHITE', p_karatage => '18K', p_purpose => 'CASTING',
             p_format => 'STL', p_finish => 'MATTE',
             p_based_on_order_id => $2, p_change_summary => 'wider band')`,
          [mine, theirs],
        ),
      ),
    ).rejects.toThrow(/not one of yours/i);
  });

  it("refuses lineage with nothing said about what changed", async () => {
    const first = await makeOrder(generateId());
    const second = await makeOrder(generateId());
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.upsert_order_spec(
             p_order_id => $1, p_reference_name => 'x', p_product => 'RING',
             p_metal => 'WHITE', p_karatage => '18K', p_purpose => 'CASTING',
             p_format => 'STL', p_finish => 'MATTE',
             p_based_on_order_id => $2)`,
          [second, first],
        ),
      ),
    ).rejects.toThrow(/order_specs_lineage_coherent/);
  });
});

describe("Test BE5 — accent rows are replaced wholesale", () => {
  const id = generateId();

  it("writes rows in order", async () => {
    await makeOrder(id);
    await saveBasic(client, id);
    const { rows } = await asUser(client, () =>
      db.query(
        `SELECT public.set_order_accents($1,
           ARRAY['ROUND','BAGUETTE']::stone_shape[],
           ARRAY[1300, 2000], ARRAY[18, 6],
           ARRAY['PAVE','CHANNEL']::setting_type[]) AS n`,
        [id],
      ),
    );
    expect(rows[0].n).toBe(2);
    const got = await db.query(
      "SELECT position, shape, width_um, quantity FROM order_spec_accents WHERE order_id=$1 ORDER BY position",
      [id],
    );
    expect(got.rows).toEqual([
      { position: 1, shape: "ROUND", width_um: 1300, quantity: 18 },
      { position: 2, shape: "BAGUETTE", width_um: 2000, quantity: 6 },
    ]);
  });

  it("replaces rather than appends", async () => {
    await asUser(client, () =>
      db.query(
        `SELECT public.set_order_accents($1, ARRAY['OVAL']::stone_shape[],
           ARRAY[1500], ARRAY[4], ARRAY['BEZEL']::setting_type[])`,
        [id],
      ),
    );
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM order_spec_accents WHERE order_id=$1",
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  // Mis-paired arrays would silently pair a shape with the wrong width.
  it("refuses arrays of differing length", async () => {
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.set_order_accents($1, ARRAY['OVAL','ROUND']::stone_shape[],
             ARRAY[1500], ARRAY[4], ARRAY['BEZEL']::setting_type[])`,
          [id],
        ),
      ),
    ).rejects.toThrow(/same length/i);
  });

  it("clears every row when given nothing", async () => {
    const { rows } = await asUser(client, () =>
      db.query(
        `SELECT public.set_order_accents($1, ARRAY[]::stone_shape[],
           ARRAY[]::integer[], ARRAY[]::integer[], ARRAY[]::setting_type[]) AS n`,
        [id],
      ),
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("Test BE6 — the tables stay locked down", () => {
  it("grants no direct writes to anyone", async () => {
    const { rows } = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name IN ('order_specs','order_spec_accents')
         AND grantee IN ('anon','authenticated')
         AND privilege_type IN ('INSERT','UPDATE','DELETE')`,
    );
    expect(rows).toEqual([]);
  });

  it("shows a brief to the order's designer, and nothing to a stranger", async () => {
    const id = await makeOrder(generateId());
    await saveBasic(client, id);
    await db.query("UPDATE orders SET designer_id=$2 WHERE id=$1", [id, designer]);

    const seen = await asUser(designer, () =>
      db.query("SELECT order_id FROM order_specs WHERE order_id=$1", [id]),
    );
    expect(seen.rows).toHaveLength(1);

    const unseen = await asUser(stranger, () =>
      db.query("SELECT order_id FROM order_specs WHERE order_id=$1", [id]),
    );
    expect(unseen.rows).toHaveLength(0);
  });

  it("records each save in the audit chain", async () => {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE action='ORDER_SPEC_SAVED'",
    );
    expect(rows[0].n).toBeGreaterThan(0);
    const chain = await db.query("SELECT audit.verify_chain() AS r");
    expect(chain.rows[0].r.valid).toBe(true);
  });
});

describe("Test BE7 — wall thickness is derived, never stored", () => {
  it("gives casting the most material and a render none", async () => {
    const { rows } = await db.query(
      `SELECT public.min_wall_um('CASTING') AS cast,
              public.min_wall_um('DIRECT_PRINT') AS print,
              public.min_wall_um('RENDER_ONLY') AS render`,
    );
    expect(rows[0].cast).toBeGreaterThan(rows[0].print);
    expect(rows[0].render).toBe(0);
  });
});
