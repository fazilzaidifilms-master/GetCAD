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

const BASE_ARGS = {
  p_id: "app_test_1",
  p_full_name: "Jane Designer",
  p_email: "jane@example.com",
  p_phone: "+1 555 0100",
  p_country: "India",
  p_years_experience: 5,
  p_primary_software: "RHINO",
  p_categories: ["RINGS", "PENDANTS"],
};

function submit(args: Record<string, unknown>) {
  return asAnon(() =>
    db.query(
      `SELECT public.submit_designer_application(
        p_id=>$1, p_full_name=>$2, p_email=>$3, p_phone=>$4, p_country=>$5,
        p_years_experience=>$6, p_primary_software=>$7, p_categories=>$8,
        p_portfolio_url=>$9, p_portfolio_file_keys=>$10
      ) AS id`,
      [
        args.p_id,
        args.p_full_name,
        args.p_email,
        args.p_phone,
        args.p_country,
        args.p_years_experience,
        args.p_primary_software,
        args.p_categories,
        args.p_portfolio_url ?? null,
        args.p_portfolio_file_keys ?? null,
      ],
    ),
  );
}

describe("Test AP — designer application (Stage 1, public lead form)", () => {
  it("a visitor can submit a valid application with a portfolio URL", async () => {
    const res = await submit({
      ...BASE_ARGS,
      p_id: "app_url_1",
      p_portfolio_url: "https://portfolio.example.com/jane",
    });
    expect(res.rows[0].id).toBe("app_url_1");

    const row = await db.query(
      "SELECT full_name, email, phone, country, years_experience, primary_software, categories, portfolio_url, portfolio_file_keys, status FROM designer_applications WHERE id=$1",
      ["app_url_1"],
    );
    expect(row.rows[0]).toEqual({
      full_name: "Jane Designer",
      email: "jane@example.com",
      phone: "+1 555 0100",
      country: "India",
      years_experience: 5,
      primary_software: "RHINO",
      categories: ["RINGS", "PENDANTS"],
      portfolio_url: "https://portfolio.example.com/jane",
      portfolio_file_keys: null,
      status: "PENDING_REVIEW",
    });
  });

  it("a visitor can submit a valid application with 2-3 portfolio file keys instead of a URL", async () => {
    const res = await submit({
      ...BASE_ARGS,
      p_id: "app_files_1",
      p_portfolio_file_keys: ["app_files_1/abc.png", "app_files_1/def.pdf"],
    });
    expect(res.rows[0].id).toBe("app_files_1");
    const row = await db.query(
      "SELECT portfolio_url, portfolio_file_keys FROM designer_applications WHERE id=$1",
      ["app_files_1"],
    );
    expect(row.rows[0]).toEqual({
      portfolio_url: null,
      portfolio_file_keys: ["app_files_1/abc.png", "app_files_1/def.pdf"],
    });
  });

  it("rejects when neither a portfolio URL nor files are provided", async () => {
    await expect(submit({ ...BASE_ARGS, p_id: "app_bad_1" })).rejects.toThrow(
      /provide either a portfolio url or portfolio files/i,
    );
  });

  it("rejects when both a portfolio URL and files are provided", async () => {
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_2",
        p_portfolio_url: "https://example.com/x",
        p_portfolio_file_keys: ["a/one.png", "a/two.png"],
      }),
    ).rejects.toThrow(/not both/i);
  });

  it("rejects fewer than 2 or more than 3 portfolio file keys", async () => {
    await expect(
      submit({ ...BASE_ARGS, p_id: "app_bad_3", p_portfolio_file_keys: ["only-one.png"] }),
    ).rejects.toThrow(/between 2 and 3/i);
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_4",
        p_portfolio_file_keys: ["1.png", "2.png", "3.png", "4.png"],
      }),
    ).rejects.toThrow(/between 2 and 3/i);
  });

  it("rejects an invalid email", async () => {
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_5",
        p_email: "not-an-email",
        p_portfolio_url: "https://example.com/x",
      }),
    ).rejects.toThrow(/valid email/i);
  });

  it("rejects an invalid primary software", async () => {
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_6",
        p_primary_software: "ZBRUSH",
        p_portfolio_url: "https://example.com/x",
      }),
    ).rejects.toThrow(/invalid primary software/i);
  });

  it("rejects an empty categories array", async () => {
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_7",
        p_categories: [],
        p_portfolio_url: "https://example.com/x",
      }),
    ).rejects.toThrow(/select at least one jewelry category/i);
  });

  it("rejects an invalid category", async () => {
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_8",
        p_categories: ["RINGS", "WATCHES"],
        p_portfolio_url: "https://example.com/x",
      }),
    ).rejects.toThrow(/invalid jewelry category/i);
  });

  it("rejects years of experience out of range", async () => {
    await expect(
      submit({
        ...BASE_ARGS,
        p_id: "app_bad_9",
        p_years_experience: -1,
        p_portfolio_url: "https://example.com/x",
      }),
    ).rejects.toThrow(/years of experience must be between 0 and 60/i);
  });

  it("anon cannot read or write applications directly (the function is the only path)", async () => {
    await expect(asAnon(() => db.query("SELECT * FROM designer_applications"))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asAnon(() =>
        db.query(
          "INSERT INTO designer_applications (full_name, email, phone, country, years_experience, primary_software, categories, portfolio_url) VALUES ('x','a@b.com','+1','US',1,'RHINO','{RINGS}','https://x.com')",
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("an authenticated visitor can also submit", async () => {
    await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: "some_user", role: "authenticated" }),
    ]);
    await db.query("SET ROLE authenticated");
    try {
      const res = await db.query(
        `SELECT public.submit_designer_application(
          p_id=>$1, p_full_name=>$2, p_email=>$3, p_phone=>$4, p_country=>$5,
          p_years_experience=>$6, p_primary_software=>$7, p_categories=>$8, p_portfolio_url=>$9
        ) AS id`,
        [
          "app_auth_1",
          "Signed In Visitor",
          "signedin@example.com",
          "+1 555 0101",
          "United States",
          3,
          "MATRIX",
          ["EARRINGS"],
          "https://example.com/signedin",
        ],
      );
      expect(res.rows[0].id).toBe("app_auth_1");
    } finally {
      await db.query("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claims', '', false)");
    }
  });

  it("writes an audited APPLICATION_SUBMITTED entry without breaking the hash chain", async () => {
    const entry = await db.query(
      "SELECT action, entity_type, entity_id, actor_id, actor_role FROM audit.audit_log WHERE entity_type='designer_application' AND entity_id='app_url_1'",
    );
    expect(entry.rows[0]).toEqual({
      action: "APPLICATION_SUBMITTED",
      entity_type: "designer_application",
      entity_id: "app_url_1",
      actor_id: null,
      actor_role: null,
    });

    const chain = await db.query("SELECT audit.verify_chain() AS result");
    expect(chain.rows[0].result.valid).toBe(true);
  });
});
