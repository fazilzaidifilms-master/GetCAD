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
