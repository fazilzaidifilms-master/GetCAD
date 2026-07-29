import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

/**
 * Test AW — payout identity.
 *
 * This table holds the most sensitive data in the system (a government tax id
 * and a bank account, tied to a real person) and gates the moment money leaves
 * escrow. The properties worth pinning are therefore: nobody reads the raw
 * row, nobody writes someone else's, changing the destination cannot keep a
 * verified state, and escrow cannot drain to a payee we cannot pay.
 */
let db: Client;

const client = generateId();
const designer = generateId();
const other = generateId();
const qc = generateId();
const finance = generateId();

const VALID = {
  name: "Dana Designer",
  pan: "ABCDE1234F",
  account: "123456789012",
  ifsc: "HDFC0001234",
  type: "SAVINGS",
};

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'DESIGNER','ACTIVE'), ($3,'DESIGNER','ACTIVE'),
       ($4,'QC','ACTIVE'), ($5,'FINANCE','ACTIVE')`,
    [client, designer, other, qc, finance],
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

function submit(sub: string, o: Partial<typeof VALID> = {}) {
  const v = { ...VALID, ...o };
  return asUser(sub, () =>
    db.query("SELECT public.upsert_payout_account($1,$2,$3,$4,$5) AS r", [
      v.name,
      v.pan,
      v.account,
      v.ifsc,
      v.type,
    ]),
  );
}

const rowFor = async (userId: string) =>
  (await db.query("SELECT * FROM payout_accounts WHERE user_id=$1", [userId])).rows[0];

describe("Test AW1 — submitting payout identity", () => {
  it("stores a valid account as PENDING_VERIFICATION", async () => {
    const r = await submit(designer);
    expect(r.rows[0].r).toEqual({ status: "PENDING_VERIFICATION", account_last4: "9012" });

    const row = await rowFor(designer);
    expect(row.status).toBe("PENDING_VERIFICATION");
    expect(row.account_last4).toBe("9012");
    expect(row.pan_last4).toBe("234F");
    expect(row.country).toBe("IN");
  });

  it("normalizes casing and the separators people actually paste", async () => {
    await submit(other, {
      name: "  Ravi   Kumar  ",
      pan: "abcde 1234 f",
      account: "1234-5678-9012",
      ifsc: "hdfc0001234",
    });
    const row = await rowFor(other);
    expect(row.beneficiary_name).toBe("Ravi Kumar");
    expect(row.pan).toBe("ABCDE1234F");
    expect(row.account_number).toBe("123456789012");
    expect(row.ifsc).toBe("HDFC0001234");
  });

  it("rejects a malformed PAN, IFSC, account number and account type by name", async () => {
    await expect(submit(designer, { pan: "ABCD1234F" })).rejects.toThrow(/PAN/i);
    await expect(submit(designer, { ifsc: "HDFC1001234" })).rejects.toThrow(/IFSC/i); // 5th char must be 0
    await expect(submit(designer, { account: "12345" })).rejects.toThrow(/9 to 18 digits/i);
    await expect(submit(designer, { account: "12345678901X" })).rejects.toThrow(/9 to 18 digits/i);
    await expect(submit(designer, { type: "FIXED_DEPOSIT" })).rejects.toThrow(/SAVINGS or CURRENT/i);
    await expect(submit(designer, { name: "X" })).rejects.toThrow(/beneficiary name/i);
  });

  it("refuses roles that receive no payout — a client has no reason to bank with us", async () => {
    await expect(submit(client)).rejects.toThrow(/only a designer or QC reviewer/i);
  });

  it("takes no user_id at all, so there is no way to point someone else's payouts at your bank", async () => {
    const { rows } = await db.query(
      `SELECT pg_get_function_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='upsert_payout_account'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].args).not.toMatch(/user_id/i);
  });
});

