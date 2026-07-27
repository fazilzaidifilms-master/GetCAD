import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseCapturedPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpaySignature";

const WEBHOOK_SECRET = "whsec_test_secret";
const KEY_SECRET = "keysec_test_secret";

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

function capturedEvent(over: Record<string, unknown> = {}) {
  return {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_ABC123",
          order_id: "order_XYZ789",
          amount: 4500000,
          currency: "INR",
          notes: { order_id: "our_order_id_1" },
          ...over,
        },
      },
    },
  };
}

describe("Test AU1 — webhook signature", () => {
  const body = JSON.stringify(capturedEvent());

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(body, sign(WEBHOOK_SECRET, body), WEBHOOK_SECRET)).toBe(true);
  });

  it("REJECTS a tampered body — the attack this exists to stop", () => {
    const signature = sign(WEBHOOK_SECRET, body);
    // Attacker inflates the amount after the signature was produced.
    const tampered = body.replace("4500000", "1");
    expect(verifyWebhookSignature(tampered, signature, WEBHOOK_SECRET)).toBe(false);
  });

  it("REJECTS a signature made with the wrong secret", () => {
    // Notably: signing a webhook with the API KEY secret instead of the WEBHOOK
    // secret — the single most common Razorpay integration mistake.
    expect(verifyWebhookSignature(body, sign(KEY_SECRET, body), WEBHOOK_SECRET)).toBe(false);
  });

  it("REJECTS a missing, empty or non-hex signature", () => {
    expect(verifyWebhookSignature(body, null, WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "", WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex-at-all", WEBHOOK_SECRET)).toBe(false);
  });

  it("REJECTS when no secret is configured (fails closed)", () => {
    expect(verifyWebhookSignature(body, sign(WEBHOOK_SECRET, body), "")).toBe(false);
  });

  it("is sensitive to re-serialisation — why the RAW body must be used", () => {
    const signature = sign(WEBHOOK_SECRET, body);
    // Parsing and re-stringifying is lossy for signature purposes; this test
    // pins that fact so nobody 'tidies up' the route by parsing first.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWebhookSignature(reserialised, signature, WEBHOOK_SECRET)).toBe(false);
  });
});

describe("Test AU2 — checkout callback signature", () => {
  it("accepts the order|payment digest", () => {
    const sig = sign(KEY_SECRET, "order_XYZ789|pay_ABC123");
    expect(verifyCheckoutSignature("order_XYZ789", "pay_ABC123", sig, KEY_SECRET)).toBe(true);
  });

  it("REJECTS swapped ids (the digest is order-sensitive)", () => {
    const sig = sign(KEY_SECRET, "order_XYZ789|pay_ABC123");
    expect(verifyCheckoutSignature("pay_ABC123", "order_XYZ789", sig, KEY_SECRET)).toBe(false);
  });

  it("REJECTS missing inputs", () => {
    const sig = sign(KEY_SECRET, "order_XYZ789|pay_ABC123");
    expect(verifyCheckoutSignature("", "pay_ABC123", sig, KEY_SECRET)).toBe(false);
    expect(verifyCheckoutSignature("order_XYZ789", "pay_ABC123", null, KEY_SECRET)).toBe(false);
    expect(verifyCheckoutSignature("order_XYZ789", "pay_ABC123", sig, "")).toBe(false);
  });
});

describe("Test AU3 — parsing a captured payment", () => {
  it("extracts what the ledger needs, including OUR order id from notes", () => {
    expect(parseCapturedPayment(capturedEvent())).toEqual({
      paymentId: "pay_ABC123",
      razorpayOrderId: "order_XYZ789",
      orderId: "our_order_id_1",
      amount: 4500000,
      currency: "INR",
    });
  });

  it("ignores events we do not act on", () => {
    expect(parseCapturedPayment({ event: "payment.failed", payload: {} })).toBeNull();
    expect(parseCapturedPayment({ event: "order.paid", payload: {} })).toBeNull();
  });

  it("returns null rather than guessing when a required field is missing", () => {
    expect(parseCapturedPayment(capturedEvent({ notes: {} }))).toBeNull(); // no order_id
    expect(parseCapturedPayment(capturedEvent({ id: undefined }))).toBeNull();
    expect(parseCapturedPayment(capturedEvent({ order_id: undefined }))).toBeNull();
    expect(parseCapturedPayment(capturedEvent({ currency: undefined }))).toBeNull();
  });

  it("rejects a non-integer, zero or negative amount", () => {
    expect(parseCapturedPayment(capturedEvent({ amount: 0 }))).toBeNull();
    expect(parseCapturedPayment(capturedEvent({ amount: -100 }))).toBeNull();
    expect(parseCapturedPayment(capturedEvent({ amount: 12.5 }))).toBeNull();
    expect(parseCapturedPayment(capturedEvent({ amount: "4500000" }))).toBeNull();
  });

  it("survives junk input without throwing", () => {
    for (const junk of [null, undefined, "", 42, [], { event: "payment.captured" }]) {
      expect(parseCapturedPayment(junk)).toBeNull();
    }
  });
});
