import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tabsForRole } from "../../core/nav/tabs";

/**
 * Every tab must point at a page that exists.
 *
 * `tabs.test.ts` checks the hrefs against a list written by hand, which catches
 * a typo but not a deletion: rename a route directory and that list is still
 * happily green while the tab 404s. This walks the App Router instead, so the
 * filesystem is the authority.
 *
 * The other direction — a page with no tab — is NOT asserted, because plenty of
 * routes are reached from inside a screen rather than from the bar. The one
 * that bit us was /onboarding/designer, and it is covered by name in tabs.test.
 */
const ROLES = ["CLIENT", "DESIGNER", "OPS", "SALES", "FINANCE", "QC"];

/** Route groups like (app) and (marketing) do not appear in the URL. */
const GROUPS = ["(app)", "(marketing)", ""];

function pageExists(href: string): boolean {
  const segments = href.replace(/^\//, "");
  return GROUPS.some((group) =>
    ["page.tsx", "page.ts", "page.jsx"].some((leaf) =>
      existsSync(join(process.cwd(), "app", group, segments, leaf)),
    ),
  );
}

describe("navigation points at routes that exist", () => {
  it("resolves every tab of every role to a page file", () => {
    const missing: string[] = [];
    for (const role of ROLES) {
      for (const tab of tabsForRole(role)) {
        if (!pageExists(tab.href)) missing.push(`${role} → ${tab.href}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // If the resolver silently stopped finding anything, the test above would
  // pass for the wrong reason on an empty tab list.
  it("is actually resolving pages, not failing open", () => {
    expect(pageExists("/dashboard")).toBe(true);
    expect(pageExists("/definitely-not-a-route")).toBe(false);
  });
});
