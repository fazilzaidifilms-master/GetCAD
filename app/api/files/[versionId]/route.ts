import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { ORDER_FILES_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Download a file version via a SHORT-TTL SIGNED URL (files are never public).
 *
 * Authorization is done through RLS: we look up the version with the USER's
 * client, so it is returned only if the caller may read its order. Only then do
 * we mint a signed URL with the service role and redirect to it.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ versionId: string }> },
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { versionId } = await ctx.params;

  const supabase = await createUserSupabaseClient();
  const { data, error } = await supabase
    .from("file_versions")
    .select("object_key")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = createAdminSupabaseClient();
  const signed = await admin.storage
    .from(ORDER_FILES_BUCKET)
    .createSignedUrl(data.object_key as string, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data) {
    return NextResponse.json({ error: "could not sign url" }, { status: 500 });
  }

  return NextResponse.redirect(signed.data.signedUrl);
}
