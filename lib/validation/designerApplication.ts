// Shared Zod schema for the Stage-1 designer application form — imported by
// both the client form (react-hook-form resolver, instant field feedback) and
// the server action (defense-in-depth re-validation before the DB call).

import { z } from "zod";

export const PRIMARY_SOFTWARE_OPTIONS = ["RHINO", "MATRIX", "3DESIGN", "OTHER"] as const;
export type PrimarySoftware = (typeof PRIMARY_SOFTWARE_OPTIONS)[number];

export const PRIMARY_SOFTWARE_LABELS: Record<PrimarySoftware, string> = {
  RHINO: "Rhino",
  MATRIX: "Matrix",
  "3DESIGN": "3Design",
  OTHER: "Other",
};

export const JEWELRY_CATEGORY_OPTIONS = [
  "RINGS",
  "PENDANTS",
  "EARRINGS",
  "BRACELETS",
  "BANGLES",
] as const;
export type JewelryCategory = (typeof JEWELRY_CATEGORY_OPTIONS)[number];

export const JEWELRY_CATEGORY_LABELS: Record<JewelryCategory, string> = {
  RINGS: "Rings",
  PENDANTS: "Pendants",
  EARRINGS: "Earrings",
  BRACELETS: "Bracelets",
  BANGLES: "Bangles",
};

export const PORTFOLIO_MIN_FILES = 2;
export const PORTFOLIO_MAX_FILES = 3;

export const designerApplicationFieldsSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required").max(200, "Full name is too long"),
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
    phone: z.string().trim().min(3, "Phone number is required").max(40, "Phone number is too long"),
    country: z.string().trim().min(1, "Select your country"),
    yearsExperience: z.coerce
      .number({ error: "Enter your years of CAD experience" })
      .int("Enter a whole number")
      .min(0, "Must be 0 or more")
      .max(60, "That doesn't look right"),
    primarySoftware: z.enum(PRIMARY_SOFTWARE_OPTIONS, "Select your primary software"),
    categories: z.array(z.enum(JEWELRY_CATEGORY_OPTIONS)).min(1, "Select at least one category"),
    portfolioType: z.enum(["url", "files"]),
    portfolioUrl: z.string().trim().optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.portfolioType === "url") {
      if (!data.portfolioUrl) {
        ctx.addIssue({ code: "custom", message: "Portfolio URL is required", path: ["portfolioUrl"] });
      } else if (!/^https?:\/\/.+/i.test(data.portfolioUrl)) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid URL starting with http:// or https://",
          path: ["portfolioUrl"],
        });
      }
    }
  });

export type DesignerApplicationFields = z.infer<typeof designerApplicationFieldsSchema>;

/** File-count check for the "files" portfolio path — kept outside Zod since
 * File/FileList don't serialize consistently across the client/server boundary. */
export function portfolioFilesError(files: { length: number }): string | null {
  if (files.length < PORTFOLIO_MIN_FILES) return `Upload at least ${PORTFOLIO_MIN_FILES} portfolio files`;
  if (files.length > PORTFOLIO_MAX_FILES) return `Upload at most ${PORTFOLIO_MAX_FILES} portfolio files`;
  return null;
}
