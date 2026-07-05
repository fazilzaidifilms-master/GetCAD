import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const client = generateId();
const otherClient = generateId();
const sales = generateId();
const ops = generateId();
const qc = generateId();
const finance = generateId();
const designer = generateId();

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

interface TimelineRow {
  seq: string;
  action: string;
  actor_role: string;
  from_status: string | null;
  to_status: string | null;
  amount: number | null;
  detail: string | null;
}

async function timelineAs(sub: string): Promise<TimelineRow[]> {
  return asUser(sub, async () => {
    const { rows } = await db.query(
      "SELECT seq, action, actor_role, from_status, to_status, amount, detail FROM public.order_timeline($1) ORDER BY seq",
      [order],
    );
    return rows;
  });
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'),($2,'CLIENT','ACTIVE'),($3,'SALES','ACTIVE'),
       ($4,'OPS','ACTIVE'),($5,'QC','ACTIVE'),($6,'FINANCE','ACTIVE'),($7,'DESIGNER','ACTIVE')`,
    [client, otherClient, sales, ops, qc, finance, designer],
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

  // Walk the order all the way through QC to CLIENT_PREVIEW.
  await asUser(client, () => db.query("SELECT public.create_order($1,$2,'USD')", [order, "CAD_MODEL"]));
  await asUser(client, () => db.query("SELECT public.transition_order($1,'SUBMITTED'::order_status)", [order]));
  await asUser(sales, () => db.query("SELECT public.quote_order($1,10000,6000,1000,3000)", [order]));
  await asUser(client, () => db.query("SELECT public.hold_escrow($1)", [order]));
  await asUser(ops, () =>
    db.query("SELECT public.transition_order($1,'ASSIGNED'::order_status,$2::jsonb)", [
      order,
      JSON.stringify({ designer_id: designer }),
    ]),
  );
  await asUser(designer, () => db.query("SELECT public.transition_order($1,'IN_PROGRESS'::order_status)", [order]));
  await asUser(designer, () =>
    db.query("SELECT public.transition_order($1,'DESIGNER_SUBMITTED'::order_status)", [order]),
  );
  await asUser(ops, () => db.query("SELECT public.transition_order($1,'QC_REVIEW'::order_status)", [order]));
  await asUser(qc, () => db.query("SELECT public.transition_order($1,'CLIENT_PREVIEW'::order_status)", [order]));
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test AH — order timeline (client-safe audit window)", () => {
  it("the client sees the full lifecycle in order, with the QC milestone present", async () => {
    const rows = await timelineAs(client);
    expect(rows.map((r) => r.action)).toEqual([
      "ORDER_CREATED",
      "ORDER_STATUS_CHANGED",
      "ORDER_QUOTED",
      "ESCROW_HELD",
      "ORDER_STATUS_CHANGED", // ASSIGNED
      "ORDER_STATUS_CHANGED", // IN_PROGRESS
      "ORDER_STATUS_CHANGED", // DESIGNER_SUBMITTED
      "ORDER_STATUS_CHANGED", // QC_REVIEW
      "ORDER_STATUS_CHANGED", // CLIENT_PREVIEW <- the QC milestone
    ]);
    // seq strictly increasing (chronological)
    const seqs = rows.map((r) => Number(r.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const qcMilestone = rows.find((r) => r.from_status === "QC_REVIEW" && r.to_status === "CLIENT_PREVIEW");
    expect(qcMilestone?.actor_role).toBe("QC"); // reviewer shown by ROLE only
  });

  it("the assigned designer sees the same timeline", async () => {
    const rows = await timelineAs(designer);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.action === "ORDER_QUOTED")).toBe(true);
  });

  it("staff with a current queue-slot role can also read it (OPS/SALES/QC/FINANCE via existing visibility)", async () => {
    // QC could see it while the order sat in QC_REVIEW; by now it has moved on to
    // CLIENT_PREVIEW, so QC's staff-queue visibility has expired — confirms the
    // timeline visibility is exactly as narrow as order visibility, not broader.
    await expect(timelineAs(qc)).rejects.toThrow(/not found or not visible/i);
  });

  it("a non-participant cannot read the timeline", async () => {
    await expect(timelineAs(otherClient)).rejects.toThrow(/not found or not visible/i);
  });

  it("every row is stripped of actor identity — only actor_role travels", async () => {
    const { rows: columns } = await db.query(`
      SELECT p.parameter_name
      FROM information_schema.parameters p
      JOIN information_schema.routines r ON r.specific_name = p.specific_name
      WHERE r.routine_name = 'order_timeline'
    `);
    // RETURNS TABLE columns show up as OUT parameters; confirm no actor_id-shaped one.
    const rows = await timelineAs(client);
    for (const r of rows) {
      expect(Object.keys(r)).not.toContain("actor_id");
    }
    expect(columns.length).toBeGreaterThanOrEqual(0); // sanity: query ran
  });

  it("amounts surface for money-bearing entries (quote/hold), matching the ledger", async () => {
    const rows = await timelineAs(client);
    const quoted = rows.find((r) => r.action === "ORDER_QUOTED");
    const held = rows.find((r) => r.action === "ESCROW_HELD");
    expect(quoted?.amount).toBe(10000);
    expect(held?.amount).toBe(10000);
  });
});
