"use server";

import { revalidatePath } from "next/cache";

import { generateId, sanitizeUpload, RELEASE_KINDS, REVIEW_KINDS, type FileKind } from "@/core";
import { ORDER_FILES_BUCKET } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Upload a file to an order. EVERY byte goes through the single sanitization
 * gate before it is stored. Storage write uses the service role (post-gate,
 * trusted); the version is recorded AS THE USER so the participant check +
 * audit run under their identity.
 */
/**
 * Kinds a form is allowed to name.
 *
 * A Server Action receives whatever the caller posts, so the `kind` field is
 * input, not a choice made by the select box. An unrecognised value must not
 * reach the database as text; and defaulting a bad one to something in the
 * review set would let a crafted post put a deliverable where the client can
 * download it before approving. OTHER is the safe fallback because the gate
 * withholds it.
 */
const ACCEPTED_KINDS = new Set<string>([...REVIEW_KINDS, ...RELEASE_KINDS, "CLIENT_REFERENCE"]);

function readKind(formData: FormData): FileKind {
  const raw = formData.get("kind")?.toString() ?? "";
  return ACCEPTED_KINDS.has(raw) ? (raw as FileKind) : "OTHER";
}

export async function uploadFileAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const kind = readKind(formData);
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
    // The database has the last word on whether this party may claim this kind
    // — a client cannot post 'STL' and have it land in the release set.
    p_kind: kind,
  });
  if (error) {
    // Not a participant (or other failure) — remove the orphaned object.
    await admin.storage.from(ORDER_FILES_BUCKET).remove([objectKey]);
    throw new Error(error.message);
  }

  revalidatePath("/orders");
}
