import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const client = generateId();
const sales = generateId();
const ops = generateId();
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

async function notifsFor(userId: string): Promise<{ kind: string; summary: string }[]> {
  const { rows } = await db.query(
    "SELECT kind, summary FROM notifications WHERE user_id=$1 ORDER BY created_at",
    [userId],
  );
  return rows;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'),($2,'SALES','ACTIVE'),($3,'OPS','ACTIVE'),($4,'DESIGNER','ACTIVE')`,
    [client, sales, ops, designer],
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

  // Walk an order: create -> submit -> quote -> hold -> assign -> in progress.
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
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test AA — notifications (generated from the audit log)", () => {
  it("quote notified the client; assignment notified the designer", async () => {
    const c = await notifsFor(client);
    const d = await notifsFor(designer);
    expect(c.map((n) => n.kind)).toContain("QUOTED");
    expect(d.map((n) => n.kind)).toContain("ASSIGNED");
  });

  it("a message notifies the OTHER party, not the sender", async () => {
    await asUser(client, () => db.query("SELECT public.post_message($1,$2)", [order, "hello"]));
    // designer (the other party) is notified; the client (sender) is not.
    const d = (await notifsFor(designer)).filter((n) => n.kind === "MESSAGE");
    const c = (await notifsFor(client)).filter((n) => n.kind === "MESSAGE");
    expect(d).toHaveLength(1);
    expect(c).toHaveLength(0);

    // and the reverse direction
    await asUser(designer, () => db.query("SELECT public.post_message($1,$2)", [order, "hi back"]));
    expect((await notifsFor(client)).filter((n) => n.kind === "MESSAGE")).toHaveLength(1);
  });

  it("notification text is identity-free (no names/emails)", async () => {
    const all = await db.query("SELECT summary FROM notifications");
    for (const r of all.rows) {
      expect(r.summary).not.toMatch(/dana|@|studio\.example/i);
    }
  });

  it("a user reads ONLY their own notifications (RLS)", async () => {
    const seenByDesigner = await asUser(designer, () =>
      db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE user_id<>$1)::int AS others FROM notifications", [
        designer,
      ]),
    );
    expect(seenByDesigner.rows[0].others).toBe(0); // never sees anyone else's
    expect(seenByDesigner.rows[0].n).toBeGreaterThan(0);
  });

  it("marking read clears the unread ones for the caller only", async () => {
    const before = await asUser(client, () =>
      db.query("SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL"),
    );
    expect(before.rows[0].n).toBeGreaterThan(0);

    const marked = await asUser(client, () => db.query("SELECT public.mark_notifications_read() AS n"));
    expect(marked.rows[0].n).toBeGreaterThan(0);

    const after = await asUser(client, () =>
      db.query("SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL"),
    );
    expect(after.rows[0].n).toBe(0); // the client's are all read now

    // the designer's notifications are untouched
    const dUnread = await asUser(designer, () =>
      db.query("SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL"),
    );
    expect(dUnread.rows[0].n).toBeGreaterThan(0);
  });

  it("the audit chain stays valid despite the fan-out trigger", async () => {
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
