import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES } from "../../core/files/sanitizationGate";
// @ts-expect-error — next.config.mjs is plain ESM with no type declarations.
import nextConfig, { UPLOAD_BODY_LIMIT_MB } from "../../next.config.mjs";

/**
 * Test AQ1 — the transport can actually carry what the gate accepts.
 *
 * Regression guard for a real, shipped bug: the sanitization gate advertised a
 * 100 MiB ceiling while Next Server Actions silently defaulted to a 1 MB body
 * limit, so every realistic CAD file or PDF failed in transport before the gate
 * ever ran. 163 passing tests could not see it, because none of them crossed
 * the app layer.
 */
function parseMb(limit: unknown): number {
  const m = /^(\d+(?:\.\d+)?)mb$/i.exec(String(limit));
  if (!m) throw new Error(`bodySizeLimit is not in "<n>mb" form: ${String(limit)}`);
  return Number(m[1]);
}

describe("Test AQ1 — upload limits agree across the stack", () => {
  const configured = nextConfig.experimental?.serverActions?.bodySizeLimit;

  it("Server Actions declare an explicit body size limit", () => {
    // Without this, Next falls back to 1 MB and uploads break silently.
    expect(configured).toBeDefined();
  });

  it("the Server Action body limit is at least the gate's MAX_UPLOAD_BYTES", () => {
    const limitBytes = parseMb(configured) * 1024 * 1024;
    expect(limitBytes).toBeGreaterThanOrEqual(MAX_UPLOAD_BYTES);
  });

  it("the exported constant matches the value actually handed to Next", () => {
    expect(parseMb(configured)).toBe(UPLOAD_BODY_LIMIT_MB);
  });

  it("the gate's ceiling is a sane, non-zero size", () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(1024 * 1024);
  });
});
