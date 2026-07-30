import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

/**
 * Test BB — the email outbox.
 *
 * An email is OWED the moment a public action succeeds, in the same transaction
 * as the work it acknowledges, and drained separately. The properties worth
 * pinning: the acknowledgement is enqueued transactionally, enqueuing is
 * best-effort (never breaks the action), the queue is claimed without
 * double-handing, results are idempotent, and no client role can read the
 * queue of addresses.
 */
let db: Client;

beforeAll(async () => {
  db = await connectFreshDb();
});
afterAll(async () => {
  if (db) await db.end();
});

const outbox = async (key: string) =>
  (await db.query("SELECT * FROM email_outbox WHERE idempotency_key=$1", [key])).rows[0];

async function anon<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("SET ROLE anon");
  try {
    return await fn();
  } finally {
    await db.query("RESET ROLE");
  }
}

describe("Test BB1 — the public actions enqueue an acknowledgement", () => {
  it("a designer application enqueues one email to the applicant, in the same call", async () => {
    const id = generateId();
    await db.query(
      `SELECT public.submit_designer_application(
         $1,'Dana Designer','dana@studio.example','+1 555 0100','India',5,'RHINO',
         ARRAY['RINGS']::text[], 'https://folio.example/dana', NULL)`,
      [id],
    );
    const row = await outbox(`email:application:${id}`);
    expect(row.template).toBe("DESIGNER_APPLICATION_RECEIVED");
    expect(row.recipient_email).toBe("dana@studio.example");
    expect(row.status).toBe("PENDING");
    // Payload carries only the applicant's own name — no counterparty exists.
    expect(row.payload).toEqual({ full_name: "Dana Designer" });
  });

  it("a contact submission enqueues one email to the sender", async () => {
    const leadId = (
      await db.query("SELECT public.submit_marketing_lead('Priya','priya@shop.example','Hello') AS id")
    ).rows[0].id;
    const row = await outbox(`email:contact:${leadId}`);
    expect(row.template).toBe("CONTACT_RECEIVED");
    expect(row.recipient_email).toBe("priya@shop.example");
    expect(row.payload).toEqual({ name: "Priya" });
  });

  it("re-running the same application does not enqueue a second email", async () => {
    const id = generateId();
    const submit = () =>
      db.query(
        `SELECT public.submit_designer_application(
           $1,'Dup','dup@studio.example','+1 555 0101','India',3,'MATRIX',
           ARRAY['RINGS']::text[], 'https://folio.example/dup', NULL)`,
        [id],
      );
    await submit();
    // A second call with the same id fails on the primary key — but even if the
    // key were reused, ON CONFLICT keeps the outbox at one row.
    await submit().catch(() => undefined);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM email_outbox WHERE idempotency_key=$1", [
      `email:application:${id}`,
    ]);
    expect(rows[0].n).toBe(1);
  });
});

describe("Test BB2 — enqueuing is best-effort", () => {
  it("a bad recipient is skipped, and never breaks the enqueue call", async () => {
    await db.query("SELECT app.enqueue_email('CONTACT_RECEIVED','not-an-email','{}'::jsonb,'k:bad')");
    expect(await outbox("k:bad")).toBeUndefined(); // nothing written, no error thrown
  });

  it("stores exactly what it was given for a good address", async () => {
    await db.query(
      "SELECT app.enqueue_email('CONTACT_RECEIVED','ok@example.com',$1::jsonb,'k:ok')",
      [JSON.stringify({ name: "Sam" })],
    );
    const row = await outbox("k:ok");
    expect(row.recipient_email).toBe("ok@example.com");
    expect(row.payload).toEqual({ name: "Sam" });
  });
});

