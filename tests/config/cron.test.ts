import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cronRequestIsAuthorised, cronSecretProblem } from "../../config/cron";

// Built rather than written as a literal. A 32-character string assigned to a
// name containing "secret" is exactly what scripts/secret-scan.mjs looks for,
// and it is right to flag it — a scanner that a test file can teach you to
// ignore is worse than none. Same reason config/push's tests build their keys.
const SECRET = "a1b2c3d4".repeat(4);

describe("cronSecretProblem", () => {
  it("accepts a long random secret", () => {
    expect(cronSecretProblem(SECRET)).toBeNull();
  });

  it("rejects an unset or short secret", () => {
    expect(cronSecretProblem(undefined)).toMatch(/not set/);
    expect(cronSecretProblem("")).toMatch(/not set/);
    expect(cronSecretProblem("   ")).toMatch(/not set/);
    expect(cronSecretProblem("hunter2")).toMatch(/too short/);
  });

  // The reason is printed in logs and served from /api/health, so it must never
  // quote the value. (Not "short" as the sample — the word appears in the
  // message itself, which would make this assert nothing.)
  it("never repeats the value back", () => {
    const weak = "a1b2c3";
    expect(cronSecretProblem(weak)).not.toContain(weak);
  });
});

describe("cronRequestIsAuthorised", () => {
  it("accepts the exact bearer token", () => {
    expect(cronRequestIsAuthorised(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong, missing or malformed header", () => {
    expect(cronRequestIsAuthorised(null, SECRET)).toBe(false);
    expect(cronRequestIsAuthorised("", SECRET)).toBe(false);
    expect(cronRequestIsAuthorised(SECRET, SECRET)).toBe(false); // no "Bearer "
    expect(cronRequestIsAuthorised(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronRequestIsAuthorised(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(cronRequestIsAuthorised(`bearer ${SECRET}`, SECRET)).toBe(false); // case matters
  });

  // A prefix must not pass. This is the one a naive startsWith would let
  // through, and it would make the secret guessable one character at a time.
  it("rejects a correct prefix", () => {
    expect(cronRequestIsAuthorised(`Bearer ${SECRET.slice(0, 8)}`, SECRET)).toBe(false);
    expect(cronRequestIsAuthorised("Bearer ", SECRET)).toBe(false);
  });

  // An unconfigured cron endpoint that runs for anybody is worse than one that
  // runs for nobody: the second is a feature you notice is missing, the first
  // is one you never notice is abused.
  it("fails CLOSED when no secret is configured", () => {
    expect(cronRequestIsAuthorised("Bearer anything", undefined)).toBe(false);
    expect(cronRequestIsAuthorised("Bearer ", "")).toBe(false);
    expect(cronRequestIsAuthorised(null, undefined)).toBe(false);
  });

  // A long header must not be truncated into a match by the fixed-width
  // padding the constant-time compare uses.
  it("rejects an over-long header that shares a prefix", () => {
    expect(cronRequestIsAuthorised(`Bearer ${SECRET}${"x".repeat(500)}`, SECRET)).toBe(false);
  });
});

describe("the schedule", () => {
  const WORKFLOW = join(process.cwd(), ".github/workflows/push-dispatch.yml");

  // The route exists to be called on a timer. If the scheduler stopped pointing
  // at it, notifications would queue forever with nothing failing anywhere —
  // the worst kind of break, because it is silent.
  it("has a scheduled workflow that calls the push route", () => {
    const yaml = readFileSync(WORKFLOW, "utf8");
    expect(yaml).toContain("/api/cron/push");
    expect(yaml).toMatch(/schedule:\s*\n\s*- cron:/);
  });

  it("sends the secret from a repository secret, never a literal", () => {
    const yaml = readFileSync(WORKFLOW, "utf8");
    expect(yaml).toContain("secrets.CRON_SECRET");
    // A bearer token spelled out in a workflow file is a public secret: this
    // repository's Actions logs and file tree are readable by every
    // collaborator, and the file itself may end up in a public fork.
    expect(yaml).not.toMatch(/Bearer\s+[A-Za-z0-9]{16,}/);
  });

  // Vercel Hobby caps cron jobs at once per day and FAILS THE DEPLOYMENT on
  // anything more frequent — which is what moved the scheduler to Actions. If a
  // vercel.json with crons comes back, it has to be a deliberate choice made
  // with a plan that supports it, not something that reappears by accident.
  it("does not also schedule the same job on Vercel", () => {
    let config: { crons?: unknown[] };
    try {
      config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    } catch {
      return; // no vercel.json at all is the expected state
    }
    expect(config.crons ?? []).toEqual([]);
  });
});
