import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseCapturedPayment,
  parseTransferEvent,
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

/**
 * Test AZ — transfer webhooks, the authoritative word on whether a designer
 * was actually paid.
 *
 * The parser is the boundary between attacker-shaped JSON and a function that
 * moves money in our ledger, so the rule it enforces matters more than the
 * fields it extracts: a transfer carrying no payout key of OURS is ignored
 * outright rather than matched by amount.
 */
function transferEvent(
  event = "transfer.processed",
  entity: Record<string, unknown> = {},
): unknown {
  return {
    event,
    payload: {
      transfer: {
        entity: {
          id: "trf_ABC123",
          amount: 600,
          currency: "INR",
          status: "processed",
          notes: { payout_key: "payout:leg-1" },
          ...entity,
        },
      },
    },
  };
}

describe("Test AZ — transfer event parsing", () => {
  it("maps each transfer event to the outcome we record", () => {
    expect(parseTransferEvent(transferEvent("transfer.processed"))?.outcome).toBe("PAID");
    expect(parseTransferEvent(transferEvent("transfer.failed"))?.outcome).toBe("FAILED");
    expect(parseTransferEvent(transferEvent("transfer.reversed"))?.outcome).toBe("REVERSED");
  });

  it("extracts the transfer id and OUR payout key", () => {
    expect(parseTransferEvent(transferEvent())).toEqual({
      transferId: "trf_ABC123",
      payoutKey: "payout:leg-1",
      outcome: "PAID",
      amount: 600,
      currency: "INR",
      failureReason: null,
    });
  });

  it("IGNORES a transfer with no payout key of ours", () => {
    // This is the important one. A transfer we did not create must never be
    // able to resolve a payout we did — and matching on amount would let it.
    expect(parseTransferEvent(transferEvent("transfer.processed", { notes: {} }))).toBeNull();
    expect(
      parseTransferEvent(transferEvent("transfer.processed", { notes: undefined })),
    ).toBeNull();
    expect(
      parseTransferEvent(transferEvent("transfer.processed", { notes: { payout_key: 42 } })),
    ).toBeNull();
  });

  it("carries the processor's failure description through when there is one", () => {
    const parsed = parseTransferEvent(
      transferEvent("transfer.failed", { error: { description: "beneficiary name mismatch" } }),
    );
    expect(parsed?.failureReason).toBe("beneficiary name mismatch");
  });

  it("ignores events we do not act on", () => {
    expect(parseTransferEvent(transferEvent("transfer.created"))).toBeNull();
    expect(parseTransferEvent({ event: "payment.captured", payload: {} })).toBeNull();
  });

  it("rejects a non-integer, zero or negative amount", () => {
    for (const amount of [0, -1, 12.5, "600"]) {
      expect(parseTransferEvent(transferEvent("transfer.processed", { amount }))).toBeNull();
    }
  });

  it("survives junk input without throwing", () => {
    for (const junk of [null, undefined, "", 42, [], { event: "transfer.processed" }]) {
      expect(parseTransferEvent(junk)).toBeNull();
    }
  });
});
