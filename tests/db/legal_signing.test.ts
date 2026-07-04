import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const designerU = generateId();

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

async function currentDoc(): Promise<{ id: string; version: string; body: string; hash: string }> {
  const { rows } = await db.query(
    "SELECT id, version, body, content_sha256 AS hash FROM app.current_agreement('DESIGNER')",
  );
  return rows[0];
}

async function assignable(id: string): Promise<boolean> {
  const { rows } = await db.query("SELECT app.designer_is_assignable($1) AS v", [id]);
  return rows[0].v;
}

beforeAll(async () => {
  db = await connectFreshDb();
  await asUser(designerU, () =>
    db.query("SELECT public.apply_as_designer($1,$2,$3)", [
      generateId(),
      "Dana Designer",
      "dana@studio.example",
    ]),
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test S — legal document signing", () => {
  it("a DESIGNER agreement is published and its fingerprint matches its exact text", async () => {
    const doc = await currentDoc();
    expect(doc.version).toBe("v1");
    const { rows } = await db.query(
      "SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS h",
      [doc.body],
    );
    expect(rows[0].h).toBe(doc.hash); // stored fingerprint == sha256(body)
  });

  it("rejects signing with a wrong/stale fingerprint", async () => {
    await expect(
      asUser(designerU, () =>
        db.query("SELECT public.accept_designer_agreement($1)", ["deadbeef".repeat(8)]),
      ),
    ).rejects.toThrow(/changed since you loaded it/i);
    // still not assignable — nothing was recorded
    expect(await assignable(designerU)).toBe(false);
  });

  it("records an immutable, audited signature with the version + fingerprint", async () => {
    const doc = await currentDoc();
    await asUser(designerU, () =>
      db.query("SELECT public.accept_designer_agreement($1)", [doc.hash]),
    );

    const sig = await db.query(
      "SELECT agreement_id, content_sha256 FROM agreement_acceptances WHERE user_id = $1",
      [designerU],
    );
    expect(sig.rows).toHaveLength(1);
    expect(sig.rows[0].agreement_id).toBe(doc.id);
    expect(sig.rows[0].content_sha256).toBe(doc.hash); // snapshot of what was signed

    const a = await db.query(
      `SELECT payload FROM audit.audit_log
       WHERE entity_id = $1 AND action = 'DESIGNER_AGREEMENT_ACCEPTED'`,
      [designerU],
    );
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].payload.agreement_version).toBe("v1");
    expect(a.rows[0].payload.content_sha256).toBe(doc.hash);

    expect(await assignable(designerU)).toBe(true); // gate now passes
  });

  it("a signature cannot be updated or deleted (append-only)", async () => {
    await expect(
      db.query("UPDATE agreement_acceptances SET content_sha256 = 'x' WHERE user_id = $1", [
        designerU,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.query("DELETE FROM agreement_acceptances WHERE user_id = $1", [designerU]),
    ).rejects.toThrow(/append-only/i);
  });

  it("a published document cannot be edited (append-only)", async () => {
    await expect(
      db.query("UPDATE agreement_documents SET body = 'tampered' WHERE kind = 'DESIGNER'"),
    ).rejects.toThrow(/append-only/i);
  });

  it("publishing v2 re-gates the designer until they accept it; the v1 signature remains", async () => {
    // Publish a new current version.
    await db.query(
      `INSERT INTO agreement_documents (id, kind, version, title, body, content_sha256)
       SELECT 'agr_designer_v2','DESIGNER','v2','Designer Agreement v2', body,
              encode(sha256(convert_to(body,'UTF8')),'hex')
       FROM (SELECT 'Updated designer agreement text.' AS body) s`,
    );

    // The v1 signature is still on file (historical proof).
    const v1sig = await db.query(
      "SELECT count(*)::int AS n FROM agreement_acceptances WHERE user_id = $1 AND agreement_id = 'agr_designer_v1'",
      [designerU],
    );
    expect(v1sig.rows[0].n).toBe(1);

    // But the current version is now v2, so the designer is re-gated.
    expect((await currentDoc()).version).toBe("v2");
    expect(await assignable(designerU)).toBe(false);

    // Accepting v2 restores assignability.
    const v2 = await currentDoc();
    await asUser(designerU, () =>
      db.query("SELECT public.accept_designer_agreement($1)", [v2.hash]),
    );
    expect(await assignable(designerU)).toBe(true);

    // Both signatures now exist.
    const all = await db.query(
      "SELECT count(*)::int AS n FROM agreement_acceptances WHERE user_id = $1",
      [designerU],
    );
    expect(all.rows[0].n).toBe(2);
  });

  it("the audit chain stays valid throughout", async () => {
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
