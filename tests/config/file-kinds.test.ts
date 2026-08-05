import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RELEASE_KINDS, REVIEW_KINDS } from "../../core/files/downloadGate";

/**
 * `core/files/downloadGate.ts` declares the kinds as a TypeScript union rather
 * than importing generated database types, so that core stays dependency-free.
 * That is a deliberate duplication, and duplication drifts. This test is the
 * thing that stops it drifting silently.
 *
 * The failure it prevents is specific: someone adds a kind to the enum, the
 * gate has never heard of it, and `fileGrantFor` falls through to the release
 * branch — or worse, someone adds one the gate treats as review-set by
 * accident. Either way the first symptom is a file in front of the wrong
 * person.
 */
const MIGRATION = join(process.cwd(), "db/migrations/0030_file_kinds.sql");

function enumValuesFromMigration(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /CREATE TYPE file_kind AS ENUM \(([\s\S]*?)\);/.exec(sql);
  if (!match?.[1]) throw new Error("could not find the file_kind enum in 0030_file_kinds.sql");
  // Digits matter: RHINO_3DM is silently skipped by an [A-Z_]-only class, and a
  // kind this test cannot see is a kind it cannot police.
  return [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]!);
}

describe("file_kind stays in sync with the download gate", () => {
  it("classifies every kind the database can store", () => {
    const inDb = enumValuesFromMigration().sort();
    const known = [...REVIEW_KINDS, ...RELEASE_KINDS, "CLIENT_REFERENCE"].sort();
    expect(inDb).toEqual(known);
  });

  it("finds a non-trivial enum, so a regex that stopped matching fails loudly", () => {
    expect(enumValuesFromMigration().length).toBeGreaterThan(4);
  });
});
