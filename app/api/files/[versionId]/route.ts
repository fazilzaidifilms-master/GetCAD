import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { fileGrantFor, type FileKind } from "@/core";
import { ORDER_FILES_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/config/supabase";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Download a file version via a SHORT-TTL SIGNED URL (files are never public).
 *
 * TWO CHECKS, NOT ONE. RLS decides whether this row is visible to the caller at
 * all — it runs on the user's client below, so a stranger's request finds
 * nothing. But visibility is not entitlement: a client can see that their order
 * has an STL long before they have bought it. `fileGrantFor` is the second
 * check, and it is the one the escrow rests on.
 *
 * This is also the ONLY place a signed URL is minted. That is on purpose: a
 * signed URL is a bearer token for the object, so the moment two routes can
 * mint one, the gate has two doors and only one of them is tested.
 *
 * A WITHHELD file answers 404, not 403. The UI already tells the client what
 * they have and what unlocks it, in a place where the sentence makes sense; a
 * 403 from the API adds nothing there and, for everyone else, confirms that a
 * given version id exists. On a platform whose whole premise is that the two
 * sides cannot see each other, "this exists but you may not have it" is worth
 * more to an attacker than it is to a user.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ versionId: string }> },
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { versionId } = await ctx.params;
  const notFound = NextResponse.json({ error: "not found" }, { status: 404 });

  const supabase = await createUserSupabaseClient();
  const { data: version, error } = await supabase
    .from("file_versions")
    .select("object_key, order_id, kind, uploaded_by")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !version) return notFound;

  // Both under RLS, so an order the caller cannot see comes back null and the
  // request ends here rather than in the gate.
  const [orderRes, meRes] = await Promise.all([
    supabase
      .from("orders")
      .select("status, client_id, designer_id")
      .eq("id", version.order_id as string)
      .maybeSingle(),
    supabase.from("users").select("id, role").maybeSingle(),
  ]);
  if (orderRes.error || !orderRes.data || meRes.error || !meRes.data) return notFound;

  const order = orderRes.data as { status: string; client_id: string | null; designer_id: string | null };
  const me = meRes.data as { id: string; role: string };

  const grant = fileGrantFor({
    orderStatus: order.status,
    role: me.role,
    isOrderClient: order.client_id === me.id,
    isOrderDesigner: order.designer_id === me.id,
    isUploader: version.uploaded_by === me.id,
    fileKind: version.kind as FileKind,
  });
  if (grant !== "ALLOW") return notFound;

  const admin = createAdminSupabaseClient();
  const signed = await admin.storage
    .from(ORDER_FILES_BUCKET)
    .createSignedUrl(version.object_key as string, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data) {
    return NextResponse.json({ error: "could not sign url" }, { status: 500 });
  }

  return NextResponse.redirect(signed.data.signedUrl);
}
