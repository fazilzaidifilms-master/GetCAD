import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

beforeAll(async () => {
  db = await connectFreshDb();
});
afterAll(async () => {
  if (db) await db.end();
});

describe("Test AE — security invariants (hardening)", () => {
  it("every public table has RLS ENABLED and FORCED", async () => {
    const { rows } = await db.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
    `);
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity);
    expect(bad.map((r) => r.relname)).toEqual([]);
  });

  it("no public table grants INSERT/UPDATE/DELETE to anon or authenticated (writes go through functions)", async () => {
    const { rows } = await db.query(`
      SELECT table_name, privilege_type, grantee
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      ORDER BY 1, 2, 3
    `);
    expect(rows).toEqual([]);
  });

  it("every SECURITY DEFINER function sets search_path = ''", async () => {
    const { rows } = await db.query(`
      SELECT n.nspname AS schema, p.proname AS func, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'app', 'audit') AND p.prosecdef
    `);
    expect(rows.length).toBeGreaterThan(0);
    const missing = rows.filter(
      (r) => !(r.proconfig ?? []).some((c: string) => c === 'search_path=""' || c === "search_path="),
    );
    expect(missing.map((r) => `${r.schema}.${r.func}`)).toEqual([]);
  });

  it("no public table has a direct INSERT/UPDATE/DELETE policy (writes are function-only)", async () => {
    const { rows } = await db.query(`
      SELECT tablename, cmd FROM pg_policies
      WHERE schemaname = 'public' AND cmd <> 'SELECT'
    `);
    expect(rows).toEqual([]);
  });

  it("double-blind still holds: a client cannot read the designer's identity (and vice versa)", async () => {
    const client = generateId();
    const designer = generateId();
    await db.query(
      `INSERT INTO users (id, role, status) VALUES ($1,'CLIENT','ACTIVE'),($2,'DESIGNER','ACTIVE')`,
      [client, designer],
    );
    await db.query(
      `INSERT INTO designer_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Dana','dana@x.example')`,
      [generateId(), designer],
    );
    await db.query(`INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Cara','cara@x.example')`, [
      generateId(),
      client,
    ]);

    async function asUser(sub: string, sql: string): Promise<number> {
      await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub })]);
      await db.query("SET ROLE authenticated");
      try {
        const { rows } = await db.query(sql);
        return rows.length;
      } finally {
        await db.query("RESET ROLE");
        await db.query("SELECT set_config('request.jwt.claims', '', false)");
      }
    }

    // client cannot see the designer's identity row
    expect(await asUser(client, `SELECT * FROM designer_profiles WHERE user_id='${designer}'`)).toBe(0);
    // designer cannot see the client's identity row
    expect(await asUser(designer, `SELECT * FROM client_profiles WHERE user_id='${client}'`)).toBe(0);
    // each CAN see their own
    expect(await asUser(designer, `SELECT * FROM designer_profiles WHERE user_id='${designer}'`)).toBe(1);
  });

  it("writes still succeed through the SECURITY DEFINER functions after the revoke", async () => {
    const client = generateId();
    await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: client })]);
    await db.query("SET ROLE authenticated");
    try {
      // ensure_self + create_order both write base tables via definer funcs
      await db.query("SELECT public.ensure_self()");
      const id = generateId();
      await db.query("SELECT public.create_order($1,'CAD_MODEL','USD')", [id]);
      const { rows } = await db.query("SELECT status FROM orders WHERE id=$1", [id]);
      expect(rows[0].status).toBe("DRAFT");
    } finally {
      await db.query("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claims', '', false)");
    }
  });
});
