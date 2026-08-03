"use server";

import { revalidatePath } from "next/cache";

import { generateId, sanitizeUpload } from "@/core";
import { ORDER_FILES_BUCKET } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Attach a reference picture to an order.
 *
 * These are the most identity-rich bytes in the whole system. A phone photo
 * carries EXIF with GPS coordinates, a camera serial number, and frequently an
 * owner name — and the designer is going to look at this image. So it goes
 * through the SAME sanitization gate as a deliverable, with metadata stripping
 * required, and what lands in storage is a re-encoded file under an opaque key.
 *
 * The original filename is discarded rather than stored. "our-logo-final-v2.jpg"
 * would put a company name in the one artefact both sides can see.
 */
export async function addReferenceImageAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const opaqueId = generateId();

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

  const objectKey = `${orderId}/refs/${gate.file.objectName}`;
  const admin = createAdminSupabaseClient();
  const up = await admin.storage
    .from(ORDER_FILES_BUCKET)
    .upload(objectKey, gate.file.bytes, { contentType: gate.file.contentType, upsert: false });
  if (up.error) throw new Error(`storage upload failed: ${up.error.message}`);

  // Recorded AS THE USER, so ownership and the quote freeze are checked under
  // their identity rather than the service role's.
  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("add_reference_image", {
    p_order_id: orderId,
    p_object_key: objectKey,
    p_content_type: gate.file.contentType,
    p_size_bytes: gate.file.sizeBytes,
  });
  if (error) {
    // Refused — remove the object rather than leave it orphaned in the bucket.
    await admin.storage.from(ORDER_FILES_BUCKET).remove([objectKey]);
    throw new Error(error.message);
  }

  revalidatePath(`/orders/${orderId}/brief`);
}

/** Replace every pin on one picture. Coordinates arrive as basis points. */
export async function setPinsAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const imageId = formData.get("image_id")?.toString() ?? "";

  const xs = formData.getAll("pin_x").map((v) => Math.round(Number(v) || 0));
  const ys = formData.getAll("pin_y").map((v) => Math.round(Number(v) || 0));
  const labels = formData.getAll("pin_label").map(String);

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("set_reference_pins", {
    p_image_id: imageId,
    p_xs: xs,
    p_ys: ys,
    p_labels: labels,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/orders/${orderId}/brief`);
}

/** Nominate the picture the designer starts from. */
export async function setPrimaryReferenceAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const imageId = formData.get("image_id")?.toString() ?? "";

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("set_primary_reference", { p_image_id: imageId });
  if (error) throw new Error(error.message);

  revalidatePath(`/orders/${orderId}/brief`);
}

/**
 * Remove a picture.
 *
 * The row goes first and the object second. If the row delete is refused —
 * wrong owner, order already quoted — the bytes are still there and nothing was
 * lost. The other order risks deleting bytes that a surviving row still points
 * at, which is the version of this that shows a broken image forever.
 */
export async function removeReferenceImageAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const imageId = formData.get("image_id")?.toString() ?? "";

  const supabase = await createUserSupabaseClient();
  const { data: row } = await supabase
    .from("order_reference_images")
    .select("object_key")
    .eq("id", imageId)
    .maybeSingle();

  const { error } = await supabase.rpc("remove_reference_image", { p_image_id: imageId });
  if (error) throw new Error(error.message);

  if (row?.object_key) {
    await createAdminSupabaseClient()
      .storage.from(ORDER_FILES_BUCKET)
      .remove([row.object_key as string]);
  }

  revalidatePath(`/orders/${orderId}/brief`);
}
