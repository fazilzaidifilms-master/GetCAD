import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cronRequestIsAuthorised, cronSecretProblem } from "../../config/cron";

const SECRET = "b7f4e2a9c1d83056fe7a24bb90c1de35";

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
    expect(cronRequestIsAuthorised("Bearer b7f4", SECRET)).toBe(false);
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
  // The route exists to be called on a timer. A vercel.json that stopped
  // pointing at it would leave notifications queued forever with nothing
  // failing anywhere.
  it("is wired to the push route in vercel.json", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    const paths = (config.crons ?? []).map((c: { path: string }) => c.path);
    expect(paths).toContain("/api/cron/push");
  });

  it("points only at routes that exist", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    for (const cron of config.crons ?? []) {
      const file = join(process.cwd(), "app", cron.path, "route.ts");
      expect(readFileSync(file, "utf8").length, `${cron.path} has no route`).toBeGreaterThan(0);
    }
  });
});
