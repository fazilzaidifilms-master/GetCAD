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

function check(bucket: string, max = 3, windowSeconds = 3600) {
  return asAnon(async () => {
    const r = await db.query(
      "SELECT public.check_rate_limit(p_bucket=>$1, p_max_hits=>$2, p_window_seconds=>$3) AS allowed",
      [bucket, max, windowSeconds],
    );
    return r.rows[0].allowed as boolean;
  });
}

describe("Test AQ4 — public form rate limiting", () => {
  it("allows up to the limit, then blocks", async () => {
    expect(await check("contact:aaa", 3)).toBe(true);
    expect(await check("contact:aaa", 3)).toBe(true);
    expect(await check("contact:aaa", 3)).toBe(true);
    expect(await check("contact:aaa", 3)).toBe(false);
    expect(await check("contact:aaa", 3)).toBe(false);
  });

  it("tracks buckets independently, so one visitor cannot block another", async () => {
    expect(await check("contact:bbb", 1)).toBe(true);
    expect(await check("contact:bbb", 1)).toBe(false);
    // A different fingerprint is unaffected.
    expect(await check("contact:ccc", 1)).toBe(true);
    // As is the same fingerprint on a different form.
    expect(await check("designer-application:bbb", 1)).toBe(true);
  });

  it("does not record hits once blocked (an attacker cannot inflate the table)", async () => {
    await check("contact:ddd", 1);
    for (let i = 0; i < 5; i += 1) await check("contact:ddd", 1);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM rate_limit_events WHERE bucket = 'contact:ddd'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("forgets hits that have aged out of the window", async () => {
    expect(await check("contact:eee", 1, 3600)).toBe(true);
    expect(await check("contact:eee", 1, 3600)).toBe(false);
    // Age the recorded hit past the window.
    await db.query(
      "UPDATE rate_limit_events SET hit_at = now() - interval '2 hours' WHERE bucket = 'contact:eee'",
    );
    expect(await check("contact:eee", 1, 3600)).toBe(true);
  });

  it("rejects nonsensical arguments", async () => {
    await expect(check("", 3)).rejects.toThrow(/bucket is required/i);
    await expect(check("contact:fff", 0)).rejects.toThrow(/max_hits/i);
    await expect(check("contact:fff", 3, 0)).rejects.toThrow(/window_seconds/i);
  });

  it("anon cannot read or write the limiter table directly", async () => {
    await expect(asAnon(() => db.query("SELECT * FROM rate_limit_events"))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asAnon(() => db.query("INSERT INTO rate_limit_events (bucket) VALUES ('x')")),
    ).rejects.toThrow(/permission denied/i);
  });
});
