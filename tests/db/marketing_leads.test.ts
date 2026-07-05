import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectFreshDb } from "../helpers/db";

let db: Client;

beforeAll(async () => {
  db = await connectFreshDb();
});
afterAll(async () => {
  if (db) await db.end();
});

async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("SET ROLE anon");
  try {
    return await fn();
  } finally {
    await db.query("RESET ROLE");
  }
}

describe("Test AN — marketing lead capture (public contact form)", () => {
  it("an anonymous visitor can submit a valid lead", async () => {
    const res = await asAnon(() =>
      db.query(
        "SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3, p_company=>$4, p_role=>$5) AS id",
        ["Jane Doe", "jane@example.com", "Interested in a pilot.", "Acme Jewelry", "BUSINESS"],
      ),
    );
    expect(res.rows[0].id).toBeTruthy();

    const row = await db.query("SELECT name, company, email, role, message FROM marketing_leads WHERE id=$1", [
      res.rows[0].id,
    ]);
    expect(row.rows[0]).toEqual({
      name: "Jane Doe",
      company: "Acme Jewelry",
      email: "jane@example.com",
      role: "BUSINESS",
      message: "Interested in a pilot.",
    });
  });

  it("company is optional and defaults to null; role defaults to BUSINESS", async () => {
    const res = await asAnon(() =>
      db.query(
        "SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3) AS id",
        ["No Company", "nocompany@example.com", "hello"],
      ),
    );
    const row = await db.query("SELECT company, role FROM marketing_leads WHERE id=$1", [res.rows[0].id]);
    expect(row.rows[0]).toEqual({ company: null, role: "BUSINESS" });
  });

  it("rejects an invalid email", async () => {
    await expect(
      asAnon(() =>
        db.query("SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3)", [
          "Jane",
          "not-an-email",
          "hi",
        ]),
      ),
    ).rejects.toThrow(/valid email/i);
  });

  it("rejects an empty name or message", async () => {
    await expect(
      asAnon(() =>
        db.query("SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3)", [
          "",
          "jane@example.com",
          "hi",
        ]),
      ),
    ).rejects.toThrow(/name is required/i);
    await expect(
      asAnon(() =>
        db.query("SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3)", [
          "Jane",
          "jane@example.com",
          "",
        ]),
      ),
    ).rejects.toThrow(/message is required/i);
  });

  it("rejects an invalid role", async () => {
    await expect(
      asAnon(() =>
        db.query(
          "SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3, p_role=>$4)",
          ["Jane", "jane@example.com", "hi", "HACKER"],
        ),
      ),
    ).rejects.toThrow(/invalid role/i);
  });

  it("anon cannot read or write leads directly (default-deny — the function is the only path)", async () => {
    // No grant of any kind was given on the table, so both are rejected at the
    // grant level — even stronger than an RLS-empty-result.
    await expect(asAnon(() => db.query("SELECT * FROM marketing_leads"))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asAnon(() =>
        db.query("INSERT INTO marketing_leads (name, email, message) VALUES ('x','a@b.com','hi')"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("an authenticated visitor can also submit (e.g. a signed-in user browsing marketing pages)", async () => {
    await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: "some_user", role: "authenticated" }),
    ]);
    await db.query("SET ROLE authenticated");
    try {
      const res = await db.query(
        "SELECT public.submit_marketing_lead(p_name=>$1, p_email=>$2, p_message=>$3, p_role=>$4) AS id",
        ["A Designer", "designer@example.com", "I'd like to apply.", "DESIGNER"],
      );
      expect(res.rows[0].id).toBeTruthy();
    } finally {
      await db.query("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claims', '', false)");
    }
  });
});