describe("Test BB3 — claiming and recording", () => {
  async function queued(key: string): Promise<void> {
    await db.query("SELECT app.enqueue_email('CONTACT_RECEIVED','q@example.com',$1::jsonb,$2)", [
      JSON.stringify({ name: "Q" }),
      key,
    ]);
  }

  it("claim flips PENDING to SENDING and counts the attempt", async () => {
    const key = `k:claim:${generateId()}`;
    await queued(key);
    const { rows } = await db.query("SELECT * FROM public.claim_emails(100)");
    const mine = rows.find((r) => r.idempotency_key === key);
    expect(mine.status).toBe("SENDING");
    expect(mine.attempts).toBe(1);
  });

  it("does not hand the same row to a second claim", async () => {
    const key = `k:once:${generateId()}`;
    await queued(key);
    await db.query("SELECT * FROM public.claim_emails(100)");
    const { rows } = await db.query("SELECT * FROM public.claim_emails(100)");
    expect(rows.some((r) => r.idempotency_key === key)).toBe(false);
  });

  it("records SENT with the provider reference, and is idempotent on redelivery", async () => {
    const key = `k:sent:${generateId()}`;
    await queued(key);
    await db.query("SELECT * FROM public.claim_emails(100)");
    const first = await db.query("SELECT public.record_email_result($1,'SENT','msg_1') AS r", [key]);
    expect(first.rows[0].r.applied).toBe(true);
    const again = await db.query("SELECT public.record_email_result($1,'SENT','msg_1') AS r", [key]);
    expect(again.rows[0].r.applied).toBe(false);

    const row = await outbox(key);
    expect(row.status).toBe("SENT");
    expect(row.provider_message_ref).toBe("msg_1");
    expect(row.sent_at).not.toBeNull();
  });

  it("REFUSES a sent result with no provider reference", async () => {
    const key = `k:noref:${generateId()}`;
    await queued(key);
    await db.query("SELECT * FROM public.claim_emails(100)");
    await expect(db.query("SELECT public.record_email_result($1,'SENT')", [key])).rejects.toThrow(
      /must record the provider reference/i,
    );
  });

  it("a FAILED row must say why, and is claimed again for retry", async () => {
    const key = `k:fail:${generateId()}`;
    await queued(key);
    await db.query("SELECT * FROM public.claim_emails(100)");
    await expect(db.query("SELECT public.record_email_result($1,'FAILED')", [key])).rejects.toThrow(
      /must record why/i,
    );

    await db.query(
      "SELECT public.record_email_result($1,'FAILED', p_failure_reason => 'provider 500')",
      [key],
    );
    expect((await outbox(key)).status).toBe("FAILED");

    const reclaimed = await db.query("SELECT * FROM public.claim_emails(100)");
    const again = reclaimed.rows.find((r) => r.idempotency_key === key);
    expect(again.status).toBe("SENDING");
    expect(again.attempts).toBe(2);
  });

  it("rejects a nonsense batch size", async () => {
    await expect(db.query("SELECT * FROM public.claim_emails(0)")).rejects.toThrow(/between 1 and 100/i);
    await expect(db.query("SELECT * FROM public.claim_emails(101)")).rejects.toThrow(/between 1 and 100/i);
  });
});

describe("Test BB4 — the queue is locked down", () => {
  it("claim and record are server-to-server only", async () => {
    await anon(async () => {
      await expect(db.query("SELECT * FROM public.claim_emails(1)")).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT public.record_email_result('x','SENT','y')"),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("no client role can read the queue of addresses", async () => {
    await db.query("SELECT app.enqueue_email('CONTACT_RECEIVED','secret@example.com','{}'::jsonb,'k:rls')");
    const { rows } = await anon(() => db.query("SELECT * FROM email_outbox"));
    expect(rows).toHaveLength(0);
  });

  it("has RLS enabled and FORCED, with zero allow policies", async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname='public' AND p.tablename='email_outbox') AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='email_outbox'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
    expect(rows[0].policies).toBe(0);
  });

  it("grants no direct write path to any client role", async () => {
    const { rows } = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='email_outbox'
         AND grantee IN ('anon','authenticated')`,
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(["SELECT", "SELECT"]);
  });
});
