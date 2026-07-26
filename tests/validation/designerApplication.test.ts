import { describe, expect, it } from "vitest";

import {
  JEWELRY_CATEGORY_OPTIONS,
  PRIMARY_SOFTWARE_OPTIONS,
  designerApplicationFieldsSchema,
  portfolioFilesError,
} from "@/lib/validation/designerApplication";

/**
 * Test AQ3 — the shared client/server validation schema.
 *
 * This schema is the validation source of truth for a PUBLIC, unauthenticated
 * form and is re-run server-side as defence in depth, yet it had no tests at
 * all. The DB function re-validates too, but a schema bug here means a real
 * applicant hits a raw Postgres error instead of a field message.
 */
const VALID = {
  fullName: "Jane Designer",
  email: "jane@example.com",
  phone: "+1 555 0100",
  country: "India",
  yearsExperience: "5",
  primarySoftware: "RHINO",
  categories: ["RINGS"],
  portfolioType: "url",
  portfolioUrl: "https://portfolio.example.com/jane",
};

describe("Test AQ3 — designer application schema", () => {
  it("accepts a valid URL-portfolio application and coerces years to a number", () => {
    const r = designerApplicationFieldsSchema.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.yearsExperience).toBe(5);
      expect(typeof r.data.yearsExperience).toBe("number");
    }
  });

  it("trims whitespace on free-text fields", () => {
    const r = designerApplicationFieldsSchema.safeParse({
      ...VALID,
      fullName: "  Jane Designer  ",
      email: "  jane@example.com  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fullName).toBe("Jane Designer");
      expect(r.data.email).toBe("jane@example.com");
    }
  });

  it("rejects a missing name, a bad email, and a blank country", () => {
    expect(designerApplicationFieldsSchema.safeParse({ ...VALID, fullName: "" }).success).toBe(false);
    expect(designerApplicationFieldsSchema.safeParse({ ...VALID, email: "nope" }).success).toBe(false);
    expect(designerApplicationFieldsSchema.safeParse({ ...VALID, country: "" }).success).toBe(false);
  });

  it("rejects years of experience outside 0-60 and non-integers", () => {
    for (const bad of ["-1", "61", "5.5", "abc"]) {
      expect(designerApplicationFieldsSchema.safeParse({ ...VALID, yearsExperience: bad }).success).toBe(
        false,
      );
    }
    for (const ok of ["0", "60"]) {
      expect(designerApplicationFieldsSchema.safeParse({ ...VALID, yearsExperience: ok }).success).toBe(
        true,
      );
    }
  });

  it("requires at least one category and rejects unknown ones", () => {
    expect(designerApplicationFieldsSchema.safeParse({ ...VALID, categories: [] }).success).toBe(false);
    expect(
      designerApplicationFieldsSchema.safeParse({ ...VALID, categories: ["WATCHES"] }).success,
    ).toBe(false);
    expect(
      designerApplicationFieldsSchema.safeParse({ ...VALID, categories: [...JEWELRY_CATEGORY_OPTIONS] })
        .success,
    ).toBe(true);
  });

  it("accepts every declared primary software and rejects others", () => {
    for (const sw of PRIMARY_SOFTWARE_OPTIONS) {
      expect(designerApplicationFieldsSchema.safeParse({ ...VALID, primarySoftware: sw }).success).toBe(
        true,
      );
    }
    expect(
      designerApplicationFieldsSchema.safeParse({ ...VALID, primarySoftware: "ZBRUSH" }).success,
    ).toBe(false);
  });

  it("requires a well-formed URL only on the url portfolio path", () => {
    expect(designerApplicationFieldsSchema.safeParse({ ...VALID, portfolioUrl: "" }).success).toBe(false);
    expect(
      designerApplicationFieldsSchema.safeParse({ ...VALID, portfolioUrl: "portfolio.example.com" })
        .success,
    ).toBe(false);
    // On the files path the URL is irrelevant and must not be demanded.
    expect(
      designerApplicationFieldsSchema.safeParse({ ...VALID, portfolioType: "files", portfolioUrl: "" })
        .success,
    ).toBe(true);
  });

  it("enforces the 2-3 file window on the files portfolio path", () => {
    expect(portfolioFilesError({ length: 0 })).toMatch(/at least 2/i);
    expect(portfolioFilesError({ length: 1 })).toMatch(/at least 2/i);
    expect(portfolioFilesError({ length: 2 })).toBeNull();
    expect(portfolioFilesError({ length: 3 })).toBeNull();
    expect(portfolioFilesError({ length: 4 })).toMatch(/at most 3/i);
  });
});
