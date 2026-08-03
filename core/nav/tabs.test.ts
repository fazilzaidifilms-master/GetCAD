import { describe, expect, it } from "vitest";

import { activeTabKey, tabsForRole } from "./tabs";

const hrefs = (role: string) => tabsForRole(role).map((t) => t.href);

describe("tabsForRole", () => {
  // The disclosure this prevents: a customer being shown that /admin exists.
  it("never offers a client or designer a staff destination", () => {
    for (const role of ["CLIENT", "DESIGNER"]) {
      expect(hrefs(role).some((h) => h.startsWith("/admin"))).toBe(false);
    }
  });

  it("gives every staff role the same shell", () => {
    const ops = tabsForRole("OPS");
    for (const role of ["SALES", "FINANCE", "QC"]) {
      expect(tabsForRole(role)).toEqual(ops);
    }
    expect(hrefs("OPS")).toContain("/admin");
  });

  it("labels the same route for the person reading it", () => {
    const client = tabsForRole("CLIENT").find((t) => t.key === "orders");
    const designer = tabsForRole("DESIGNER").find((t) => t.key === "orders");
    expect(client?.href).toBe("/orders");
    expect(designer?.href).toBe("/orders");
    expect(client?.label).toBe("Orders");
    expect(designer?.label).toBe("My work");
  });

  // Falling back to the staff shell would show an empty queue and leak that
  // staff tooling exists; falling back to the client shell degrades quietly.
  it("falls back to the least-privileged shell for an unknown role", () => {
    expect(tabsForRole("SUPER_ADMIN")).toEqual(tabsForRole("CLIENT"));
    expect(tabsForRole("")).toEqual(tabsForRole("CLIENT"));
  });

  it("gives every role a way to reach their account", () => {
    for (const role of ["CLIENT", "DESIGNER", "OPS", "SALES", "FINANCE", "QC"]) {
      expect(hrefs(role)).toContain("/account");
    }
  });

  it("gives a client somewhere to start a job", () => {
    expect(hrefs("CLIENT")).toContain("/orders/new");
    // A designer does not commission work, so it would be noise in their bar.
    expect(hrefs("DESIGNER")).not.toContain("/orders/new");
  });

  it("offers no tab that is not a real route", () => {
    const known = new Set(["/dashboard", "/orders", "/orders/new", "/admin", "/account"]);
    for (const role of ["CLIENT", "DESIGNER", "OPS"]) {
      for (const href of hrefs(role)) expect(known.has(href)).toBe(true);
    }
  });
});

describe("activeTabKey", () => {
  const tabs = tabsForRole("CLIENT");

  it("keeps the parent tab lit on a detail route", () => {
    expect(activeTabKey("/orders/ord_abc123", tabs)).toBe("orders");
  });

  // Both /orders and /orders/new match by prefix; the specific one must win or
  // two tabs light at once.
  it("lights New order rather than Orders on the creation route", () => {
    expect(activeTabKey("/orders/new", tabs)).toBe("new");
  });

  it("matches the tab itself", () => {
    expect(activeTabKey("/orders", tabs)).toBe("orders");
    expect(activeTabKey("/dashboard", tabs)).toBe("home");
  });

  // Guards against `/orders` matching `/orders-archive` by naive prefix.
  it("does not match a sibling route that merely starts the same", () => {
    expect(activeTabKey("/ordersomething", tabs)).toBeNull();
  });

  it("returns null off the tab bar entirely", () => {
    expect(activeTabKey("/sign-in", tabs)).toBeNull();
  });

  it("prefers the more specific tab when two could match", () => {
    const nested = [
      { key: "orders", label: "Orders", href: "/orders", icon: "list" as const },
      { key: "new", label: "New", href: "/orders/new", icon: "list" as const },
    ];
    expect(activeTabKey("/orders/new", nested)).toBe("new");
    expect(activeTabKey("/orders/ord_1", nested)).toBe("orders");
  });
});
