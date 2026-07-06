"use server";

import { generateId, sanitizeUpload } from "@/core";
import { DESIGNER_APPLICATION_FILES_BUCKET } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { designerApplicationFieldsSchema, portfolioFilesError } from "@/lib/validation/designerApplication";

export type SubmitDesignerApplicationResult = { ok: true } | { ok: false; error: string };

/**
 * Stage 1 only: records a lead in `designer_applications`. Does NOT create a
 * users/designer_profiles row — conversion to a real designer account happens
 * manually, per-candidate, after staff review and a test order.
 */
export async function submitDesignerApplicationAction(
  formData: FormData,
): Promise<SubmitDesignerApplicationResult> {
  const raw = {
    fullName: formData.get("fullName")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    phone: formData.get("phone")?.toString() ?? "",
    country: formData.get("country")?.toString() ?? "",
    yearsExperience: formData.get("yearsExperience")?.toString() ?? "",
    primarySoftware: formData.get("primarySoftware")?.toString() ?? "",
    categories: formData.getAll("categories").map((v) => v.toString()),
    portfolioType: formData.get("portfolioType")?.toString() ?? "url",
    portfolioUrl: formData.get("portfolioUrl")?.toString() ?? "",
  };

  const parsed = designerApplicationFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const fields = parsed.data;

  const files = formData.getAll("portfolioFiles").filter((f): f is File => f instanceof File && f.size > 0);

  if (fields.portfolioType === "files") {
    const fileErr = portfolioFilesError(files);
    if (fileErr) return { ok: false, error: fileErr };
  }

  const applicationId = generateId();
  const admin = createAdminSupabaseClient();
  const uploadedKeys: string[] = [];

  try {
    if (fields.portfolioType === "files") {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const opaqueId = generateId();
        const gate = sanitizeUpload(
          {
            filename: file.name,
            declaredMimeType: file.type,
            sizeBytes: file.size,
            header: bytes.subarray(0, 16),
          },
          opaqueId,
        );
        if (!gate.ok) {
          return { ok: false, error: `One of the files couldn't be accepted: ${gate.reason}` };
        }

        const objectKey = `${applicationId}/${gate.file.objectName}`;
        const up = await admin.storage
          .from(DESIGNER_APPLICATION_FILES_BUCKET)
          .upload(objectKey, bytes, { contentType: gate.file.contentType, upsert: false });
        if (up.error) {
          return { ok: false, error: "Upload failed. Please try again." };
        }
        uploadedKeys.push(objectKey);
      }
    }

    const supabase = await createUserSupabaseClient();
    const { error } = await supabase.rpc("submit_designer_application", {
      p_id: applicationId,
      p_full_name: fields.fullName,
      p_email: fields.email,
      p_phone: fields.phone,
      p_country: fields.country,
      p_years_experience: fields.yearsExperience,
      p_primary_software: fields.primarySoftware,
      p_categories: fields.categories,
      p_portfolio_url: fields.portfolioType === "url" ? fields.portfolioUrl : null,
      p_portfolio_file_keys: fields.portfolioType === "files" ? uploadedKeys : null,
    });

    if (error) {
      if (uploadedKeys.length > 0) {
        await admin.storage.from(DESIGNER_APPLICATION_FILES_BUCKET).remove(uploadedKeys);
      }
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch {
    if (uploadedKeys.length > 0) {
      await admin.storage.from(DESIGNER_APPLICATION_FILES_BUCKET).remove(uploadedKeys);
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
