import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

/**
 * Test BF — reference pictures and pins.
 *
 * Pins exist to remove an ambiguity, so the properties that matter are the ones
 * that would let the ambiguity back in: an unlabelled pin, a pile of pictures
 * with no stated starting point, and pins that outlive the picture they were
 * placed on.
 */
let db: Client;

const client = generateId();
const stranger = generateId();
const designer = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'CLIENT','ACTIVE'), ($3,'DESIGNER','ACTIVE')`,
    [client, stranger, designer],
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

async function makeOrder(status = "DRAFT", owner = client): Promise<string> {
  const id = generateId();
  await db.query(
    `INSERT INTO orders (id, client_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,'CAD_MODEL',$3::order_status,'INR',0,0,0,0)`,
    [id, owner, status],
  );
  return id;
}

async function addImage(orderId: string, sub = client): Promise<string> {
  const { rows } = await asUser(sub, () =>
    db.query("SELECT public.add_reference_image($1,$2,'image/jpeg',12345) AS id", [
      orderId,
      `${orderId}/${generateId()}.jpg`,
    ]),
  );
  return rows[0].id as string;
}

describe("Test BF1 — pictures belong to the order's client", () => {
  it("accepts one from the owner", async () => {
    const order = await makeOrder();
    const id = await addImage(order);
    expect(id).toBeTruthy();
  });

  it("refuses a stranger", async () => {
    const order = await makeOrder();
    await expect(addImage(order, stranger)).rejects.toThrow(/only the client who owns/i);
  });

  it("refuses an unauthenticated caller", async () => {
    const order = await makeOrder();
    await expect(
      db.query("SELECT public.add_reference_image($1,'k','image/png',1)", [order]),
    ).rejects.toThrow(/not authenticated/i);
  });

  // Same rule as the brief: after a quote, the thing that was priced is fixed.
  it("refuses once the order has been quoted", async () => {
    const order = await makeOrder("QUOTED");
    await expect(addImage(order)).rejects.toThrow(/fixed once the order has been quoted/i);
  });

  it("refuses a file type that is not an image", async () => {
    const order = await makeOrder();
    await expect(
      asUser(client, () =>
        db.query("SELECT public.add_reference_image($1,'k','application/pdf',1)", [order]),
      ),
    ).rejects.toThrow(/content_type/);
  });
});

describe("Test BF2 — exactly one picture is the starting point", () => {
  it("makes the first upload primary without being asked", async () => {
    const order = await makeOrder();
    await addImage(order);
    const { rows } = await db.query(
      "SELECT is_primary FROM order_reference_images WHERE order_id=$1",
      [order],
    );
    expect(rows[0].is_primary).toBe(true);
  });

  it("does not make later uploads primary too", async () => {
    const order = await makeOrder();
    await addImage(order);
    await addImage(order);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM order_reference_images WHERE order_id=$1 AND is_primary",
      [order],
    );
    expect(rows[0].n).toBe(1);
  });

  it("moves the flag rather than adding a second", async () => {
    const order = await makeOrder();
    const first = await addImage(order);
    const second = await addImage(order);
    await asUser(client, () => db.query("SELECT public.set_primary_reference($1)", [second]));

    const { rows } = await db.query(
      "SELECT id, is_primary FROM order_reference_images WHERE order_id=$1 ORDER BY position",
      [order],
    );
    expect(rows.find((r) => r.id === first)!.is_primary).toBe(false);
    expect(rows.find((r) => r.id === second)!.is_primary).toBe(true);
  });

  // Otherwise the pile of pictures has no starting point again.
  it("promotes a survivor when the primary is deleted", async () => {
    const order = await makeOrder();
    const first = await addImage(order);
    await addImage(order);
    await asUser(client, () => db.query("SELECT public.remove_reference_image($1)", [first]));

    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM order_reference_images WHERE order_id=$1 AND is_primary",
      [order],
    );
    expect(rows[0].n).toBe(1);
  });

  it("refuses two primaries even if written directly", async () => {
    const order = await makeOrder();
    await addImage(order);
    await expect(
      db.query(
        `INSERT INTO order_reference_images
           (order_id, object_key, content_type, size_bytes, position, is_primary)
         VALUES ($1,$2,'image/png',1,9,true)`,
        [order, generateId()],
      ),
    ).rejects.toThrow(/order_reference_images_one_primary/);
  });
});

describe("Test BF3 — pins", () => {
  it("writes pins in order", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    const { rows } = await asUser(client, () =>
      db.query(
        `SELECT public.set_reference_pins($1, ARRAY[2500,7500], ARRAY[3000,8000],
           ARRAY['this prong style','this band width']) AS n`,
        [image],
      ),
    );
    expect(rows[0].n).toBe(2);

    const got = await db.query(
      "SELECT position, x_bp, y_bp, label FROM order_reference_pins WHERE image_id=$1 ORDER BY position",
      [image],
    );
    expect(got.rows).toEqual([
      { position: 1, x_bp: 2500, y_bp: 3000, label: "this prong style" },
      { position: 2, x_bp: 7500, y_bp: 8000, label: "this band width" },
    ]);
  });

  it("replaces rather than appends", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    const set = (labels: string[]) =>
      asUser(client, () =>
        db.query(`SELECT public.set_reference_pins($1, ARRAY[1000], ARRAY[1000], $2)`, [
          image,
          labels,
        ]),
      );
    await set(["first"]);
    await set(["second"]);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM order_reference_pins WHERE image_id=$1",
      [image],
    );
    expect(rows[0].n).toBe(1);
  });

  // A pin without a label is a dot, and a dot is the ambiguity pins remove.
  it("refuses an unlabelled pin", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    await expect(
      asUser(client, () =>
        db.query(`SELECT public.set_reference_pins($1, ARRAY[1000], ARRAY[1000], ARRAY[''])`, [
          image,
        ]),
      ),
    ).rejects.toThrow(/label/);
  });

  it("refuses a coordinate off the image", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    await expect(
      asUser(client, () =>
        db.query(`SELECT public.set_reference_pins($1, ARRAY[10001], ARRAY[0], ARRAY['x'])`, [
          image,
        ]),
      ),
    ).rejects.toThrow(/x_bp/);
  });

  it("refuses arrays of differing length", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    await expect(
      asUser(client, () =>
        db.query(
          `SELECT public.set_reference_pins($1, ARRAY[1,2], ARRAY[1], ARRAY['a','b'])`,
          [image],
        ),
      ),
    ).rejects.toThrow(/same length/i);
  });

  it("refuses a stranger's pins", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    await expect(
      asUser(stranger, () =>
        db.query(`SELECT public.set_reference_pins($1, ARRAY[1], ARRAY[1], ARRAY['x'])`, [image]),
      ),
    ).rejects.toThrow(/only the client who owns/i);
  });

  // Pins that outlive their picture would render nowhere and mean nothing.
  it("takes its pins with it when a picture is removed", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    await asUser(client, () =>
      db.query(`SELECT public.set_reference_pins($1, ARRAY[1], ARRAY[1], ARRAY['x'])`, [image]),
    );
    await asUser(client, () => db.query("SELECT public.remove_reference_image($1)", [image]));
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM order_reference_pins WHERE image_id=$1",
      [image],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("Test BF4 — locked down, and visible with the order", () => {
  it("grants no direct writes", async () => {
    const { rows } = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name IN ('order_reference_images','order_reference_pins')
         AND grantee IN ('anon','authenticated')
         AND privilege_type IN ('INSERT','UPDATE','DELETE')`,
    );
    expect(rows).toEqual([]);
  });

  it("shows pictures and pins to the assigned designer, and nothing to a stranger", async () => {
    const order = await makeOrder();
    const image = await addImage(order);
    await asUser(client, () =>
      db.query(`SELECT public.set_reference_pins($1, ARRAY[1], ARRAY[1], ARRAY['here'])`, [image]),
    );
    await db.query("UPDATE orders SET designer_id=$2 WHERE id=$1", [order, designer]);

    const seenImages = await asUser(designer, () =>
      db.query("SELECT id FROM order_reference_images WHERE order_id=$1", [order]),
    );
    const seenPins = await asUser(designer, () =>
      db.query("SELECT id FROM order_reference_pins WHERE image_id=$1", [image]),
    );
    expect(seenImages.rows).toHaveLength(1);
    expect(seenPins.rows).toHaveLength(1);

    const unseen = await asUser(stranger, () =>
      db.query("SELECT id FROM order_reference_images WHERE order_id=$1", [order]),
    );
    expect(unseen.rows).toHaveLength(0);
  });
});
