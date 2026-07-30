import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb, givePayoutAccount } from "../helpers/db";

/**
 * Test AY — payout execution.
 *
 * `escrow_ledger` says what we OWE; `payouts` says what we have SENT. The
 * properties worth pinning are the ones whose failure costs real money: a
 * release leg is payable exactly once, an executor cannot hand the same
 * instruction to two workers, a redelivered webhook is inert, and a reversal
 * puts the funds back where they can be re-released.
 */
let db: Client;

const client = generateId();
const designer = generateId();
const qc = generateId();
const finance = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'DESIGNER','ACTIVE'), ($3,'QC','ACTIVE'), ($4,'FINANCE','ACTIVE')`,
    [client, designer, qc, finance],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Acme','a@acme.example')",
    [generateId(), client],
  );
  await givePayoutAccount(db, designer);
  await givePayoutAccount(db, qc);
  await db.query("SELECT public.set_payout_account_status($1,'VERIFIED',NULL,$2)", [
    designer,
    "acc_DESIGNER",
  ]);
  await db.query("SELECT public.set_payout_account_status($1,'VERIFIED',NULL,$2)", [
    qc,
    "acc_QC",
  ]);
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

/** A CLOSED, funded order carried all the way through release_escrow. */
async function releasedOrder(): Promise<string> {
  const id = generateId();
  await db.query(
    `INSERT INTO orders (id, client_id, designer_id, qc_reviewer_id, product_type, status,
       currency, price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,$3,$4,'CAD_MODEL','CLOSED','INR',1000,600,200,200)`,
    [id, client, designer, qc],
  );
  await db.query(
    `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by, external_ref)
     VALUES ($1,'HOLD','CLIENT',1000,'INR',$2,$3)`,
    [id, client, `pay_${id}`],
  );
  await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id]));
  return id;
}

const payoutsFor = async (orderId: string) =>
  (
    await db.query(
      "SELECT * FROM payouts WHERE order_id=$1 ORDER BY party",
      [orderId],
    )
  ).rows;

/**
 * Empty the queue. `claim_payouts` is a real work queue ordered oldest-first
 * and capped at 100, so a test that wants to observe ITS OWN rows has to start
 * from an empty queue rather than hoping earlier suites left room in the batch.
 */
async function drainQueue(): Promise<void> {
  for (;;) {
    const { rowCount } = await db.query("SELECT * FROM public.claim_payouts(100)");
    if (!rowCount) return;
  }
}

const held = async (id: string) =>
  (await db.query("SELECT app.escrow_held($1) AS h", [id])).rows[0].h as number;

describe("Test AY1 — turning obligations into instructions", () => {
  it("creates one payout per DESIGNER/QC release leg, and none for PLATFORM", async () => {
    const id = await releasedOrder();
    const r = await db.query("SELECT public.open_payouts_for_order($1) AS r", [id]);
    expect(r.rows[0].r).toEqual({ order_id: id, created: 2, skipped: 0 });

    const rows = await payoutsFor(id);
    expect(rows.map((p) => [p.party, p.amount, p.status])).toEqual([
      ["DESIGNER", 600, "PENDING"],
      ["QC", 200, "PENDING"],
    ]);
    // The platform's commission is already in the platform's account.
    expect(rows.some((p) => p.party === "PLATFORM")).toBe(false);
  });

  it("carries the source payment and the destination account onto each instruction", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    const rows = await payoutsFor(id);
    expect(rows[0].source_payment_ref).toBe(`pay_${id}`);
    expect(rows[0].processor_account_ref).toBe("acc_DESIGNER");
    expect(rows[1].processor_account_ref).toBe("acc_QC");
  });

  it("is idempotent — a second run creates nothing", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    const again = await db.query("SELECT public.open_payouts_for_order($1) AS r", [id]);
    expect(again.rows[0].r).toEqual({ order_id: id, created: 0, skipped: 2 });
    expect(await payoutsFor(id)).toHaveLength(2);
  });

  it("REFUSES to create instructions before anything has been released", async () => {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, designer_id, product_type, status, currency,
         price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,$3,'CAD_MODEL','PAYMENT_HELD','INR',1000,600,200,200)`,
      [id, client, designer],
    );
    await expect(db.query("SELECT public.open_payouts_for_order($1)", [id])).rejects.toThrow(
      /nothing has been released/i,
    );
  });

  it("REFUSES a payee whose account stopped being verified after release", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.set_payout_account_status($1,'REJECTED','account closed')", [
      designer,
    ]);
    await expect(db.query("SELECT public.open_payouts_for_order($1)", [id])).rejects.toThrow(
      /no verified payout account/i,
    );
    expect(await payoutsFor(id)).toHaveLength(0);

    await db.query("SELECT public.set_payout_account_status($1,'VERIFIED',NULL,$2)", [
      designer,
      "acc_DESIGNER",
    ]);
  });

  it("is server-to-server only", async () => {
    const id = await releasedOrder();
    await expect(
      asUser(finance, () => db.query("SELECT public.open_payouts_for_order($1)", [id])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Test AY2 — a release leg is payable exactly once", () => {
  it("the database itself refuses a second payout for the same leg", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    const [first] = await payoutsFor(id);

    await expect(
      db.query(
        `INSERT INTO payouts (order_id, ledger_id, payee_id, party, amount, currency, idempotency_key)
         VALUES ($1,$2,$3,'DESIGNER',600,'INR','payout:duplicate')`,
        [id, first.ledger_id, designer],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("the idempotency key is derived from the leg, so a re-run recomputes the same key", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    for (const p of await payoutsFor(id)) {
      expect(p.idempotency_key).toBe(`payout:${p.ledger_id}`);
    }
  });
});

describe("Test AY3 — claiming work", () => {
  it("flips to PROCESSING and counts the attempt in the same statement", async () => {
    await drainQueue();
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);

    const { rows } = await db.query("SELECT * FROM public.claim_payouts(10)");
    const mine = rows.filter((r) => r.order_id === id);
    expect(mine).toHaveLength(2);
    for (const p of mine) {
      expect(p.status).toBe("PROCESSING");
      expect(p.attempts).toBe(1);
    }
  });

  it("does not hand the same instruction out twice", async () => {
    await drainQueue();
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    await db.query("SELECT * FROM public.claim_payouts(50)");

    const { rows } = await db.query("SELECT * FROM public.claim_payouts(50)");
    expect(rows.filter((r) => r.order_id === id)).toHaveLength(0);
  });

  it("rejects a nonsense batch size rather than scanning the table", async () => {
    await expect(db.query("SELECT * FROM public.claim_payouts(0)")).rejects.toThrow(/between 1 and 100/i);
    await expect(db.query("SELECT * FROM public.claim_payouts(101)")).rejects.toThrow(
      /between 1 and 100/i,
    );
  });

  it("is server-to-server only", async () => {
    await expect(
      asUser(finance, () => db.query("SELECT * FROM public.claim_payouts(1)")),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Test AY4 — recording what the processor did", () => {
  async function claimedPayout(): Promise<{ orderId: string; key: string }> {
    const orderId = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [orderId]);
    const { rows } = await db.query(
      "SELECT idempotency_key FROM payouts WHERE order_id=$1 AND party='DESIGNER'",
      [orderId],
    );
    await drainQueue();
    return { orderId, key: rows[0].idempotency_key };
  }

  it("marks a payout PAID with the processor's reference", async () => {
    const { key } = await claimedPayout();
    const r = await db.query("SELECT public.record_payout_result($1,'PAID','trf_ABC') AS r", [key]);
    expect(r.rows[0].r.applied).toBe(true);

    const { rows } = await db.query("SELECT * FROM payouts WHERE idempotency_key=$1", [key]);
    expect(rows[0].status).toBe("PAID");
    expect(rows[0].processor_transfer_ref).toBe("trf_ABC");
    expect(rows[0].paid_at).not.toBeNull();
  });

  it("REFUSES a success with no processor reference to reconcile against", async () => {
    const { key } = await claimedPayout();
    await expect(
      db.query("SELECT public.record_payout_result($1,'PAID')", [key]),
    ).rejects.toThrow(/must record the processor reference/i);
  });

  it("a redelivered success is a no-op, not a second payment", async () => {
    const { key } = await claimedPayout();
    await db.query("SELECT public.record_payout_result($1,'PAID','trf_DUP')", [key]);
    const again = await db.query("SELECT public.record_payout_result($1,'PAID','trf_DUP') AS r", [key]);
    expect(again.rows[0].r.applied).toBe(false);
  });

  it("a failure must say why, and stays retryable", async () => {
    const { key } = await claimedPayout();
    await expect(
      db.query("SELECT public.record_payout_result($1,'FAILED')", [key]),
    ).rejects.toThrow(/must record why/i);

    await db.query(
      "SELECT public.record_payout_result($1,'FAILED', p_failure_reason => 'beneficiary name mismatch')",
      [key],
    );
    const { rows } = await db.query("SELECT * FROM payouts WHERE idempotency_key=$1", [key]);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].failure_reason).toMatch(/mismatch/);

    // A transfer that never left is safe to retry — and must be, or the
    // designer is simply never paid.
    const claimed = await db.query("SELECT * FROM public.claim_payouts(100)");
    const again = claimed.rows.find((r) => r.idempotency_key === key);
    expect(again?.status).toBe("PROCESSING");
    expect(again?.attempts).toBe(2);
  });

  it("REFUSES to fail a payout that already went out", async () => {
    const { key } = await claimedPayout();
    await db.query("SELECT public.record_payout_result($1,'PAID','trf_SETTLED')", [key]);
    await expect(
      db.query(
        "SELECT public.record_payout_result($1,'FAILED', p_failure_reason => 'too late')",
        [key],
      ),
    ).rejects.toThrow(/already settled/i);
  });

  it("REFUSES to reverse something that never left — that would invent money", async () => {
    // PENDING: opened but never claimed, so no transfer was ever created.
    const orderId = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [orderId]);
    const { rows } = await db.query(
      "SELECT idempotency_key FROM payouts WHERE order_id=$1 AND party='DESIGNER'",
      [orderId],
    );
    await expect(
      db.query("SELECT public.record_payout_result($1,'REVERSED')", [rows[0].idempotency_key]),
    ).rejects.toThrow(/only a sent payout can be reversed/i);
    expect(await held(orderId)).toBe(0);
  });

  it("accepts a reversal that beats our own success webhook to the row", async () => {
    // Razorpay can settle and reverse before transfer.processed lands. If this
    // raised, the reversal webhook would 500 forever on Razorpay's retries.
    const { orderId, key } = await claimedPayout();
    const r = await db.query(
      "SELECT public.record_payout_result($1,'REVERSED','trf_RACE', 'reversed before we heard') AS r",
      [key],
    );
    expect(r.rows[0].r.applied).toBe(true);
    expect(await held(orderId)).toBe(600);

    const { rows } = await db.query(
      "SELECT external_ref FROM escrow_ledger WHERE idempotency_key=$1",
      [`reversal:${key}`],
    );
    // The reversal leg still records WHICH transfer came back.
    expect(rows[0].external_ref).toBe("trf_RACE");
  });

  it("a reversal returns the money to escrow, where it can be re-released", async () => {
    const { orderId, key } = await claimedPayout();
    await db.query("SELECT public.record_payout_result($1,'PAID','trf_REV')", [key]);
    expect(await held(orderId)).toBe(0);

    await db.query(
      "SELECT public.record_payout_result($1,'REVERSED', p_failure_reason => 'bank returned it')",
      [key],
    );

    const { rows } = await db.query("SELECT * FROM payouts WHERE idempotency_key=$1", [key]);
    expect(rows[0].status).toBe("REVERSED");
    // 600 came back into escrow — the designer's leg, reversed.
    expect(await held(orderId)).toBe(600);
  });

  it("a redelivered reversal cannot credit escrow twice", async () => {
    const { orderId, key } = await claimedPayout();
    await db.query("SELECT public.record_payout_result($1,'PAID','trf_REV2')", [key]);
    await db.query(
      "SELECT public.record_payout_result($1,'REVERSED', p_failure_reason => 'returned')",
      [key],
    );
    const afterFirst = await held(orderId);

    const again = await db.query(
      "SELECT public.record_payout_result($1,'REVERSED', p_failure_reason => 'returned') AS r",
      [key],
    );
    expect(again.rows[0].r.applied).toBe(false);
    expect(await held(orderId)).toBe(afterFirst);
  });

  it("is server-to-server only", async () => {
    const { key } = await claimedPayout();
    await expect(
      asUser(finance, () => db.query("SELECT public.record_payout_result($1,'PAID','x')", [key])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Test AY7 — instructions stuck in flight", () => {
  it("does NOT re-claim a PROCESSING payout — a transfer may already be moving", async () => {
    await drainQueue();
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    await db.query("SELECT * FROM public.claim_payouts(100)");

    const { rows } = await db.query("SELECT * FROM public.claim_payouts(100)");
    expect(rows.filter((r) => r.order_id === id)).toHaveLength(0);
  });

  it("surfaces them once they are older than the threshold, so they can be reconciled", async () => {
    await drainQueue();
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    await db.query("SELECT * FROM public.claim_payouts(100)");

    // Nothing is stale yet — a reconcile pass must not fight a live payout run.
    const fresh = await db.query("SELECT * FROM public.stale_payouts(15)");
    expect(fresh.rows.filter((r) => r.order_id === id)).toHaveLength(0);

    // Age them past the window.
    await db.query(
      "UPDATE payouts SET updated_at = now() - interval '1 hour' WHERE order_id=$1",
      [id],
    );
    const stale = await db.query("SELECT * FROM public.stale_payouts(15)");
    expect(stale.rows.filter((r) => r.order_id === id)).toHaveLength(2);
  });

  it("a reconciled-as-never-sent payout becomes retryable again", async () => {
    await drainQueue();
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    await db.query("SELECT * FROM public.claim_payouts(100)");
    await db.query(
      "UPDATE payouts SET updated_at = now() - interval '1 hour' WHERE order_id=$1",
      [id],
    );

    const { rows } = await db.query("SELECT idempotency_key FROM payouts WHERE order_id=$1", [id]);
    for (const p of rows) {
      await db.query(
        "SELECT public.record_payout_result($1,'FAILED', p_failure_reason => 'no transfer found at the processor; safe to retry')",
        [p.idempotency_key],
      );
    }

    const reclaimed = await db.query("SELECT * FROM public.claim_payouts(100)");
    expect(reclaimed.rows.filter((r) => r.order_id === id)).toHaveLength(2);
  });

  it("is server-to-server only", async () => {
    await expect(
      asUser(finance, () => db.query("SELECT * FROM public.stale_payouts(15)")),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Test AY5 — what each side can see", () => {
  it("a payee sees their own payouts, without any processor internals", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);

    const { rows, fields } = await asUser(designer, () =>
      db.query("SELECT * FROM public.my_payouts(50)"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.party === "DESIGNER")).toBe(true);

    const columns = fields.map((f) => f.name);
    expect(columns).not.toContain("processor_transfer_ref");
    expect(columns).not.toContain("processor_account_ref");
    expect(columns).not.toContain("payee_id");
  });

  it("a payee sees NOTHING of another payee's payouts", async () => {
    const { rows } = await asUser(qc, () => db.query("SELECT * FROM public.my_payouts(50)"));
    expect(rows.every((r) => r.party === "QC")).toBe(true);
  });

  it("the raw table is unreadable, even by the payee", async () => {
    const { rows } = await asUser(designer, () => db.query("SELECT * FROM payouts"));
    expect(rows).toHaveLength(0);
  });

  it("payout_state shows owed against sent, which is what reconciliation needs", async () => {
    const id = await releasedOrder();
    await db.query("SELECT public.open_payouts_for_order($1)", [id]);
    let state = (await db.query("SELECT public.payout_state($1) AS s", [id])).rows[0].s;
    expect(state.owed).toBe(800);
    expect(state.in_flight).toBe(800);
    expect(state.paid).toBe(0);

    const { rows } = await db.query("SELECT idempotency_key FROM payouts WHERE order_id=$1", [id]);
    await drainQueue();
    for (const p of rows) {
      await db.query("SELECT public.record_payout_result($1,'PAID',$2)", [
        p.idempotency_key,
        `trf_${p.idempotency_key}`,
      ]);
    }

    state = (await db.query("SELECT public.payout_state($1) AS s", [id])).rows[0].s;
    expect(state.paid).toBe(800);
    expect(state.in_flight).toBe(0);
  });
});

describe("Test AY6 — schema guarantees", () => {
  it("grants no direct write path to any client role", async () => {
    const { rows } = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='payouts'
         AND grantee IN ('anon','authenticated')`,
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(["SELECT", "SELECT"]);
  });

  it("has RLS enabled and FORCED, with zero allow policies", async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname='public' AND p.tablename='payouts') AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='payouts'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
    expect(rows[0].policies).toBe(0);
  });

  it("the audit chain survives a full pay-and-reverse cycle", async () => {
    const chain = await db.query("SELECT audit.verify_chain() AS result");
    expect(chain.rows[0].result.valid).toBe(true);
  });
});
