import { afterEach, describe, expect, it } from "vitest";

import { assertDestroyable } from "../helpers/db";

/**
 * The guard in front of the destructive test harness.
 *
 * `freshSchema` drops the public, app and audit schemas. That is correct for a
 * deterministic suite and catastrophic anywhere else, and the only thing
 * separating the two was an environment variable — one that gets exported into
 * a shell for entirely ordinary reasons (`db:apply`, `verify:payment`) and then
 * lingers for the rest of the session.
 *
 * The failure being prevented actually happened here: a production Supabase
 * database was dropped and rebuilt because `npm run ci` ran in a terminal where
 * `export DATABASE_URL=…` was still set from a migration run earlier the same
 * afternoon. Nothing about that sequence looks dangerous while you are typing
 * it, which is precisely why a warning in the README was not enough.
 *
 * Tested through the guard rather than through `freshSchema`, because a test
 * that verifies "this drops every schema" by dropping every schema is not a
 * test anyone should run.
 */
const HOSTED = "postgresql://user:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres";

afterEach(() => {
  delete process.env.I_KNOW_THIS_DATABASE_IS_DISPOSABLE;
});

describe("assertDestroyable", () => {
  it("refuses a hosted Postgres", () => {
    expect(() => assertDestroyable(HOSTED)).toThrow(/REFUSING TO RUN/);
  });

  it("names the host, so the mistake is obvious in the output", () => {
    expect(() => assertDestroyable("postgresql://u:p@db.example.com:5432/postgres")).toThrow(
      /db\.example\.com/,
    );
  });

  it("tells you the actual fix rather than just complaining", () => {
    expect(() => assertDestroyable("postgresql://u:p@db.example.com:5432/postgres")).toThrow(
      /unset DATABASE_URL/,
    );
  });

  // "Cannot identify it" is a reason to refuse, not a reason to proceed.
  it("refuses a connection string it cannot parse", () => {
    expect(() => assertDestroyable("this is not a url")).toThrow(/could not parse/i);
  });

  it("allows the local throwaway cluster", () => {
    expect(() => assertDestroyable("postgres://postgres@127.0.0.1:5433/postgres")).not.toThrow();
    expect(() => assertDestroyable("postgres://postgres@localhost:5433/postgres")).not.toThrow();
  });

  it("allows the docker-compose service name CI resolves to", () => {
    expect(() => assertDestroyable("postgres://postgres@test-db:5432/postgres")).not.toThrow();
  });

  // A hostname that merely contains "localhost" is not localhost.
  it("is not fooled by a host that only looks local", () => {
    expect(() => assertDestroyable("postgres://u:p@localhost.evil.com:5432/postgres")).toThrow(
      /REFUSING TO RUN/,
    );
    expect(() => assertDestroyable("postgres://u:p@notlocalhost:5432/postgres")).toThrow(
      /REFUSING TO RUN/,
    );
  });

  it("has an escape hatch, and it is not one anybody types by accident", () => {
    process.env.I_KNOW_THIS_DATABASE_IS_DISPOSABLE = "yes";
    expect(() => assertDestroyable(HOSTED)).not.toThrow();
  });

  it("ignores a half-hearted opt-out", () => {
    process.env.I_KNOW_THIS_DATABASE_IS_DISPOSABLE = "true";
    expect(() => assertDestroyable(HOSTED)).toThrow(/REFUSING TO RUN/);
  });
});
