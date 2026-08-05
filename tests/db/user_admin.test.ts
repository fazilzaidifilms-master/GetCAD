import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const ops = generateId();
const ops2 = generateId();
const sales = generateId();
const qc = generateId();
const client = generateId();
const designer = generateId();

async function asUser<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub })]);
  await db.query("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await db.query("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
  }
}

const setRole = (actor: string, target: string, role: string) =>
  asUser(actor, () => db.query("SELECT public.set_user_role($1,$2) AS r", [target, role]));

const setStatus = (actor: string, target: string, status: string) =>
  asUser(actor, () => db.query("SELECT public.set_user_status($1,$2) AS r", [target, status]));

async function roleOf(id: string): Promise<string> {
  const { rows } = await db.query("SELECT role FROM users WHERE id = $1", [id]);
  return rows[0].role as string;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'OPS','ACTIVE'), ($2,'SALES','ACTIVE'), ($3,'QC','ACTIVE'),
       ($4,'CLIENT','ACTIVE'), ($5,'DESIGNER','ACTIVE')`,
    [ops, sales, qc, client, designer],
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("who may administer accounts", () => {
  it("lets OPS list everyone", async () => {
    const { rows } = await asUser(ops, () =>
      db.query("SELECT * FROM public.list_platform_users()"),
    );
    expect(rows.length).toBe(5);
    expect(rows[0]).toHaveProperty("orders_as_client");
  });

  // Not "staff". SALES, QC and FINANCE are roles you can be GIVEN, and a role
  // that can grant itself a promotion is not a permission boundary.
  it("refuses every other staff role", async () => {
    for (const actor of [sales, qc]) {
      await expect(
        asUser(actor, () => db.query("SELECT * FROM public.list_platform_users()")),
      ).rejects.toThrow(/only OPS/i);
      await expect(setRole(actor, client, "OPS")).rejects.toThrow(/only OPS/i);
    }
  });

  it("refuses a client and a designer outright", async () => {
    await expect(setRole(client, client, "OPS")).rejects.toThrow(/only OPS/i);
    await expect(setRole(designer, designer, "QC")).rejects.toThrow(/only OPS/i);
  });

  it("refuses an anonymous caller", async () => {
    await expect(
      db.query("SELECT public.set_user_role($1,'OPS')", [client]),
    ).rejects.toThrow(/not authenticated|only OPS/i);
  });
});

describe("changing a role", () => {
  it("promotes and demotes", async () => {
    await setRole(ops, designer, "QC");
    expect(await roleOf(designer)).toBe("QC");
    await setRole(ops, designer, "DESIGNER");
    expect(await roleOf(designer)).toBe("DESIGNER");
  });

  it("is a no-op when the role already matches", async () => {
    const { rows } = await setRole(ops, client, "CLIENT");
    expect(rows[0].r.changed).toBe(false);
  });

  it("rejects a role the enum does not have", async () => {
    await expect(setRole(ops, client, "SUPER_ADMIN")).rejects.toThrow(/unknown role/i);
    await expect(setRole(ops, client, "ops")).rejects.toThrow(/unknown role/i);
  });

  it("rejects a user that does not exist", async () => {
    await expect(setRole(ops, generateId(), "OPS")).rejects.toThrow(/no such user/i);
  });

  // The one that turns a mistake into a support ticket with Supabase. Demoting
  // the last OPS leaves a platform nobody can administer from inside the app.
  it("will not demote the last active OPS", async () => {
    await expect(setRole(ops, ops, "CLIENT")).rejects.toThrow(/last active OPS/i);
    expect(await roleOf(ops)).toBe("OPS");
  });

  it("will not suspend the last active OPS either", async () => {
    await expect(setStatus(ops, ops, "SUSPENDED")).rejects.toThrow(/last active OPS/i);
  });

  it("allows the demotion once someone else can take over", async () => {
    await db.query("INSERT INTO users (id, role, status) VALUES ($1,'OPS','ACTIVE')", [ops2]);
    await setRole(ops, ops, "CLIENT");
    expect(await roleOf(ops)).toBe("CLIENT");
    // ...and now ops2 is the last one, so the guard moves with it.
    await expect(setRole(ops2, ops2, "SALES")).rejects.toThrow(/last active OPS/i);
  });

  // A second OPS who is SUSPENDED is not a way back in, so it must not count.
  it("does not count a suspended OPS as cover", async () => {
    const spare = generateId();
    await db.query("INSERT INTO users (id, role, status) VALUES ($1,'OPS','SUSPENDED')", [spare]);
    await expect(setRole(ops2, ops2, "CLIENT")).rejects.toThrow(/last active OPS/i);
    await db.query("DELETE FROM users WHERE id = $1", [spare]);
  });
});

describe("changing a status", () => {
  it("suspends and reinstates", async () => {
    await setStatus(ops2, designer, "SUSPENDED");
    const { rows } = await db.query("SELECT status FROM users WHERE id = $1", [designer]);
    expect(rows[0].status).toBe("SUSPENDED");
    await setStatus(ops2, designer, "ACTIVE");
  });

  it("rejects a status the enum does not have", async () => {
    await expect(setStatus(ops2, designer, "DELETED")).rejects.toThrow(/unknown status/i);
  });
});

describe("the record", () => {
  // Granting privilege is precisely what a log exists to answer "who did that"
  // about, so unlike the anonymity-preserving events elsewhere the actor is
  // recorded here.
  it("writes who changed what", async () => {
    const { rows } = await db.query(
      `SELECT action, actor_id, payload FROM audit.audit_log
        WHERE action IN ('USER_ROLE_CHANGED','USER_STATUS_CHANGED')
        ORDER BY id`,
    );
    expect(rows.length).toBeGreaterThan(3);
    const roleChange = rows.find((r) => r.action === "USER_ROLE_CHANGED");
    expect(roleChange.actor_id).toBeTruthy();
    expect(roleChange.payload).toHaveProperty("from");
    expect(roleChange.payload).toHaveProperty("to");
  });

  it("keeps the audit chain valid", async () => {
    const { rows } = await db.query("SELECT audit.verify_chain() AS v");
    expect(rows[0].v.valid).toBe(true);
  });
});

describe("the listing", () => {
  it("filters by role", async () => {
    const { rows } = await asUser(ops2, () =>
      db.query("SELECT * FROM public.list_platform_users(NULL,'DESIGNER')"),
    );
    expect(rows.every((r) => r.role === "DESIGNER")).toBe(true);
  });

  it("rejects a role filter the enum does not have", async () => {
    await expect(
      asUser(ops2, () => db.query("SELECT * FROM public.list_platform_users(NULL,'NOPE')")),
    ).rejects.toThrow(/unknown role filter/i);
  });

  it("searches by account reference", async () => {
    const { rows } = await asUser(ops2, () =>
      db.query("SELECT * FROM public.list_platform_users($1)", [client.slice(0, 8)]),
    );
    expect(rows.map((r) => r.id)).toContain(client);
  });
});
