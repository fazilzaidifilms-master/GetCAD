"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  JEWELRY_CATEGORY_LABELS,
  JEWELRY_CATEGORY_OPTIONS,
  PORTFOLIO_MAX_FILES,
  PORTFOLIO_MIN_FILES,
  PRIMARY_SOFTWARE_LABELS,
  PRIMARY_SOFTWARE_OPTIONS,
  designerApplicationFieldsSchema,
  portfolioFilesError,
} from "@/lib/validation/designerApplication";

import { submitDesignerApplicationAction } from "./actions";

const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Italy",
  "Turkey",
  "Thailand",
  "China",
  "Hong Kong",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "South Africa",
  "Israel",
  "Singapore",
  "Other",
];

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

// react-hook-form's field values are the pre-coercion shape (yearsExperience
// arrives from the DOM as a string); the resolver's output — what onValid
// receives — is the post-coercion shape from the shared Zod schema.
type FormInput = z.input<typeof designerApplicationFieldsSchema>;
type FormOutput = z.output<typeof designerApplicationFieldsSchema>;

export function DesignerApplicationForm() {
  const router = useRouter();
  const [portfolioFiles, setPortfolioFiles] = useState<File[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(designerApplicationFieldsSchema),
    defaultValues: { portfolioType: "url", categories: [], portfolioUrl: "" },
  });

  const portfolioType = watch("portfolioType");

  async function onValid(values: FormOutput) {
    setServerError(null);

    if (values.portfolioType === "files") {
      const fileErr = portfolioFilesError(portfolioFiles);
      if (fileErr) {
        setServerError(fileErr);
        return;
      }
    }

    setSubmitting(true);
    const fd = new FormData();
    fd.set("fullName", values.fullName);
    fd.set("email", values.email);
    fd.set("phone", values.phone);
    fd.set("country", values.country);
    fd.set("yearsExperience", String(values.yearsExperience));
    fd.set("primarySoftware", values.primarySoftware);
    values.categories.forEach((c) => fd.append("categories", c));
    fd.set("portfolioType", values.portfolioType);
    if (values.portfolioType === "url") {
      fd.set("portfolioUrl", values.portfolioUrl ?? "");
    } else {
      portfolioFiles.forEach((f) => fd.append("portfolioFiles", f));
    }

    const result = await submitDesignerApplicationAction(fd);
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    router.push("/apply-designer?submitted=1");
  }

  return (
    <form onSubmit={handleSubmit(onValid)} className="mt-8 space-y-6" noValidate>
      {/* 1. Full name */}
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" {...register("fullName")} />
        {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
      </div>

      {/* 2. Email + phone */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" type="tel" {...register("phone")} />
          {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
        </div>
      </div>

      {/* 3. Country */}
      <div className="space-y-1.5">
        <Label htmlFor="country">Country</Label>
        <select id="country" defaultValue="" className={selectCls} {...register("country")}>
          <option value="" disabled>
            Select your country
          </option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {errors.country && <p className="text-sm text-destructive">{errors.country.message}</p>}
      </div>

      {/* 4. Years of CAD experience */}
      <div className="space-y-1.5">
        <Label htmlFor="yearsExperience">Years of CAD experience</Label>
        <Input id="yearsExperience" type="number" min={0} max={60} {...register("yearsExperience")} />
        {errors.yearsExperience && (
          <p className="text-sm text-destructive">{errors.yearsExperience.message}</p>
        )}
      </div>

      {/* 5. Primary software */}
      <div className="space-y-1.5">
        <Label htmlFor="primarySoftware">Primary software</Label>
        <select id="primarySoftware" defaultValue="" className={selectCls} {...register("primarySoftware")}>
          <option value="" disabled>
            Select your primary software
          </option>
          {PRIMARY_SOFTWARE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {PRIMARY_SOFTWARE_LABELS[opt]}
            </option>
          ))}
        </select>
        {errors.primarySoftware && (
          <p className="text-sm text-destructive">{errors.primarySoftware.message}</p>
        )}
      </div>

      {/* 6. Jewelry categories */}
      <div className="space-y-1.5">
        <Label>Jewelry categories you design</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {JEWELRY_CATEGORY_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={opt} className="accent-primary" {...register("categories")} />
              {JEWELRY_CATEGORY_LABELS[opt]}
            </label>
          ))}
        </div>
        {errors.categories && <p className="text-sm text-destructive">{errors.categories.message}</p>}
      </div>

      {/* 7. Portfolio */}
      <div className="space-y-3">
        <Label>Portfolio</Label>
        <div className="flex gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="url"
              defaultChecked
              className="accent-primary"
              {...register("portfolioType")}
            />
            Link to portfolio
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" value="files" className="accent-primary" {...register("portfolioType")} />
            Upload files
          </label>
        </div>

        {portfolioType === "files" ? (
          <div className="space-y-1.5">
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.zip"
              onChange={(e) => setPortfolioFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Upload {PORTFOLIO_MIN_FILES}–{PORTFOLIO_MAX_FILES} files (PDF, PNG, JPEG, or ZIP).
              {portfolioFiles.length > 0 ? ` ${portfolioFiles.length} selected.` : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Input placeholder="https://" {...register("portfolioUrl")} />
            {errors.portfolioUrl && (
              <p className="text-sm text-destructive">{errors.portfolioUrl.message}</p>
            )}
          </div>
        )}
      </div>

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {serverError}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
