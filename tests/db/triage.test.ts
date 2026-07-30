import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

/**
 * Test BC — staff triage of the public inboxes.
 *
 * Applications and leads are written by the public and were readable by nobody
 * through the app. This adds the staff read + decision paths. What matters:
 * only OPS/SALES can see the contact PII or act on it (QC and FINANCE are staff
 * but refused), a decision records who made it, and accepting an application
 * does NOT mint a designer account.
 */
let db: Client;

const ops = generateId();
const sales = generateId();
const qc = generateId();
const finance = generateId();
const client = generateId();
const designer = generateId();

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'OPS','ACTIVE'), ($2,'SALES','ACTIVE'), ($3,'QC','ACTIVE'),
       ($4,'FINANCE','ACTIVE'), ($5,'CLIENT','ACTIVE'), ($6,'DESIGNER','ACTIVE')`,
    [ops, sales, qc, finance, client, designer],
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

async function newApplication(name = "Dana Designer"): Promise<string> {
  const id = generateId();
  await db.query(
    `SELECT public.submit_designer_application(
       $1,$2,'dana@studio.example','+1 555 0100','India',5,'RHINO',
       ARRAY['RINGS']::text[], 'https://folio.example/dana', NULL)`,
    [id, name],
  );
  return id;
}

async function newLead(name = "Priya"): Promise<string> {
  return (
    await db.query("SELECT public.submit_marketing_lead($1,'priya@shop.example','Hello') AS id", [name])
  ).rows[0].id;
}

describe("Test BC1 — only OPS and SALES may triage", () => {
  it("lets OPS and SALES list applications", async () => {
    await newApplication();
    for (const staff of [ops, sales]) {
      const { rows } = await asUser(staff, () =>
        db.query("SELECT * FROM public.list_designer_applications(NULL)"),
      );
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("refuses every other role, staff or not", async () => {
    for (const who of [qc, finance, client, designer]) {
      await expect(
        asUser(who, () => db.query("SELECT * FROM public.list_designer_applications(NULL)")),
      ).rejects.toThrow(/only OPS or SALES/i);
      await expect(
        asUser(who, () => db.query("SELECT * FROM public.list_marketing_leads(NULL)")),
      ).rejects.toThrow(/only OPS or SALES/i);
    }
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(
      db.query("SELECT * FROM public.list_designer_applications(NULL)"),
    ).rejects.toThrow(/not authenticated|only OPS or SALES/i);
  });
});

describe("Test BC2 — reviewing an application", () => {
  it("records the decision, who made it, and when", async () => {
    const id = await newApplication();
    await asUser(ops, () =>
      db.query("SELECT public.review_designer_application($1,'ACCEPTED','strong portfolio')", [id]),
    );
    const { rows } = await db.query(
      "SELECT status, review_notes, reviewed_by, reviewed_at FROM designer_applications WHERE id=$1",
      [id],
    );
    expect(rows[0].status).toBe("ACCEPTED");
    expect(rows[0].review_notes).toBe("strong portfolio");
    expect(rows[0].reviewed_by).toBe(ops);
    expect(rows[0].reviewed_at).not.toBeNull();
  });

  it("accepting does NOT create a designer account", async () => {
    const before = (await db.query("SELECT count(*)::int AS n FROM users WHERE role='DESIGNER'")).rows[0].n;
    const id = await newApplication("Someone New");
    await asUser(sales, () => db.query("SELECT public.review_designer_application($1,'ACCEPTED')", [id]));
    const after = (await db.query("SELECT count(*)::int AS n FROM users WHERE role='DESIGNER'")).rows[0].n;
    expect(after).toBe(before); // an accepted application is a signal, not an account
    // ...and no profile was minted from the applicant's contact details.
    const prof = await db.query("SELECT count(*)::int AS n FROM designer_profiles WHERE email='dana@studio.example'");
    expect(prof.rows[0].n).toBe(0);
  });

  it("moving back to PENDING_REVIEW clears the reviewer stamp", async () => {
    const id = await newApplication();
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'REJECTED','not a fit')", [id]));
    await asUser(ops, () => db.query("SELECT public.review_designer_application($1,'PENDING_REVIEW')", [id]));
    const { rows } = await db.query(
      "SELECT status, reviewed_by, reviewed_at FROM designer_applications WHERE id=$1",
      [id],
    );
    expect(rows[0].status).toBe("PENDING_REVIEW");
    expect(rows[0].reviewed_by).toBeNull();
    expect(rows[0].reviewed_at).toBeNull();
  });

  it("rejects an invalid decision", async () => {
    const id = await newApplication();
    await expect(
      asUser(ops, () => db.query("SELECT public.review_designer_application($1,'MAYBE')", [id])),
    ).rejects.toThrow(/decision must be/i);
  });

  it("writes an audited APPLICATION_REVIEWED with the actor", async () => {
    const id = await newApplication();
    await asUser(sales, () => db.query("SELECT public.review_designer_application($1,'ACCEPTED')", [id]));
    const { rows } = await db.query(
      `SELECT actor_id, actor_role, payload FROM audit.audit_log
       WHERE action='APPLICATION_REVIEWED' AND entity_id=$1 ORDER BY seq DESC LIMIT 1`,
      [id],
    );
    expect(rows[0].actor_id).toBe(sales);
    expect(rows[0].actor_role).toBe("SALES");
    expect(rows[0].payload.to).toBe("ACCEPTED");
  });

  it("the pending queue sorts unreviewed first", async () => {
    const { rows } = await asUser(ops, () =>
      db.query("SELECT status FROM public.list_designer_applications(NULL)"),
    );
    const firstHandledIdx = rows.findIndex((r) => r.status !== "PENDING_REVIEW");
    const lastPendingIdx = rows.map((r) => r.status).lastIndexOf("PENDING_REVIEW");
    if (firstHandledIdx !== -1 && lastPendingIdx !== -1) {
      expect(lastPendingIdx).toBeLessThan(firstHandledIdx);
    }
  });

  it("filters by status", async () => {
    const { rows } = await asUser(ops, () =>
      db.query("SELECT status FROM public.list_designer_applications('ACCEPTED')"),
    );
    expect(rows.every((r) => r.status === "ACCEPTED")).toBe(true);
  });
});

describe("Test BC3 — working leads", () => {
  it("marks a lead handled, recording who and when", async () => {
    const id = await newLead();
    await asUser(sales, () => db.query("SELECT public.set_lead_status($1,'HANDLED')", [id]));
    const { rows } = await db.query(
      "SELECT status, handled_by, handled_at FROM marketing_leads WHERE id=$1",
      [id],
    );
    expect(rows[0].status).toBe("HANDLED");
    expect(rows[0].handled_by).toBe(sales);
    expect(rows[0].handled_at).not.toBeNull();
  });

  it("can be reopened, clearing the handled stamp", async () => {
    const id = await newLead();
    await asUser(ops, () => db.query("SELECT public.set_lead_status($1,'HANDLED')", [id]));
    await asUser(ops, () => db.query("SELECT public.set_lead_status($1,'NEW')", [id]));
    const { rows } = await db.query("SELECT status, handled_by FROM marketing_leads WHERE id=$1", [id]);
    expect(rows[0].status).toBe("NEW");
    expect(rows[0].handled_by).toBeNull();
  });

  it("a staff action on a lead is audited, though the public submit was not", async () => {
    const id = await newLead();
    await asUser(ops, () => db.query("SELECT public.set_lead_status($1,'HANDLED')", [id]));
    const { rows } = await db.query(
      `SELECT actor_id FROM audit.audit_log WHERE action='LEAD_STATUS_CHANGED' AND entity_id=$1`,
      [id],
    );
    expect(rows[0].actor_id).toBe(ops);
  });

  it("refuses a non-triage role", async () => {
    const id = await newLead();
    await expect(
      asUser(finance, () => db.query("SELECT public.set_lead_status($1,'HANDLED')", [id])),
    ).rejects.toThrow(/only OPS or SALES/i);
  });
});

describe("Test BC4 — the tables stay locked down", () => {
  it("the inbox tables remain unreadable by a direct select, even for OPS", async () => {
    // Stronger than RLS-returns-zero: these tables carry NO grants at all
    // (0017/0018), so a direct read is a hard permission-denied. Access is only
    // ever through the SECURITY DEFINER functions, and this slice left that so.
    await expect(
      asUser(ops, () => db.query("SELECT * FROM designer_applications")),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(ops, () => db.query("SELECT * FROM marketing_leads")),
    ).rejects.toThrow(/permission denied/i);
  });
});
