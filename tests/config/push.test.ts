import { describe, expect, it } from "vitest";

import {
  privateKeyProblem,
  publicKeyProblem,
  pushConfigProblems,
  pushIsConfiguredForBrowser,
  readPushConfig,
  subjectProblem,
} from "../../config/push";

// Structurally valid shapes — right alphabet, right lengths. Not real keys.
const PUBLIC_KEY = "B".repeat(87);
const PRIVATE_KEY = "a".repeat(43);
const SUBJECT = "mailto:ops@thecadpillar.com";

const env = (over: Record<string, string> = {}) =>
  ({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    VAPID_PRIVATE_KEY: PRIVATE_KEY,
    VAPID_SUBJECT: SUBJECT,
    ...over,
  }) satisfies Record<string, string | undefined>;

describe("publicKeyProblem", () => {
  it("accepts a well-formed public key", () => {
    expect(publicKeyProblem(PUBLIC_KEY)).toBeNull();
    expect(publicKeyProblem(`  ${PUBLIC_KEY}  `)).toBeNull();
  });

  // The failure that ships a secret to every visitor of the marketing site and
  // breaks nothing, so nothing ever reports it.
  it("shouts when the private key has been pasted into the public variable", () => {
    const problem = publicKeyProblem(PRIVATE_KEY);
    expect(problem).toMatch(/PRIVATE key/);
    expect(problem).toMatch(/generate a new pair/i);
  });

  it("rejects a value that is not base64url", () => {
    expect(publicKeyProblem("has spaces and +/= in it")).toMatch(/base64url/);
  });

  it("rejects an empty value", () => {
    expect(publicKeyProblem("")).toMatch(/not set/);
    expect(publicKeyProblem("   ")).toMatch(/not set/);
  });

  // A reason is shown in logs and on /api/health. It must never quote the key.
  it("never repeats the value back", () => {
    for (const bad of [PRIVATE_KEY, "short", "x".repeat(120)]) {
      expect(publicKeyProblem(bad)).not.toContain(bad);
    }
  });
});

describe("privateKeyProblem", () => {
  it("accepts a well-formed private key", () => {
    expect(privateKeyProblem(PRIVATE_KEY, PUBLIC_KEY)).toBeNull();
  });

  it("catches the two being swapped", () => {
    expect(privateKeyProblem(PUBLIC_KEY, PRIVATE_KEY)).toMatch(/swapped|PUBLIC key/i);
  });

  it("catches one value pasted into both", () => {
    expect(privateKeyProblem(PRIVATE_KEY, PRIVATE_KEY)).toMatch(/two halves of a keypair/);
  });

  it("never repeats the value back", () => {
    expect(privateKeyProblem("y".repeat(50), PUBLIC_KEY)).not.toContain("y".repeat(50));
  });
});

describe("subjectProblem", () => {
  it("accepts a mailto or an https contact", () => {
    expect(subjectProblem(SUBJECT)).toBeNull();
    expect(subjectProblem("https://thecadpillar.com/contact")).toBeNull();
  });

  it("rejects a bare address or an http URL", () => {
    expect(subjectProblem("ops@thecadpillar.com")).toMatch(/mailto:/);
    expect(subjectProblem("http://thecadpillar.com")).toMatch(/mailto:/);
  });
});

describe("readPushConfig", () => {
  it("returns the trio when everything is right", () => {
    expect(readPushConfig(env())).toEqual({
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      subject: SUBJECT,
    });
  });

  // Push is an enhancement. A deployment without keys must run normally with
  // notifications appearing in the app and simply not on devices — never a
  // crash at boot over a feature nobody has configured yet.
  it("returns null rather than throwing when push is not configured", () => {
    expect(readPushConfig({})).toBeNull();
    expect(readPushConfig(env({ VAPID_PRIVATE_KEY: "" }))).toBeNull();
  });

  it("reports every problem at once rather than one per run", () => {
    const problems = pushConfigProblems({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "bad",
      VAPID_PRIVATE_KEY: "",
      VAPID_SUBJECT: "nope",
    });
    expect(problems).toHaveLength(3);
  });
});

describe("pushIsConfiguredForBrowser", () => {
  it("is true only for a usable public key", () => {
    expect(pushIsConfiguredForBrowser(PUBLIC_KEY)).toBe(true);
    expect(pushIsConfiguredForBrowser(undefined)).toBe(false);
    expect(pushIsConfiguredForBrowser("")).toBe(false);
    expect(pushIsConfiguredForBrowser(PRIVATE_KEY)).toBe(false);
  });
});
