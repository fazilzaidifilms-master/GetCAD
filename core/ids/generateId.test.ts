import { describe, expect, it } from "vitest";

import { generateId, ID_LENGTH, isOpaqueId } from "./generateId";

describe("generateId (opaque IDs)", () => {
  it("produces a fixed-length string of the expected shape", () => {
    const id = generateId();
    expect(id).toHaveLength(ID_LENGTH);
    expect(isOpaqueId(id)).toBe(true);
  });

  it("is NEVER a sequential integer (Test C, unit level)", () => {
    for (let i = 0; i < 1000; i++) {
      const id = generateId();
      // not "1", "2", "3", ... and not all digits
      expect(/^\d+$/.test(id)).toBe(false);
      expect(Number.isNaN(Number(id))).toBe(true);
    }
  });

  it("does not collide across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) seen.add(generateId());
    expect(seen.size).toBe(50_000);
  });
});
