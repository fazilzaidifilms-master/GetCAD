import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isProtectedPath } from "../../core/auth/session";
import { POST_AUTH_PATH } from "../../config/auth-redirects";

/**
 * Sign-in has to end somewhere in the app.
 *
 * This is a source-text test rather than a behavioural one, which is unusual
 * here and is a deliberate trade. The failure it guards against cannot be
 * reached from a unit test — it is Clerk's own default taking effect because a
 * prop was never passed — and it is invisible in every environment that has a
 * session already. The only reliable way to catch it is to assert the props
 * exist at all four places a person can begin authenticating.
 *
 * The bug it encodes: nothing set a destination, Clerk's default is `/`, and `/`
 * is the marketing homepage. Signing in returned you to the page you started
 * from, which is indistinguishable from sign-in failing.
 */
const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

const ENTRY_POINTS = [
  "app/(app)/sign-in/[[...sign-in]]/page.tsx",
  "app/(app)/sign-up/[[...sign-up]]/page.tsx",
  "app/(app)/layout.tsx",
];

describe("where authentication lands", () => {
  it("sends people into the app, not back to the marketing site", () => {
    expect(POST_AUTH_PATH.startsWith("/")).toBe(true);
    expect(POST_AUTH_PATH).not.toBe("/");
  });

  // If it were not behind auth, an unauthenticated visitor could be redirected
  // there after a failed sign-in and see a page that quietly renders nothing.
  it("lands on a route that requires a session", () => {
    expect(isProtectedPath(POST_AUTH_PATH)).toBe(true);
  });

  // The PWA's start_url. Signing in through the browser and launching from the
  // home screen must agree about where the app begins, or the two feel like
  // different products.
  it("matches the manifest's start_url", () => {
    const manifest = read("app/manifest.ts");
    expect(manifest).toContain(`start_url: "${POST_AUTH_PATH}"`);
  });
});

describe("every place sign-in can begin", () => {
  it("passes a redirect rather than relying on Clerk's default", () => {
    for (const file of ENTRY_POINTS) {
      expect(read(file), `${file} has no fallbackRedirectUrl`).toContain("fallbackRedirectUrl");
    }
  });

  it("uses the shared constant rather than a hard-coded path", () => {
    for (const file of ENTRY_POINTS) {
      expect(read(file), `${file} does not import POST_AUTH_PATH`).toContain("POST_AUTH_PATH");
    }
  });

  // `forceRedirectUrl` discards a pending destination. The middleware bounces an
  // unauthenticated visitor off /orders/ord_abc and Clerk remembers to return
  // them there; force would throw that away and dump everyone on the dashboard,
  // so an order link shared with a client would never open that order.
  it("does not force the destination over a pending one", () => {
    for (const file of ENTRY_POINTS) {
      expect(read(file), `${file} uses forceRedirectUrl`).not.toContain("forceRedirectUrl");
    }
  });
});

describe("the marketing header", () => {
  const header = read("components/marketing/marketing-header.tsx");

  // Landing back here after signing in was half the bug; a header that still
  // says "Sign in" was the other half, and on its own it is enough to convince
  // someone the sign-in did not work.
  it("offers a way into the app once you are signed in", () => {
    expect(header).toContain("SignedIn");
    expect(header).toContain("POST_AUTH_PATH");
  });

  it("still offers sign-in to visitors who are not", () => {
    expect(header).toContain("SignedOut");
    expect(header).toContain("/sign-in");
    expect(header).toContain("/sign-up");
  });
});

/**
 * Authentication has to stay on this origin, or the installed app cannot
 * complete it.
 *
 * Unset, Clerk redirects an unauthenticated visitor to its hosted Account
 * Portal — `accounts.<domain>` or `<slug>.accounts.dev`. A browser follows that
 * without complaint. The installed PWA cannot: the portal is outside the
 * manifest's `scope`, and on iOS a home-screen app has a storage container
 * separate from Safari's, so the session established over there is not the
 * session read back here. /dashboard redirects out, comes back without a
 * session, and redirects out again — an app that opens to a spinner and never
 * finishes, with no error anywhere to explain it.
 *
 * Both places have to be set and they do different jobs: the middleware option
 * decides where `auth.protect()` sends people, the provider prop decides where
 * links inside Clerk's own components point.
 */
describe("authentication stays on this origin", () => {
  const IN_ORIGIN = /^\/[a-z-]/;

  it("routes auth.protect() to our own sign-in page, not Clerk's portal", () => {
    const middleware = read("middleware.ts");
    expect(middleware).toMatch(/signInUrl:\s*"(\/[^"]+)"/);
    expect(middleware).toMatch(/signUpUrl:\s*"(\/[^"]+)"/);
    const signIn = /signInUrl:\s*"([^"]+)"/.exec(middleware)?.[1] ?? "";
    expect(signIn, "must be a path on this origin, not an absolute URL").toMatch(IN_ORIGIN);
  });

  it("points Clerk's own components at our routes too", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/signInUrl="(\/[^"]+)"/);
    expect(layout).toMatch(/signUpUrl="(\/[^"]+)"/);
  });

  // Sign-out defaults to the portal as well, which ejects someone out of the
  // installed app at the exact moment they have no session to get back in with.
  it("returns to this origin after signing out", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/afterSignOutUrl="(\/[^"]*)"/);
  });

  it("names sign-in routes that actually exist", () => {
    expect(read("app/(app)/sign-in/[[...sign-in]]/page.tsx")).toContain("SignIn");
    expect(read("app/(app)/sign-up/[[...sign-up]]/page.tsx")).toContain("SignUp");
  });

  // The installed app launches straight into start_url. If that were behind
  // auth AND the sign-in page were unreachable in-origin, the first launch
  // after install would be the loop this whole block exists to prevent.
  it("can reach sign-in without being signed in", () => {
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/sign-up")).toBe(false);
  });
});
