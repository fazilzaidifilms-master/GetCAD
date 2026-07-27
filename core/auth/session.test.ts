import { describe, expect, it } from "vitest";

import { isProtectedPath } from "./session";

describe("isProtectedPath", () => {
  it("protects the dashboard and everything under it", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/dashboard/")).toBe(true);
    expect(isProtectedPath("/dashboard/orders")).toBe(true);
    expect(isProtectedPath("/dashboard/orders/123")).toBe(true);
  });

  it("protects the orders area too", () => {
    expect(isProtectedPath("/orders")).toBe(true);
    expect(isProtectedPath("/orders/abc")).toBe(true);
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

describe("Test AU8 — the payment webhook must stay reachable", () => {
  it("does NOT require a session", () => {
    // Razorpay is server-to-server and carries no Clerk cookie. Putting this
    // path behind auth.protect() would silently break every payment: checkout
    // succeeds, the webhook 302s to sign-in, and escrow is never funded.
    // Its own security is the HMAC signature, not a session.
    expect(isProtectedPath("/api/webhooks/razorpay")).toBe(false);
  });

  it("still protects the authenticated product", () => {
    expect(isProtectedPath("/orders")).toBe(true);
    expect(isProtectedPath("/dashboard")).toBe(true);
  });
});
