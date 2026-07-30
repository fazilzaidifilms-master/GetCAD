import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb, givePayoutAccount } from "../helpers/db";

/**
 * Test BD — lifecycle emails.
 *
 * A review decision and a paid payout each enqueue an email transactionally
 * with the event (0027), reusing the outbox. What matters: the right email is
 * enqueued to the right person for the right event, a toggle doesn't spam, and
 * the internal-only cases (reopening a review; a payee with no email) enqueue
 * nothing.
 */
let db: Client;

const ops = generateId();
const client = generateId();
const designer = generateId();
const qc = generateId();
const finance = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'OPS','ACTIVE'), ($2,'CLIENT','ACTIVE'), ($3,'DESIGNER','ACTIVE'),
       ($4,'QC','ACTIVE'), ($5,'FINANCE','ACTIVE')`,
    [ops, client, designer, qc, finance],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Acme','a@acme.example')",
    [generateId(), client],
  );
  // The designer payee HAS a profile email; the QC payee deliberately does not.
  await db.query(
    "INSERT INTO designer_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Dana','dana@studio.example')",
    [generateId(), designer],
  );
  await givePayoutAccount(db, designer);
  await givePayoutAccount(db, qc);
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

const outbox = async (key: string) =>
  (await db.query("SELECT * FROM email_outbox WHERE idempotency_key=$1", [key])).rows[0];

async function newApplication(email = "applicant@studio.example"): Promise<string> {
  const id = generateId();
  await db.query(
    `SELECT public.submit_designer_application(
       $1,'Ada Applicant',$2,'+1 555 0100','India',5,'RHINO',
       ARRAY['RINGS']::text[], 'https://folio.example/ada', NULL)`,
    [id, email],
  );
  return id;
}

describe("Test BD1 — application decision emails", () => {
  it("enqueues an ACCEPTED email to the applicant on accept", async () => {
    const id = await newApplication();
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'ACCEPTED')", [id]));
    const row = await outbox(`email:app_decision:accepted:${id}`);
    expect(row.template).toBe("DESIGNER_APPLICATION_ACCEPTED");
    expect(row.recipient_email).toBe("applicant@studio.example");
    expect(row.payload).toEqual({ full_name: "Ada Applicant" });
  });

  it("enqueues a REJECTED email on reject", async () => {
    const id = await newApplication();
    await asUser(ops, () =>
      db.query("SELECT public.review_designer_application($1,'REJECTED','not a fit')", [id]),
    );
    expect((await outbox(`email:app_decision:rejected:${id}`)).template).toBe(
      "DESIGNER_APPLICATION_REJECTED",
    );
  });

  it("enqueues NOTHING when a decision is reopened to PENDING_REVIEW", async () => {
    const id = await newApplication();
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'PENDING_REVIEW')", [id]));
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM email_outbox WHERE idempotency_key LIKE $1",
      [`email:app_decision:%:${id}`],
    );
    expect(rows[0].n).toBe(0);
  });

  it("does not spam when the same decision is applied twice", async () => {
    const id = await newApplication();
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'ACCEPTED')", [id]));
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'ACCEPTED')", [id]));
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM email_outbox WHERE idempotency_key=$1",
      [`email:app_decision:accepted:${id}`],
    );
    expect(rows[0].n).toBe(1);
  });

  it("sends a fresh email when a rejection is later overturned to accept", async () => {
    const id = await newApplication();
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'REJECTED','initial')", [id]));
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'ACCEPTED')", [id]));
    expect(await outbox(`email:app_decision:rejected:${id}`)).toBeDefined();
    expect(await outbox(`email:app_decision:accepted:${id}`)).toBeDefined();
  });
});

describe("Test BD2 — payout sent email", () => {
  async function paidPayout(payee: string): Promise<string> {
    const orderId = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, designer_id, qc_reviewer_id, product_type, status,
         currency, price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,$3,$4,'CAD_MODEL','CLOSED','INR',1000,600,200,200)`,
      [orderId, client, designer, qc],
    );
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by, external_ref)
       VALUES ($1,'HOLD','CLIENT',1000,'INR',$2,$3)`,
      [orderId, client, `pay_${orderId}`],
    );
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [orderId]));
    await db.query("SELECT public.open_payouts_for_order($1)", [orderId]);
    const party = payee === designer ? "DESIGNER" : "QC";
    const { rows } = await db.query(
      "SELECT idempotency_key, id FROM payouts WHERE order_id=$1 AND party=$2",
      [orderId, party],
    );
    await db.query("SELECT * FROM public.claim_payouts(50)");
    await db.query("SELECT public.record_payout_result($1,'PAID',$2)", [
      rows[0].idempotency_key,
      `trf_${rows[0].id}`,
    ]);
    return rows[0].id;
  }

  it("emails a designer payee, with the amount and an opaque order ref", async () => {
    const payoutId = await paidPayout(designer);
    const row = await outbox(`email:payout_sent:${payoutId}`);
    expect(row.template).toBe("PAYOUT_SENT");
    expect(row.recipient_email).toBe("dana@studio.example");
    expect(row.payload.amount_minor).toBe(600);
    expect(row.payload.currency).toBe("INR");
  });

  it("enqueues NOTHING for a payee with no profile email (a QC reviewer)", async () => {
    const payoutId = await paidPayout(qc);
    expect(await outbox(`email:payout_sent:${payoutId}`)).toBeUndefined();
  });

  it("does not re-enqueue on a redelivered PAID webhook", async () => {
    const payoutId = await paidPayout(designer);
    // Re-record PAID for the same payout: idempotent no-op, no second email.
    const key = (
      await db.query("SELECT idempotency_key FROM payouts WHERE id=$1", [payoutId])
    ).rows[0].idempotency_key;
    await db.query("SELECT public.record_payout_result($1,'PAID',$2)", [key, "trf_again"]);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM email_outbox WHERE idempotency_key=$1",
      [`email:payout_sent:${payoutId}`],
    );
    expect(rows[0].n).toBe(1);
  });

  it("does not email on a payout FAILURE — only on money actually sent", async () => {
    const orderId = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, designer_id, qc_reviewer_id, product_type, status,
         currency, price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,$3,$4,'CAD_MODEL','CLOSED','INR',1000,600,200,200)`,
      [orderId, client, designer, qc],
    );
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by, external_ref)
       VALUES ($1,'HOLD','CLIENT',1000,'INR',$2,$3)`,
      [orderId, client, `pay_${orderId}`],
    );
    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [orderId]));
    await db.query("SELECT public.open_payouts_for_order($1)", [orderId]);
    const key = (
      await db.query("SELECT idempotency_key FROM payouts WHERE order_id=$1 AND party='DESIGNER'", [orderId])
    ).rows[0].idempotency_key;
    await db.query("SELECT * FROM public.claim_payouts(50)");
    await db.query("SELECT public.record_payout_result($1,'FAILED', p_failure_reason => 'bank rejected')", [key]);

    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM email_outbox WHERE template='PAYOUT_SENT' AND payload->>'order_ref' = $1",
      [orderId.slice(0, 12)],
    );
    expect(rows[0].n).toBe(0);
  });
});