describe("Test AW2 — nobody reads the raw row", () => {
  it("the owner cannot SELECT their own payout_accounts row", async () => {
    const { rows } = await asUser(designer, () =>
      db.query("SELECT * FROM payout_accounts WHERE user_id=$1", [designer]),
    );
    expect(rows).toHaveLength(0);
  });

  it("my_payout_account returns fragments and never the secrets", async () => {
    const { rows } = await asUser(designer, () =>
      db.query("SELECT public.my_payout_account() AS a"),
    );
    const a = rows[0].a;
    expect(a.account_last4).toBe("9012");
    expect(a.pan_last4).toBe("234F");
    expect(a.ifsc).toBe("HDFC0001234");
    expect(a.status).toBe("PENDING_VERIFICATION");

    const serialized = JSON.stringify(a);
    expect(serialized).not.toContain(VALID.account);
    expect(serialized).not.toContain(VALID.pan);
    expect(Object.keys(a)).not.toContain("account_number");
    expect(Object.keys(a)).not.toContain("pan");
  });

  it("returns null when the caller has submitted nothing", async () => {
    const { rows } = await asUser(qc, () => db.query("SELECT public.my_payout_account() AS a"));
    expect(rows[0].a).toBeNull();
  });

  it("shows a caller only their OWN account, never another designer's", async () => {
    const { rows } = await asUser(other, () => db.query("SELECT public.my_payout_account() AS a"));
    // `other` banked 1234-5678-9012 too, but the point is it resolves by token,
    // not by any argument the caller controls — there is no argument.
    expect(rows[0].a.beneficiary_name).toBe("Ravi Kumar");
  });

  it("the audit trail records the submission without recording the secrets", async () => {
    const { rows } = await db.query(
      `SELECT payload FROM audit.audit_log
       WHERE action='PAYOUT_ACCOUNT_SUBMITTED' AND entity_id=$1 ORDER BY seq DESC LIMIT 1`,
      [designer],
    );
    const payload = JSON.stringify(rows[0].payload);
    expect(payload).not.toContain(VALID.account);
    expect(payload).not.toContain(VALID.pan);
    expect(rows[0].payload.account_last4).toBe("9012");
  });
});

