import { describe, expect, it } from "vitest";

import { readRazorpayConfig, webhookSecretProblem } from "@/config/payments";

const GOOD = "9f2c1b8e4a7d3f60c5e1a9b2d4f6083a7c1e5b9d2f4a6c8e0b3d5f7a1c9e2b4d";

describe("webhookSecretProblem", () => {
  // The case that motivated this: the webhook URL pasted into the secret field.
  // It is not merely wrong, it is PUBLIC — the endpoint is discoverable, so the
  // signing key would be too, and a forged payment.captured could fund escrow.
  it("rejects a URL", () => {
    expect(webhookSecretProblem("https://thecadpillar.com/api/webhooks/razorpay")).toMatch(
      /looks like a URL/,
    );
    expect(webhookSecretProblem("http://localhost:3000/api/webhooks/razorpay")).toMatch(
      /looks like a URL/,
    );
  });

  it("rejects reusing the API key secret", () => {
    expect(webhookSecretProblem(GOOD, GOOD)).toMatch(/must differ/);
  });

  it("rejects a secret short enough to guess", () => {
    expect(webhookSecretProblem("hunter2")).toMatch(/too short/);
  });

  it("accepts a long random secret", () => {
    expect(webhookSecretProblem(GOOD, "some_other_key_secret")).toBeNull();
  });

  it("never echoes the value it rejected", () => {
    const secret = "https://thecadpillar.com/api/webhooks/razorpay";
    expect(webhookSecretProblem(secret)).not.toContain(secret);
  });
});

describe("readRazorpayConfig", () => {
  const base = {
    NODE_ENV: "test",
    RAZORPAY_KEY_ID: "rzp_test_x",
    RAZORPAY_KEY_SECRET: "key_secret_value",
  } satisfies Partial<NodeJS.ProcessEnv>;

  it("refuses to start with an unsafe webhook secret", () => {
    expect(() =>
      readRazorpayConfig({
        ...base,
        RAZORPAY_WEBHOOK_SECRET: "https://example.com/api/webhooks/razorpay",
      }),
    ).toThrow(/looks like a URL/);
  });

  it("returns the config when every value is sound", () => {
    const config = readRazorpayConfig({
      ...base,
      RAZORPAY_WEBHOOK_SECRET: GOOD,
    });
    expect(config).toEqual({
      keyId: "rzp_test_x",
      keySecret: "key_secret_value",
      webhookSecret: GOOD,
    });
  });
});
