import { describe, expect, it } from "vitest";

import { isProtectedPath } from "./session";

describe("isProtectedPath", () => {
  it("protects the dashboard and everything under it", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/dashboard/")).toBe(true);
    expect(isProtectedPath("/dashboard/orders")).toBe(true);
    expect(isProtectedPath("/dashboard/orders/123")).toBe(true);
  });

  it("leaves public paths open", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/sign-up")).toBe(false);
  });

  it("does not protect look-alike prefixes", () => {
    // a path that merely starts with the letters but is a different segment
    expect(isProtectedPath("/dashboards")).toBe(false);
    expect(isProtectedPath("/dashboard-public")).toBe(false);
  });
});