describe("Test AW3 — verification, and what re-submitting costs you", () => {
  it("is server-to-server only: a session cannot verify itself", async () => {
    await expect(
      asUser(designer, () =>
        db.query("SELECT public.set_payout_account_status($1,'VERIFIED')", [designer]),
      ),
    ).rejects.toThrow(/permission denied/i);
    expect((await rowFor(designer)).status).toBe("PENDING_VERIFICATION");
  });

  it("verifies and stores the processor's handles", async () => {
    await db.query("SELECT public.set_payout_account_status($1,'VERIFIED',NULL,$2,$3)", [
      designer,
      "acc_TEST123",
      "fa_TEST123",
    ]);
    const row = await rowFor(designer);
    expect(row.status).toBe("VERIFIED");
    expect(row.processor_account_ref).toBe("acc_TEST123");
  });

  it("a rejection must carry a reason the person can act on", async () => {
    await expect(
      db.query("SELECT public.set_payout_account_status($1,'REJECTED')", [other]),
    ).rejects.toThrow(/must carry a reason/i);
  });

  it("CHANGING THE DESTINATION UNDOES VERIFICATION and drops the stale processor handles", async () => {
    expect((await rowFor(designer)).status).toBe("VERIFIED");

    await submit(designer, { account: "999988887777" });

    const row = await rowFor(designer);
    expect(row.status).toBe("PENDING_VERIFICATION");
    expect(row.account_last4).toBe("7777");
    // These identified the OLD beneficiary at the processor. Keeping them would
    // pay the previous account while the UI shows the new one.
    expect(row.processor_account_ref).toBeNull();
    expect(row.processor_fund_account_ref).toBeNull();
  });

  it("keeps exactly one account per user — a re-submission replaces, never accumulates", async () => {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM payout_accounts WHERE user_id=$1",
      [designer],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("Test AW4 — escrow cannot drain to a payee we cannot pay", () => {
  async function closedFundedOrder(): Promise<string> {
    const id = generateId();
    await db.query(
      `INSERT INTO orders (id, client_id, designer_id, qc_reviewer_id, product_type, status,
         currency, price_total, designer_payout, qc_payout, platform_commission)
       VALUES ($1,$2,$3,$4,'CAD_MODEL','CLOSED','INR',1000,600,200,200)`,
      [id, client, designer, qc],
    );
    await db.query(
      `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by)
       VALUES ($1,'HOLD','CLIENT',1000,'INR',$2)`,
      [id, client],
    );
    return id;
  }

  const setStatus = (userId: string, status: string) =>
    db.query("SELECT public.set_payout_account_status($1,$2,$3)", [
      userId,
      status,
      status === "REJECTED" ? "test rejection" : null,
    ]);

  it("REFUSES when the designer has submitted nothing at all", async () => {
    // qc has no account either; the designer check runs first.
    const id = await closedFundedOrder();
    await db.query("DELETE FROM payout_accounts WHERE user_id=$1", [designer]);
    await expect(
      asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id])),
    ).rejects.toThrow(/designer has no verified payout account/i);

    const legs = await db.query(
      "SELECT count(*)::int AS n FROM escrow_ledger WHERE order_id=$1 AND kind='RELEASE'",
      [id],
    );
    expect(legs.rows[0].n).toBe(0);
    expect((await db.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status).toBe(
      "CLOSED",
    );
  });

  it("REFUSES while the account is only PENDING_VERIFICATION, and while REJECTED", async () => {
    const id = await closedFundedOrder();
    await submit(designer);
    for (const status of ["PENDING_VERIFICATION", "REJECTED"]) {
      await setStatus(designer, status);
      await expect(
        asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id])),
      ).rejects.toThrow(/designer has no verified payout account/i);
    }
  });

  it("REFUSES a QC payout when the reviewer is not payable, even if the designer is", async () => {
    const id = await closedFundedOrder();
    await setStatus(designer, "VERIFIED");
    await expect(
      asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id])),
    ).rejects.toThrow(/reviewer has no verified payout account/i);
  });

  it("releases once every payee is verified, and escrow returns to zero", async () => {
    const id = await closedFundedOrder();
    await setStatus(designer, "VERIFIED");
    await submit(qc);
    await setStatus(qc, "VERIFIED");

    await asUser(finance, () => db.query("SELECT public.release_escrow($1)", [id]));
    const held = await db.query("SELECT app.escrow_held($1) AS h", [id]);
    expect(held.rows[0].h).toBe(0);
    expect((await db.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status).toBe(
      "PAYOUT_RELEASED",
    );

    const chain = await db.query("SELECT audit.verify_chain() AS result");
    expect(chain.rows[0].result.valid).toBe(true);
  });
});

describe("Test AW5 — schema guarantees", () => {
  it("the unstructured designer_profiles.payout_details sink is gone", async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='designer_profiles' AND column_name='payout_details'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("the country tripwire blocks a non-Indian account rather than storing a meaningless IFSC", async () => {
    await expect(
      db.query(
        `INSERT INTO payout_accounts
           (user_id, country, beneficiary_name, pan, account_number, ifsc, account_type)
         VALUES ($1,'US','Someone','ABCDE1234F','123456789012','HDFC0001234','SAVINGS')`,
        [qc],
      ),
    ).rejects.toThrow(/country/i);
  });

  it("grants no direct write path to any client role", async () => {
    const { rows } = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='payout_accounts'
         AND grantee IN ('anon','authenticated')`,
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(["SELECT", "SELECT"]);
  });

  it("has RLS enabled and FORCED, with zero allow policies", async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname='public' AND p.tablename='payout_accounts') AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='payout_accounts'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
    expect(rows[0].policies).toBe(0);
  });
});
