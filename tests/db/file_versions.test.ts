import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateId } from "../../core/ids/generateId";
import { connectFreshDb } from "../helpers/db";

let db: Client;

const clientU = generateId();
const designerU = generateId();
const strangerU = generateId();
const order = generateId();

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

async function addVersion(sub: string, objectKey: string, kind = "RENDER") {
  return asUser(sub, () =>
    db.query("SELECT public.add_file_version($1,$2,$3,'application/pdf',1024,$4) AS id", [
      generateId(),
      order,
      objectKey,
      kind,
    ]),
  );
}

async function versionsSeenBy(sub: string): Promise<number> {
  return asUser(sub, async () => {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM file_versions");
    return rows[0].n as number;
  });
}

beforeAll(async () => {
  db = await connectFreshDb();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'), ($2,'DESIGNER','ACTIVE'), ($3,'CLIENT','ACTIVE')`,
    [clientU, designerU, strangerU],
  );
  await db.query(
    `INSERT INTO orders (id, client_id, designer_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,$3,'CAD_MODEL','IN_PROGRESS','USD',10000,6000,1000,3000)`,
    [order, clientU, designerU],
  );
});

afterAll(async () => {
  if (db) await db.end();
});

describe("Test Q — file versions (audited, versioned, RLS-gated)", () => {
  it("the assigned designer adds a version; current_version_id + audit are set", async () => {
    const res = await addVersion(designerU, "objkey_1");
    const vid = res.rows[0].id as string;

    const o = await db.query("SELECT current_version_id FROM orders WHERE id = $1", [order]);
    expect(o.rows[0].current_version_id).toBe(vid);

    const fv = await db.query("SELECT version_no, uploaded_by FROM file_versions WHERE id = $1", [vid]);
    expect(fv.rows[0].version_no).toBe(1);
    expect(fv.rows[0].uploaded_by).toBe(designerU);

    const a = await db.query(
      "SELECT action FROM audit.audit_log WHERE entity_id = $1 AND action = 'FILE_VERSION_ADDED'",
      [order],
    );
    expect(a.rows).toHaveLength(1);
  });

  it("the client attaches reference material; version_no increments", async () => {
    const res = await addVersion(clientU, "objkey_2", "CLIENT_REFERENCE");
    const vid = res.rows[0].id as string;
    const fv = await db.query("SELECT version_no, kind FROM file_versions WHERE id = $1", [vid]);
    expect(fv.rows[0].version_no).toBe(2);
    expect(fv.rows[0].kind).toBe("CLIENT_REFERENCE");
  });

  // current_version_id means "the work as it currently stands". A client
  // attaching a PDF mid-job must not redefine what the designer submitted.
  it("a client's attachment does not move the order's current version", async () => {
    const o = await db.query("SELECT current_version_id FROM orders WHERE id = $1", [order]);
    const current = await db.query("SELECT uploaded_by FROM file_versions WHERE id = $1", [
      o.rows[0].current_version_id,
    ]);
    expect(current.rows[0].uploaded_by).toBe(designerU);
  });

  // The whole point of kinds: a client who could post 'STL' would be writing
  // into the set the download gate releases only after approval.
  it("refuses to let a client label their upload as a deliverable", async () => {
    await expect(addVersion(clientU, "objkey_forged", "STL")).rejects.toThrow(
      /only attach reference material/i,
    );
    await expect(addVersion(clientU, "objkey_forged2", "RENDER")).rejects.toThrow(
      /only attach reference material/i,
    );
  });

  // And the mirror: a designer marking a deliverable as the client's own
  // material would hand it over early, since a client always gets that back.
  it("refuses to let a designer claim the client's reference kind", async () => {
    await expect(addVersion(designerU, "objkey_forged3", "CLIENT_REFERENCE")).rejects.toThrow(
      /client's own material/i,
    );
  });

  it("rejects a kind the enum does not have", async () => {
    await expect(addVersion(designerU, "objkey_bogus", "SECRET_SAUCE")).rejects.toThrow();
  });

  // The un-kinded five-argument writer is dropped, not overloaded: leaving it
  // callable leaves a path that writes 'OTHER' by omission.
  it("no longer exposes a way to add a version without saying what it is", async () => {
    await expect(
      asUser(designerU, () =>
        db.query("SELECT public.add_file_version($1,$2,$3,'application/pdf',1024) AS id", [
          generateId(),
          order,
          "objkey_unkinded",
        ]),
      ),
    ).rejects.toThrow(/does not exist/i);
  });

  it("a non-participant cannot add a version", async () => {
    await expect(addVersion(strangerU, "objkey_hack")).rejects.toThrow(/not a participant/i);
  });

  it("RLS: participants can read versions; an unrelated user cannot", async () => {
    expect(await versionsSeenBy(designerU)).toBe(2);
    expect(await versionsSeenBy(clientU)).toBe(2);
    expect(await versionsSeenBy(strangerU)).toBe(0); // can't see the order -> can't see its files
  });

  it("the audit chain stays valid", async () => {
    const v = await db.query("SELECT audit.verify_chain() AS v");
    expect(v.rows[0].v.valid).toBe(true);
  });
});
