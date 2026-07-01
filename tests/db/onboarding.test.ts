import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const alice = generateId();

// Run as the `authenticated` role with a Clerk identity, and COMMIT (no
// rollback) so onboarding persists across calls. Resets role + claims after.
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

beforeAll(async () => {
  db = await connectFreshDb();
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test L — audited self-onboarding", () => {
  it("first call creates the user row AND one USER_CREATED audit entry", async () => {
    const res = await asUser(alice, () => db.query("SELECT public.ensure_self() AS v"));
    expect(res.rows[0].v.created).toBe(true);
    expect(res.rows[0].v.user_id).toBe(alice);

    const u = await db.query("SELECT id, role, status FROM users WHERE id = $1", [alice]);
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0].role).toBe("CLIENT");
    expect(u.rows[0].status).toBe("ACTIVE");

    const a = await db.query(
      "SELECT action, actor_id, entity_id, entity_type FROM audit.audit_log WHERE entity_id = $1",
      [alice],
    );
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].action).toBe("USER_CREATED");
    expect(a.rows[0].actor_id).toBe(alice);
    expect(a.rows[0].entity_type).toBe("user");
  });

  it("second call is idempotent — no duplicate row, no duplicate audit entry", async () => {
    const res = await asUser(alice, () => db.query("SELECT public.ensure_self() AS v"));
    expect(res.rows[0].v.created).toBe(false);

    const u = await db.query("SELECT count(*)::int AS n FROM users WHERE id = $1", [alice]);
    expect(u.rows[0].n).toBe(1);
    const a = await db.query(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE entity_id = $1",
      [alice],
    );
    expect(a.rows[0].n).toBe(1);
  });

  it("the audit chain remains valid after onboarding", async () => {
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });

  it("identity comes from the token — the user onboards only themselves", async () => {
    const bob = generateId();
    const res = await asUser(bob, () => db.query("SELECT public.ensure_self() AS v"));
    expect(res.rows[0].v.user_id).toBe(bob); // their own JWT sub, not alice's

    // and RLS then lets them read exactly their own row
    const rows = await asUser(bob, async () => {
      const r = await db.query("SELECT id FROM users");
      return r.rows.map((x) => x.id);
    });
    expect(rows).toEqual([bob]);
  });

  it("an unauthenticated request cannot onboard", async () => {
    await db.query("BEGIN");
    try {
      await db.query("SELECT set_config('request.jwt.claims', '', true)");
      await db.query("SET LOCAL ROLE authenticated");
      await expect(db.query("SELECT public.ensure_self()")).rejects.toThrow(/not authenticated/i);
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
