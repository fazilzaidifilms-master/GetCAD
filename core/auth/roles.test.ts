import { describe, expect, it } from "vitest";

import { isStaffRole, STAFF_ROLES } from "./roles";

describe("isStaffRole", () => {
  it("accepts every staff role", () => {
    for (const r of STAFF_ROLES) expect(isStaffRole(r)).toBe(true);
  });

  it("rejects client/designer and unknowns", () => {
    for (const r of ["CLIENT", "DESIGNER", "", "admin", "ops"]) {
      expect(isStaffRole(r)).toBe(false);
    }
  });

  it("rejects null/undefined safely", () => {
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});
