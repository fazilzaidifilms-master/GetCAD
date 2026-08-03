import { describe, expect, it } from "vitest";

// The verify:* scripts are plain .mjs so they can run with bare `node` against
// production. The URL handling in them is the part most likely to be wrong at
// exactly the moment nobody is watching, so it is tested here.
// @ts-expect-error — untyped .mjs helper, exercised for behaviour not types.
import { assertNotAuthWall, isAuthWall, normalizeAppUrl } from "../../scripts/lib/app-url.mjs";

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("normalizeAppUrl", () => {
  it("defaults to the local dev server", () => {
    expect(normalizeAppUrl(undefined)).toBe("http://localhost:3000");
  });

  it("supplies the missing scheme — a schemeless URL makes fetch throw", () => {
    expect(normalizeAppUrl("thecadpillar.com")).toBe("https://thecadpillar.com");
    expect(normalizeAppUrl("my-app.vercel.app")).toBe("https://my-app.vercel.app");
  });

  it("assumes http only for the local host", () => {
    expect(normalizeAppUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAppUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("leaves an explicit scheme alone", () => {
    expect(normalizeAppUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeAppUrl("https://example.com")).toBe("https://example.com");
  });

  it("trims surrounding whitespace and trailing slashes", () => {
    expect(normalizeAppUrl("  https://example.com//  ")).toBe("https://example.com");
  });
});

describe("isAuthWall", () => {
  // This is the check that stops a green run from meaning nothing: the webhook
  // tests assert a 401, so a platform login wall in front of the deployment
  // would satisfy them without the application ever being consulted.
  it("recognises a platform login wall by body", () => {
    const body = '{"error":{"code":"401","message":"Protected deployment"}}';
    expect(isAuthWall(response(401), body)).toBe(true);
  });

  it("recognises a platform login wall by cookie", () => {
    const res = response(401, { "set-cookie": "_vercel_sso_nonce=abc; Path=/" });
    expect(isAuthWall(res, "")).toBe(true);
  });

  it("does NOT flag our own signature refusal", () => {
    expect(isAuthWall(response(401), '{"error":"invalid signature"}')).toBe(false);
  });

  it("ignores successful responses", () => {
    expect(isAuthWall(response(200), '{"status":"ok"}')).toBe(false);
  });
});

describe("assertNotAuthWall", () => {
  // A 404 is not a refusal. The tampered-amount check accepts any status >= 400,
  // so an APP_URL pointing at something without the route would pass it.
  it("treats a 404 as a misconfigured APP_URL, not a rejection", () => {
    expect(() => assertNotAuthWall("https://example.com", response(404), "<!DOCTYPE html>")).toThrow(
      /nothing is serving the webhook there/,
    );
  });

  it("lets the route's own refusal through", () => {
    expect(() =>
      assertNotAuthWall("https://example.com", response(401), '{"error":"invalid signature"}'),
    ).not.toThrow();
  });
});
