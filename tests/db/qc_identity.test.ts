import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const client = generateId();
const designer = generateId();
const qc = generateId();
const qc2 = generateId();
const finance = generateId();
const ops = generateId();

beforeAll(async () => {
  db = await connectFreshDb();

  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'DESIGNER','ACTIVE'), ($3,'QC','ACTIVE'),
       ($4,'QC','ACTIVE'), ($5,'FINANCE','ACTIVE'), ($6,'OPS','ACTIVE')`,
    [client, designer, qc, qc2, finance, ops],
  );
  await db.query(
    `INSERT INTO designer_profiles (id, user_id, legal_name, email, agreement_accepted_at, agreement_version)
     VALUES ($1,$2,'Dana Designer','dana@studio.example', now(), 'v1')`,
    [generateId(), designer],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Acme','a@acme.example')",
    [generateId(), client],
  );
  // Record a real signature against the CURRENT agreement, so the designer
  // genuinely passes app.designer_is_assignable() — otherwise the ASSIGNED
  // path stops at that gate and never reaches the independence check.
  await db.query(
    `INSERT INTO agreement_acceptances (id, agreement_id, user_id, content_sha256)
     SELECT $1, d.id, $2, d.content_sha256
     FROM agreement_documents d
     WHERE d.kind = 'DESIGNER'
     ORDER BY d.published_at DESC LIMIT 1`,
    [generateId(), designer],
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

/** Build an order sitting in QC_REVIEW with the given designer. */
async function orderInQcReview(designerId: string | null): Promise<string> {
  const id = generateId();
  await db.query(
    `INSERT INTO orders (id, client_id, designer_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,$3,'CAD_MODEL','QC_REVIEW','USD', 1000, 600, 200, 200)`,
    [id, client, designerId],
  );
  return id;
}

describe("Test AS — independent QC is enforced, recorded, and payable", () => {
  it("a QC reviewer can pass an order, and is recorded on it", async () => {
    const orderId = await orderInQcReview(designer);
    const res = await asUser(qc, () =>
      db.query("SELECT public.record_qc_decision($1,'PASS') AS r", [orderId]),
    );
    expect(res.rows[0].r.to).toBe("CLIENT_PREVIEW");

    const row = await db.query("SELECT status, qc_reviewer_id FROM orders WHERE id=$1", [orderId]);
    expect(row.rows[0]).toEqual({ status: "CLIENT_PREVIEW", qc_reviewer_id: qc });
  });

  it("a QC reviewer can request a revision, and is still recorded", async () => {
    const orderId = await orderInQcReview(designer);
    await asUser(qc2, () => db.query("SELECT public.record_qc_decision($1,'REVISION')", [orderId]));
    const row = await db.query("SELECT status, qc_reviewer_id FROM orders WHERE id=$1", [orderId]);
    expect(row.rows[0]).toEqual({ status: "REVISION_REQUESTED", qc_reviewer_id: qc2 });
  });

  it("REFUSES self-review: the designer of the work cannot review it", async () => {
    // The sharpest case: a user who holds the QC role AND produced the work.
    const dualRole = generateId();
    await db.query("INSERT INTO users (id, role, status) VALUES ($1,'QC','ACTIVE')", [dualRole]);
    const orderId = await orderInQcReview(dualRole);

    await expect(
      asUser(dualRole, () => db.query("SELECT public.record_qc_decision($1,'PASS')", [orderId])),
    ).rejects.toThrow(/cannot review work you produced/i);

    const row = await db.query("SELECT status, qc_reviewer_id FROM orders WHERE id=$1", [orderId]);
    expect(row.rows[0]).toEqual({ status: "QC_REVIEW", qc_reviewer_id: null });
  });

  it("REFUSES review of your own order (client cannot self-approve as QC)", async () => {
    const dualRole = generateId();
    await db.query("INSERT INTO users (id, role, status) VALUES ($1,'QC','ACTIVE')", [dualRole]);
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, designer_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,$3,'CAD_MODEL','QC_REVIEW','USD', 1000, 600, 200, 200)`,
      [id, dualRole, designer],
    );
    await expect(
      asUser(dualRole, () => db.query("SELECT public.record_qc_decision($1,'PASS')", [id])),
    ).rejects.toThrow(/cannot review your own order/i);
  });

  it("only QC may record a decision, and only on a QC_REVIEW order", async () => {
    const orderId = await orderInQcReview(designer);
    await expect(
      asUser(ops, () => db.query("SELECT public.record_qc_decision($1,'PASS')", [orderId])),
    ).rejects.toThrow(/only QC may record/i);
    await expect(
      asUser(designer, () => db.query("SELECT public.record_qc_decision($1,'PASS')", [orderId])),
    ).rejects.toThrow(/only QC may record/i);

    const draft = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,'CAD_MODEL','DRAFT','USD',0,0,0,0)`,
      [draft, client],
    );
    await expect(
      asUser(qc, () => db.query("SELECT public.record_qc_decision($1,'PASS')", [draft])),
    ).rejects.toThrow(/only review an order in QC_REVIEW/i);
  });

  it("rejects an outcome that is not PASS or REVISION", async () => {
    const orderId = await orderInQcReview(designer);
    await expect(
      asUser(qc, () => db.query("SELECT public.record_qc_decision($1,'MAYBE')", [orderId])),
    ).rejects.toThrow(/PASS or REVISION/i);
  });

  it("the generic transition_order can no longer perform a QC decision", async () => {
    const orderId = await orderInQcReview(designer);
    for (const target of ["CLIENT_PREVIEW", "REVISION_REQUESTED"]) {
      await expect(
        asUser(qc, () => db.query("SELECT public.transition_order($1,$2)", [orderId, target])),
      ).rejects.toThrow(/must be recorded via record_qc_decision/i);
    }
    // And the order did not move.
    const row = await db.query("SELECT status FROM orders WHERE id=$1", [orderId]);
    expect(row.rows[0].status).toBe("QC_REVIEW");
  });

  it("an order cannot be assigned to the designer who already reviewed it", async () => {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission, qc_reviewer_id)
       VALUES ($1,$2,'CAD_MODEL','PAYMENT_HELD','USD',1000,600,200,200,$3)`,
      [id, client, designer],
    );
    await expect(
      asUser(ops, () =>
        db.query("SELECT public.transition_order($1,'ASSIGNED',$2)", [
          id,
          JSON.stringify({ designer_id: designer }),
        ]),
      ),
    ).rejects.toThrow(/cannot assign the order to its own reviewer/i);
  });

  it("a QC reviewer keeps visibility of the order after deciding", async () => {
    const orderId = await orderInQcReview(designer);
    await asUser(qc, () => db.query("SELECT public.record_qc_decision($1,'PASS')", [orderId]));
    // Status is now CLIENT_PREVIEW, outside the QC queue policy — the reviewer
    // policy (0017) is what keeps it visible.
    const seen = await asUser(qc, () => db.query("SELECT id FROM orders WHERE id=$1", [orderId]));
    expect(seen.rows.length).toBe(1);
    // ... and an unrelated QC user does NOT see it.
    const unseen = await asUser(qc2, () => db.query("SELECT id FROM orders WHERE id=$1", [orderId]));
    expect(unseen.rows.length).toBe(0);
  });
});

