import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATES, isEmailTemplate, renderEmail } from "./templates";

/**
 * Test BA — email content.
 *
 * The renderer is where the anonymity contract is checkable: a template gets
 * only the fields in its payload type, so it cannot name a counterparty it was
 * never handed. Every template in this slice is addressed to a person about
 * their own action, so the tests pin (1) the words are right, (2) a junk or
 * missing name never throws, and (3) both a text and an HTML part exist —
 * text/plain is what keeps a transactional email out of spam.
 */
describe("Test BA1 — designer application acknowledgement", () => {
  it("greets by first name and states what happens next", () => {
    const r = renderEmail("DESIGNER_APPLICATION_RECEIVED", { full_name: "Dana Q. Designer" });
    expect(r.subject).toMatch(/received your application/i);
    expect(r.text).toContain("Hi Dana,");
    expect(r.html).toContain("Hi Dana,");
    // Sets an honest expectation: review, then a paid test order. No timeline.
    expect(r.text).toMatch(/test order/i);
    expect(r.text).not.toMatch(/\b24 hours\b|\bguarantee\b/i);
  });

  it("falls back to a neutral greeting on a missing or blank name", () => {
    for (const full_name of [undefined, "", "   "]) {
      const r = renderEmail("DESIGNER_APPLICATION_RECEIVED", { full_name });
      expect(r.text).toContain("Hi there,");
    }
  });
});

describe("Test BA2 — contact acknowledgement", () => {
  it("greets by first name and promises a human reply", () => {
    const r = renderEmail("CONTACT_RECEIVED", { name: "Priya Sharma" });
    expect(r.subject).toMatch(/received your message/i);
    expect(r.text).toContain("Hi Priya,");
    expect(r.text).toMatch(/get back to you/i);
  });
});

describe("Test BA3 — every template is well-formed", () => {
  it("returns a subject and both parts for each declared template", () => {
    for (const template of EMAIL_TEMPLATES) {
      const r = renderEmail(template, {});
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.html).toMatch(/^<div/);
      // The shared shell: signed, and marked automated.
      expect(r.text).toContain("The CAD Pillar");
      expect(r.text).toMatch(/automated message/i);
    }
  });

  it("escapes HTML metacharacters in a supplied name", () => {
    const r = renderEmail("CONTACT_RECEIVED", { name: "<script>alert(1)</script> Mallory" });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("throws on an unknown template rather than sending a blank email", () => {
    // @ts-expect-error — deliberately an invalid template at the type boundary.
    expect(() => renderEmail("NOPE", {})).toThrow(/unknown email template/i);
  });
});

describe("Test BA4 — template guard", () => {
  it("recognises exactly the declared templates", () => {
    for (const t of EMAIL_TEMPLATES) expect(isEmailTemplate(t)).toBe(true);
    for (const bad of ["", "nope", 42, null, undefined, {}]) expect(isEmailTemplate(bad)).toBe(false);
  });
});

describe("Test BA5 — application decision emails", () => {
  it("accepts warmly and points at the paid test order, without over-promising", () => {
    const r = renderEmail("DESIGNER_APPLICATION_ACCEPTED", { full_name: "Dana Designer" });
    expect(r.subject).toMatch(/next steps/i);
    expect(r.text).toContain("Hi Dana,");
    expect(r.text).toMatch(/test order/i);
    expect(r.text).not.toMatch(/\bguarantee\b|\bwithin 24\b/i);
  });

  it("declines kindly and leaves the door open, without a reason that could sting", () => {
    const r = renderEmail("DESIGNER_APPLICATION_REJECTED", { full_name: "Sam" });
    expect(r.text).toContain("Hi Sam,");
    expect(r.text).toMatch(/not able to move forward|not a judgement/i);
    expect(r.text).toMatch(/apply again/i);
  });
});

describe("Test BA6 — payout sent email", () => {
  it("formats the amount in the payout currency and names no counterparty", () => {
    const r = renderEmail("PAYOUT_SENT", { amount_minor: 3000000, currency: "INR", order_ref: "ord_abc123" });
    expect(r.subject).toContain("₹30,000.00");
    expect(r.text).toContain("₹30,000.00");
    expect(r.text).toContain("ord_abc123");
    // The payee's own money for their own order — there is no client to name.
    expect(r.text).not.toMatch(/client|customer/i);
  });

  it("falls back to a bare greeting and a code for an unknown currency", () => {
    const r = renderEmail("PAYOUT_SENT", { amount_minor: 5000, currency: "AUD" });
    expect(r.text).toContain("Hi there,");
    expect(r.text).toContain("50.00 AUD");
  });

  it("does not crash on a missing amount", () => {
    const r = renderEmail("PAYOUT_SENT", {});
    expect(r.text).toMatch(/₹0\.00/);
  });
});
