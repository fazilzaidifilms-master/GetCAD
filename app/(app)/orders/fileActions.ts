"use server";

import { revalidatePath } from "next/cache";

import { generateId, sanitizeUpload } from "@/core";
import { ORDER_FILES_BUCKET } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Upload a file to an order. EVERY byte goes through the single sanitization
 * gate before it is stored. Storage write uses the service role (post-gate,
 * trusted); the version is recorded AS THE USER so the participant check +
 * audit run under their identity.
 */
export async function uploadFileAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("no file provided");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const opaqueId = generateId();
  // This is the DOUBLE-BLIND delivery path: the client downloads what the
  // designer uploads, so identifying metadata inside the bytes (EXIF, PNG text
  // chunks, STEP author/organisation) must be removed, not just the filename.
  const gate = sanitizeUpload(
    {
      filename: file.name,
      declaredMimeType: file.type,
      sizeBytes: file.size,
      bytes,
    },
    opaqueId,
    { requireMetadataStrip: true },
  );
  if (!gate.ok) {
    throw new Error(`rejected by sanitization gate: ${gate.reason}`);
  }

  const objectKey = `${orderId}/${gate.file.objectName}`;

  const admin = createAdminSupabaseClient();
  // Store the CLEANED bytes, never the caller's original buffer.
  const up = await admin.storage
    .from(ORDER_FILES_BUCKET)
    .upload(objectKey, gate.file.bytes, { contentType: gate.file.contentType, upsert: false });
  if (up.error) {
    throw new Error(`storage upload failed: ${up.error.message}`);
  }

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("add_file_version", {
    p_id: generateId(),
    p_order_id: orderId,
    p_object_key: objectKey,
    p_content_type: gate.file.contentType,
    p_size_bytes: gate.file.sizeBytes,
  });
  if (error) {
    // Not a participant (or other failure) — remove the orphaned object.
    await admin.storage.from(ORDER_FILES_BUCKET).remove([objectKey]);
    throw new Error(error.message);
  }

  revalidatePath("/orders");
}
