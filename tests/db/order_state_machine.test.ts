import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const client = generateId();
const otherClient = generateId();
const sales = generateId();
const ops = generateId();
const designer = generateId();

const order = generateId();

// Run as `authenticated` with a Clerk identity, COMMITting so writes persist.
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

async function transition(sub: string, orderId: string, to: string, payload = "{}") {
  return asUser(sub, () =>
    db.query("SELECT public.transition_order($1, $2::order_status, $3::jsonb) AS v", [
      orderId,
      to,
      payload,
    ]),
  );
}

async function statusOf(orderId: string): Promise<string> {
  const { rows } = await db.query("SELECT status FROM orders WHERE id = $1", [orderId]);
  return rows[0].status;
}

async function orderAuditCount(orderId: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM audit.audit_log WHERE entity_type = 'order' AND entity_id = $1",
    [orderId],
  );
  return rows[0].n;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'CLIENT','ACTIVE'),
       ($3,'SALES','ACTIVE'), ($4,'OPS','ACTIVE'), ($5,'DESIGNER','ACTIVE')`,
    [client, otherClient, sales, ops, designer],
  );
  // The designer must pass the onboarding gate (0009/0011) to be assignable:
  // a profile plus a real SIGNATURE against the current agreement version.
  await db.query(
    `INSERT INTO designer_profiles (id, user_id, legal_name, email, agreement_accepted_at, agreement_version)
     VALUES ($1, $2, 'Dana', 'dana@studio.example', now(),
             (SELECT version FROM app.current_agreement('DESIGNER')))`,
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

describe("Test M — legal, role-gated, audited order transitions", () => {
  it("a client creates a DRAFT order (audited as ORDER_CREATED)", async () => {
    const res = await asUser(client, () =>
      db.query("SELECT public.create_order($1,$2,$3) AS id", [order, "CAD_MODEL", "USD"]),
    );
    expect(res.rows[0].id).toBe(order);
    expect(await statusOf(order)).toBe("DRAFT");

    const a = await db.query(
      "SELECT action FROM audit.audit_log WHERE entity_id = $1 AND action = 'ORDER_CREATED'",
      [order],
    );
    expect(a.rows).toHaveLength(1);
  });

  it("the client can submit it (DRAFT -> SUBMITTED), audited", async () => {
    await transition(client, order, "SUBMITTED");
    expect(await statusOf(order)).toBe("SUBMITTED");
    const a = await db.query(
      "SELECT action FROM audit.audit_log WHERE entity_id = $1 AND action = 'ORDER_STATUS_CHANGED'",
      [order],
    );
    expect(a.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an ILLEGAL jump (SUBMITTED -> APPROVED)", async () => {
    await expect(transition(client, order, "APPROVED")).rejects.toThrow(/illegal transition/i);
    expect(await statusOf(order)).toBe("SUBMITTED"); // unchanged
  });

  it("rejects a WRONG-ROLE move (a client cannot QUOTE)", async () => {
    await expect(transition(client, order, "QUOTED")).rejects.toThrow(/illegal transition/i);
    expect(await statusOf(order)).toBe("SUBMITTED");
  });

  it("SALES can quote it (SUBMITTED -> QUOTED)", async () => {
    await transition(sales, order, "QUOTED");
    expect(await statusOf(order)).toBe("QUOTED");
  });

  it("walks the happy path through roles: pay -> assign -> start", async () => {
    await transition(client, order, "PAYMENT_HELD");
    expect(await statusOf(order)).toBe("PAYMENT_HELD");

    // OPS assigns a specific designer (sets designer_id)
    await transition(ops, order, "ASSIGNED", JSON.stringify({ designer_id: designer }));
    expect(await statusOf(order)).toBe("ASSIGNED");
    const d = await db.query("SELECT designer_id FROM orders WHERE id = $1", [order]);
    expect(d.rows[0].designer_id).toBe(designer);

    // the assigned DESIGNER can start
    await transition(designer, order, "IN_PROGRESS");
    expect(await statusOf(order)).toBe("IN_PROGRESS");
  });

  it("rejects a NON-PARTICIPANT (another client cannot act on this order)", async () => {
    const draft = generateId();
    await asUser(client, () =>
      db.query("SELECT public.create_order($1,$2)", [draft, "CAD_MODEL"]),
    );
    // otherClient IS a CLIENT (role matches) but is NOT this order's client
    await expect(transition(otherClient, draft, "SUBMITTED")).rejects.toThrow(
      /not the client of this order/i,
    );
    expect(await statusOf(draft)).toBe("DRAFT");
  });

  it("every accepted move was audited and the chain stays valid", async () => {
    // ORDER_CREATED + SUBMITTED + QUOTED + PAYMENT_HELD + ASSIGNED + IN_PROGRESS = 6
    expect(await orderAuditCount(order)).toBe(6);
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });

  it("an unauthenticated caller cannot transition", async () => {
    await db.query("BEGIN");
    try {
      await db.query("SELECT set_config('request.jwt.claims', '', true)");
      await db.query("SET LOCAL ROLE authenticated");
      await expect(
        db.query("SELECT public.transition_order($1,$2::order_status)", [order, "APPROVED"]),
      ).rejects.toThrow(/not authenticated/i);
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
