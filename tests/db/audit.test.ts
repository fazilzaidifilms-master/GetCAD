import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectFreshDb } from "../helpers/db";

let db: Client;

// Append three representative events: a state change, another state change, and
// an identity-piercing read.
async function seedEvents(): Promise<void> {
  await db.query("SELECT audit.log_event('USER_CREATED', 'user', $1, $1, 'CLIENT')", ["u_alice"]);
  await db.query(
    "SELECT audit.log_event('ORDER_STATUS_CHANGED', 'order', $1, $2, 'OPS', $3::jsonb)",
    ["o_1", "u_ops", JSON.stringify({ from: "DRAFT", to: "SUBMITTED" })],
  );
  await db.query(
    "SELECT audit.log_event('IDENTITY_READ', 'client_profile', $1, $2, 'FINANCE', '{}'::jsonb, true)",
    ["cp_1", "u_fin"],
  );
}

async function verify(): Promise<{ valid: boolean; broken_at?: number; entries?: number }> {
  const { rows } = await db.query("SELECT audit.verify_chain() AS v");
  return rows[0].v;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await seedEvents();
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test J — tamper-evident hash chain", () => {
  it("verify_chain() is valid after appending events", async () => {
    const v = await verify();
    expect(v.valid).toBe(true);
    expect(v.entries).toBe(3);
  });

  it("each entry is chained to the previous by hash", async () => {
    const { rows } = await db.query(
      "SELECT seq, prev_hash, hash FROM audit.audit_log ORDER BY seq",
    );
    expect(rows[0].prev_hash).toBeNull(); // genesis
    expect(rows[1].prev_hash).toBe(rows[0].hash);
    expect(rows[2].prev_hash).toBe(rows[1].hash);
    // hashes are 64-hex SHA-256 digests
    for (const r of rows) expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Test I — append-only (history cannot be rewritten)", () => {
  it("rejects UPDATE of an existing entry", async () => {
    await expect(
      db.query("UPDATE audit.audit_log SET action = 'HACKED'"),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE of an entry", async () => {
    await expect(db.query("DELETE FROM audit.audit_log")).rejects.toThrow(/append-only/i);
  });

  it("rejects TRUNCATE", async () => {
    await expect(db.query("TRUNCATE audit.audit_log")).rejects.toThrow(/append-only/i);
  });
});

describe("Test K — locked down (only the trusted server may touch it)", () => {
  async function asRole(role: string, sql: string): Promise<void> {
    await db.query("BEGIN");
    try {
      await db.query(`SET LOCAL ROLE ${role}`);
      await db.query(sql);
    } finally {
      await db.query("ROLLBACK");
    }
  }

  it("authenticated cannot read the audit log", async () => {
    await expect(asRole("authenticated", "SELECT * FROM audit.audit_log")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("anon cannot read the audit log", async () => {
    await expect(asRole("anon", "SELECT * FROM audit.audit_log")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("authenticated cannot append via log_event", async () => {
    await expect(
      asRole("authenticated", "SELECT audit.log_event('X', 'user')"),
    ).rejects.toThrow(/permission denied/i);
  });
});

// LAST: corrupt a stored row (simulating an attacker with raw storage access,
// bypassing the append-only trigger) and confirm the chain detects it.
describe("Test J (cont.) — tampering is detected", () => {
  it("verify_chain() reports the break when a past entry is altered", async () => {
    await db.query("ALTER TABLE audit.audit_log DISABLE TRIGGER audit_log_no_update");
    await db.query(
      `UPDATE audit.audit_log
         SET payload = '{"tampered":true}'::jsonb
       WHERE seq = (SELECT min(seq) FROM audit.audit_log)`,
    );
    await db.query("ALTER TABLE audit.audit_log ENABLE TRIGGER audit_log_no_update");

    const v = await verify();
    expect(v.valid).toBe(false);
    expect(typeof v.broken_at).toBe("number");
  });
});