describe("Test AS2 — the QC payout now has a payee", () => {
  async function fundedOrderReadyToRelease(withReviewer: boolean): Promise<string> {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, designer_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission, qc_reviewer_id)
       VALUES ($1,$2,$3,'CAD_MODEL','CLOSED','USD',1000,600,200,200,$4)`,
      [id, client, designer, withReviewer ? qc : null],
    );
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
       VALUES ($1,'HOLD','CLIENT',1000,'USD',$2)`,
      [id, client],
    );
    return id;
  }

  it("records WHO each payout leg is for", async () => {
    const orderId = await fundedOrderReadyToRelease(true);
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [orderId]));

    const { rows } = await db.query(
      "SELECT party, amount, payee_id FROM escrow_ledger WHERE order_id=$1 AND kind='RELEASE' ORDER BY party",
      [orderId],
    );
    expect(rows).toEqual([
      { party: "DESIGNER", amount: 600, payee_id: designer },
      { party: "PLATFORM", amount: 200, payee_id: null }, // the platform is not a user
      { party: "QC", amount: 200, payee_id: qc },
    ]);
  });

  it("REFUSES to release a QC payout when no reviewer was ever recorded", async () => {
    const orderId = await fundedOrderReadyToRelease(false);
    await expect(
      asUser(finance, () => db.query("SELECT public.release_escrow($1)", [orderId])),
    ).rejects.toThrow(/no reviewer is recorded/i);

    // Nothing was released, and the order did not move.
    const legs = await db.query(
      "SELECT count(*)::int AS n FROM escrow_ledger WHERE order_id=$1 AND kind='RELEASE'",
      [orderId],
    );
    expect(legs.rows[0].n).toBe(0);
    const row = await db.query("SELECT status FROM orders WHERE id=$1", [orderId]);
    expect(row.rows[0].status).toBe("CLOSED");
  });

  it("money is still conserved, and the audit chain is still valid", async () => {
    const orderId = await fundedOrderReadyToRelease(true);
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [orderId]));
    const held = await db.query("SELECT app.escrow_held($1) AS held", [orderId]);
    expect(held.rows[0].held).toBe(0);

    const chain = await db.query("SELECT audit.verify_chain() AS result");
    expect(chain.rows[0].result.valid).toBe(true);
  });
});
