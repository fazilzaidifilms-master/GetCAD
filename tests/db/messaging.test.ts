import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

/**
 * Fund an order the way production now does: open a collection and confirm it
 * as the trusted server. The client can no longer call hold_escrow() — that
 * would let them fund their own order for free (see 0022).
 */
async function fundOrder(db: Client, orderId: string): Promise<void> {
  const ref = `order_rp_${orderId}`;
  const { rows } = await db.query("SELECT price_total, currency FROM orders WHERE id=$1", [orderId]);
  await db.query("SELECT public.open_payment_intent($1,$2)", [orderId, ref]);
  await db.query("SELECT public.confirm_payment($1,$2,$3,$4,$5)", [
    ref, rows[0].price_total, rows[0].currency, `test:${ref}`, `pay_${orderId}`,
  ]);
}


let db: Client;

const client = generateId();
const otherClient = generateId();
const sales = generateId();
const ops = generateId();
const finance = generateId();
const designer = generateId();
const qc = generateId();

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

async function post(sub: string, orderId: string, body: string) {
  return asUser(sub, () => db.query("SELECT public.post_message($1,$2) AS v", [orderId, body]));
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'),($2,'CLIENT','ACTIVE'),($3,'SALES','ACTIVE'),
       ($4,'OPS','ACTIVE'),($5,'FINANCE','ACTIVE'),($6,'DESIGNER','ACTIVE'),($7,'QC','ACTIVE')`,
    [client, otherClient, sales, ops, finance, designer, qc],
  );
  // Designer passes the onboarding gate so they can be assigned.
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
  // Walk an order to ASSIGNED so both parties exist.
  await asUser(client, () => db.query("SELECT public.create_order($1,$2,'USD')", [order, "CAD_MODEL"]));
  await asUser(client, () => db.query("SELECT public.transition_order($1,'SUBMITTED'::order_status)", [order]));
  await asUser(sales, () => db.query("SELECT public.quote_order($1,10000,6000,1000,3000)", [order]));
  await fundOrder(db, order);
  await asUser(ops, () =>
    db.query("SELECT public.transition_order($1,'ASSIGNED'::order_status,$2::jsonb)", [
      order,
      JSON.stringify({ designer_id: designer }),
    ]),
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test W — double-blind messaging", () => {
  it("the client and the assigned designer can post; the party label is derived", async () => {
    const c = await post(client, order, "Hi, any questions on the spec?");
    expect(c.rows[0].v.party).toBe("CLIENT");
    const d = await post(designer, order, "Yes — what tolerance do you need?");
    expect(d.rows[0].v.party).toBe("DESIGNER");
  });

  it("a non-participant cannot post", async () => {
    await expect(post(otherClient, order, "let me in")).rejects.toThrow(
      /only the order's client or assigned designer/i,
    );
  });

  it("an empty message is rejected", async () => {
    await expect(post(client, order, "   ")).rejects.toThrow(/empty/i);
  });

  it("messages carry NO identity — only opaque sender_id + party label", async () => {
    // The table has no name/email/avatar columns.
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='messages'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names.sort()).toEqual(
      ["body", "created_at", "id", "order_id", "sender_id", "sender_party"].sort(),
    );
  });

  it("a participant reads the thread but STILL cannot read the counterparty's identity", async () => {
    await asUser(client, async () => {
      const msgs = await db.query(
        "SELECT sender_party, body FROM messages WHERE order_id = $1 ORDER BY created_at",
        [order],
      );
      // client sees both parties' messages...
      expect(msgs.rows.map((r) => r.sender_party)).toEqual(["CLIENT", "DESIGNER"]);
      // ...but cannot read the designer's identity row (double-blind holds).
      const idn = await db.query("SELECT * FROM designer_profiles WHERE user_id = $1", [designer]);
      expect(idn.rows).toHaveLength(0);
    });
  });

  it("posting is audited and messages are append-only", async () => {
    const a = await db.query(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE action='MESSAGE_POSTED' AND entity_id=$1",
      [order],
    );
    expect(a.rows[0].n).toBe(2);

    await expect(
      db.query("UPDATE messages SET body='edited' WHERE order_id=$1", [order]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.query("DELETE FROM messages WHERE order_id=$1", [order]),
    ).rejects.toThrow(/append-only/i);
  });

  it("messages are order-scoped: an unrelated order's client sees none of them", async () => {
    const other = generateId();
    await asUser(otherClient, () => db.query("SELECT public.create_order($1,$2,'USD')", [other, "CAD_MODEL"]));
    await asUser(otherClient, async () => {
      const seen = await db.query("SELECT count(*)::int AS n FROM messages WHERE order_id=$1", [order]);
      expect(seen.rows[0].n).toBe(0); // RLS: cannot read the other order's thread
    });

    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
