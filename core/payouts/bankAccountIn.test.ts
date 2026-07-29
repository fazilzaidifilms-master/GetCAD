import { describe, expect, it } from "vitest";

import {
  maskAccountNumber,
  maskFromLast4,
  maskPan,
  normalizeAccountNumber,
  normalizeIfsc,
  normalizePan,
  panHolderType,
  validateBankAccount,
} from "./bankAccountIn";

/**
 * Test AX — Indian bank payout identity.
 *
 * The rules here are duplicated as CHECK constraints in 0023 on purpose
 * (defence in depth), which means they can drift. These cases are the
 * specification both copies are held to; `tests/db/payout_accounts.test.ts`
 * asserts the same shapes against the database.
 */
const VALID = {
  beneficiaryName: "Dana Designer",
  pan: "ABCDE1234F",
  accountNumber: "123456789012",
  confirmAccountNumber: "123456789012",
  ifsc: "HDFC0001234",
  accountType: "SAVINGS",
};

describe("Test AX1 — normalization matches what people actually paste", () => {
  it("uppercases and strips whitespace from PAN and IFSC", () => {
    expect(normalizePan(" abcde 1234 f ")).toBe("ABCDE1234F");
    expect(normalizeIfsc("hdfc 0001234")).toBe("HDFC0001234");
  });

  it("strips the spaces and hyphens banks print account numbers with", () => {
    expect(normalizeAccountNumber("1234-5678 9012")).toBe("123456789012");
  });
});

describe("Test AX2 — validation", () => {
  it("accepts a well-formed account and returns it normalized", () => {
    const r = validateBankAccount({ ...VALID, pan: "abcde1234f", ifsc: "hdfc0001234" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pan).toBe("ABCDE1234F");
      expect(r.value.ifsc).toBe("HDFC0001234");
      expect(r.value.accountType).toBe("SAVINGS");
    }
  });

  it("collapses runs of whitespace in the beneficiary name", () => {
    const r = validateBankAccount({ ...VALID, beneficiaryName: "  Ravi   Kumar  " });
    expect(r.ok && r.value.beneficiaryName).toBe("Ravi Kumar");
  });

  it("rejects PANs of the wrong shape", () => {
    for (const bad of ["ABCD1234F", "ABCDE123F", "ABCDE12345", "ABCDE1234FG", "1BCDE1234F"]) {
      const r = validateBankAccount({ ...VALID, pan: bad });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors.pan).toBeDefined();
    }
  });

  it("rejects an IFSC whose fifth character is not the reserved zero", () => {
    const r = validateBankAccount({ ...VALID, ifsc: "HDFC1001234" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.ifsc).toBeDefined();
    expect(validateBankAccount({ ...VALID, ifsc: "HDFC0001234" }).ok).toBe(true);
  });

  it("rejects account numbers outside 9-18 digits, or containing letters", () => {
    for (const bad of ["12345678", "1".repeat(19), "12345678901X"]) {
      expect(validateBankAccount({ ...VALID, accountNumber: bad, confirmAccountNumber: bad }).ok).toBe(
        false,
      );
    }
    for (const ok of ["1".repeat(9), "1".repeat(18)]) {
      expect(validateBankAccount({ ...VALID, accountNumber: ok, confirmAccountNumber: ok }).ok).toBe(
        true,
      );
    }
  });

  it("catches a mistyped confirmation — the one error money cannot survive", () => {
    const r = validateBankAccount({ ...VALID, confirmAccountNumber: "123456789013" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.confirmAccountNumber).toMatch(/don't match/i);
  });

  it("treats differently-formatted but identical numbers as matching", () => {
    expect(validateBankAccount({ ...VALID, confirmAccountNumber: "1234 5678 9012" }).ok).toBe(true);
  });

  it("rejects an unknown account type", () => {
    expect(validateBankAccount({ ...VALID, accountType: "FIXED_DEPOSIT" }).ok).toBe(false);
  });

  it("reports every bad field at once rather than one at a time", () => {
    const r = validateBankAccount({
      beneficiaryName: "",
      pan: "nope",
      accountNumber: "12",
      confirmAccountNumber: "34",
      ifsc: "nope",
      accountType: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual([
      "accountNumber",
      "accountType",
      "beneficiaryName",
      "confirmAccountNumber",
      "ifsc",
      "pan",
    ]);
  });
});

describe("Test AX3 — masking never reconstructs the secret", () => {
  it("shows only the last four digits of an account number", () => {
    const masked = maskAccountNumber("123456789012");
    expect(masked.endsWith("9012")).toBe(true);
    expect(masked).not.toContain("12345678");
  });

  it("shows only the last four characters of a PAN", () => {
    expect(maskPan("ABCDE1234F")).toBe("••••••234F");
  });

  it("does not leak a short value by revealing all of it", () => {
    expect(maskAccountNumber("1234")).toBe("••••");
    expect(maskPan("AB")).toBe("••");
  });

  it("caps the mask width so an 18-digit account does not advertise its length", () => {
    expect(maskAccountNumber("1".repeat(18))).toHaveLength(14);
  });

  it("maskFromLast4 shows the fragment the server actually returns", () => {
    // Regression guard: the read path returns only "9012", and passing that to
    // maskAccountNumber correctly refuses to reveal a 4-char value — rendering
    // "••••" and hiding the digits the page exists to show.
    expect(maskAccountNumber("9012")).toBe("••••");
    expect(maskFromLast4("9012")).toBe("••••••9012");
    expect(maskFromLast4("234F")).toBe("••••••234F");
  });
});

describe("Test AX4 — PAN holder type is informational, never a gate", () => {
  it("reads the entity type from the fourth character", () => {
    expect(panHolderType("ABCPE1234F")).toBe("Individual");
    expect(panHolderType("ABCCE1234F")).toBe("Company");
  });

  it("returns Unknown rather than failing for a code not in our table", () => {
    expect(panHolderType("ABCZE1234F")).toBe("Unknown");
    // ...and such a PAN still validates, so a stale table cannot block a payout.
    expect(validateBankAccount({ ...VALID, pan: "ABCZE1234F" }).ok).toBe(true);
  });

  it("returns null for something that is not a PAN at all", () => {
    expect(panHolderType("nope")).toBeNull();
  });
});
