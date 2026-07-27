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
const sales = generateId();
const ops = generateId();
const finance = generateId();
const designer = generateId();
const qc = generateId();

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

// A fresh order funded and in progress (funds held), so a dispute can be raised.
async function inProgressOrder(): Promise<string> {
  const id = generateId();
  await asUser(client, () => db.query("SELECT public.create_order($1,$2,'USD')", [id, "CAD_MODEL"]));
  await asUser(client, () => db.query("SELECT public.transition_order($1,'SUBMITTED'::order_status)", [id]));
  await asUser(sales, () => db.query("SELECT public.quote_order($1,10000,6000,1000,3000)", [id]));
  await fundOrder(db, id);
  await asUser(ops, () =>
    db.query("SELECT public.transition_order($1,'ASSIGNED'::order_status,$2::jsonb)", [
      id,
      JSON.stringify({ designer_id: designer }),
    ]),
  );
  await asUser(designer, () => db.query("SELECT public.transition_order($1,'IN_PROGRESS'::order_status)", [id]));
  return id;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'),($2,'SALES','ACTIVE'),($3,'OPS','ACTIVE'),
       ($4,'FINANCE','ACTIVE'),($5,'DESIGNER','ACTIVE'),($6,'QC','ACTIVE')`,
    [client, sales, ops, finance, designer, qc],
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

describe("Test Y — structured dispute resolution", () => {
  it("the client raises a dispute with a reason; order -> DISPUTED, dispute OPEN", async () => {
    const id = await inProgressOrder();
    const res = await asUser(client, () =>
      db.query("SELECT public.raise_dispute($1,$2) AS v", [id, "The model is missing a mounting hole."]),
    );
    expect(res.rows[0].v.status).toBe("DISPUTED");
    expect(await statusOf(id)).toBe("DISPUTED");
    const d = await db.query(
      "SELECT status, reason, raised_by FROM disputes WHERE order_id=$1",
      [id],
    );
    expect(d.rows[0].status).toBe("OPEN");
    expect(d.rows[0].reason).toMatch(/mounting hole/);
    expect(d.rows[0].raised_by).toBe(client);
  });

  it("a non-client cannot raise, and a reason is required", async () => {
    const id = await inProgressOrder();
    await expect(
      asUser(ops, () => db.query("SELECT public.raise_dispute($1,$2)", [id, "not mine"])),
    ).rejects.toThrow(/only the order's client/i);
    await expect(
      asUser(client, () => db.query("SELECT public.raise_dispute($1,$2)", [id, "   "])),
    ).rejects.toThrow(/reason is required/i);
  });

  it("transition_order refuses to reach DISPUTED or to move a DISPUTED order", async () => {
    const id = await inProgressOrder();
    await expect(
      asUser(client, () => db.query("SELECT public.transition_order($1,'DISPUTED'::order_status)", [id])),
    ).rejects.toThrow(/use raise_dispute/i);

    await asUser(client, () => db.query("SELECT public.raise_dispute($1,$2)", [id, "broken"]));
    await expect(
      asUser(ops, () => db.query("SELECT public.transition_order($1,'IN_PROGRESS'::order_status)", [id])),
    ).rejects.toThrow(/resolve_dispute/i);

    // cannot raise a second dispute: the order is already DISPUTED
    await expect(
      asUser(client, () => db.query("SELECT public.raise_dispute($1,$2)", [id, "again"])),
    ).rejects.toThrow(/can only be raised|DISPUTED/i);
  });

  it("OPS resolves REWORK -> order back to IN_PROGRESS, dispute RESOLVED", async () => {
    const id = await inProgressOrder();
    await asUser(client, () => db.query("SELECT public.raise_dispute($1,$2)", [id, "needs changes"]));

    await expect(
      asUser(finance, () => db.query("SELECT public.resolve_dispute($1,'REWORK',$2)", [id, "n/a"])),
    ).rejects.toThrow(/only OPS/i);

    await asUser(ops, () => db.query("SELECT public.resolve_dispute($1,'REWORK',$2)", [id, "please fix"]));
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    const d = await db.query(
      "SELECT status, resolution, resolved_by FROM disputes WHERE order_id=$1",
      [id],
    );
    expect(d.rows[0].status).toBe("RESOLVED");
    expect(d.rows[0].resolution).toBe("REWORK");
    expect(d.rows[0].resolved_by).toBe(ops);
  });

  it("FINANCE resolves REFUND -> escrow refunded, order REFUNDED, dispute RESOLVED", async () => {
    const id = await inProgressOrder();
    await asUser(client, () => db.query("SELECT public.raise_dispute($1,$2)", [id, "want my money back"]));

    await expect(
      asUser(ops, () => db.query("SELECT public.resolve_dispute($1,'REFUND',$2)", [id, "no"])),
    ).rejects.toThrow(/only FINANCE/i);

    await asUser(finance, () => db.query("SELECT public.resolve_dispute($1,'REFUND',$2)", [id, "approved"]));
    expect(await statusOf(id)).toBe("REFUNDED");
    const held = await db.query("SELECT app.escrow_held($1) AS h", [id]);
    expect(held.rows[0].h).toBe(0); // refunded via the escrow layer
    const refund = await db.query(
      "SELECT coalesce(sum(amount),0)::int AS s FROM escrow_ledger WHERE order_id=$1 AND kind='REFUND'",
      [id],
    );
    expect(refund.rows[0].s).toBe(10000);
    const d = await db.query("SELECT resolution FROM disputes WHERE order_id=$1", [id]);
    expect(d.rows[0].resolution).toBe("REFUND");
  });

  it("both events are audited and the chain stays valid", async () => {
    const raised = await db.query("SELECT count(*)::int AS n FROM audit.audit_log WHERE action='DISPUTE_RAISED'");
    const resolved = await db.query("SELECT count(*)::int AS n FROM audit.audit_log WHERE action='DISPUTE_RESOLVED'");
    expect(raised.rows[0].n).toBeGreaterThanOrEqual(2);
    expect(resolved.rows[0].n).toBe(2);
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
