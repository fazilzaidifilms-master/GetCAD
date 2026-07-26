import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Test AQ2 — production must not trust a wildcard dev domain for Server Actions.
 *
 * "*.app.github.dev" is a host anyone can obtain a subdomain on. Trusting it in
 * production weakens Next's Server Action origin (CSRF) check for the deployed
 * site. It is required in dev (Codespaces proxies from a forwarded host), so
 * the config must be environment-dependent — this test pins both directions.
 */
async function loadConfig(nodeEnv: string, extra?: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  if (extra === undefined) {
    vi.stubEnv("NEXT_SERVER_ACTION_ALLOWED_ORIGINS", "");
  } else {
    vi.stubEnv("NEXT_SERVER_ACTION_ALLOWED_ORIGINS", extra);
  }
  const mod = await import("../../next.config.mjs?" + Math.random());
  return (mod.default.experimental?.serverActions?.allowedOrigins ?? []) as string[];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Test AQ2 — Server Action allowed origins", () => {
  it("does NOT trust the wildcard dev domain in production", async () => {
    const origins = await loadConfig("production");
    expect(origins.some((o) => o.includes("github.dev"))).toBe(false);
    expect(origins.some((o) => o.startsWith("*."))).toBe(false);
  });

  it("still trusts the dev hosts outside production", async () => {
    const origins = await loadConfig("development");
    expect(origins).toContain("*.app.github.dev");
    expect(origins).toContain("localhost:3000");
  });

  it("allows a real deployment host to be added explicitly in production", async () => {
    const origins = await loadConfig("production", "app.thecadpillar.com");
    expect(origins).toEqual(["app.thecadpillar.com"]);
  });
});
