import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import type { Pin } from "@/core";
import { ORDER_FILES_BUCKET } from "@/config/supabase";
import { ErrorPanel } from "@/components/error-panel";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { BriefWizard, type AccentRow } from "./BriefWizard";
import { ReferenceSection, type ReferenceImage } from "./ReferenceSection";

/** Long enough to fill in a brief on a phone, short enough not to be a link. */
const REFERENCE_URL_TTL_SECONDS = 60 * 60;

/**
 * The brief for one order, at its own resumable URL.
 *
 * Its own route rather than a modal over the order: this is a long form on a
 * phone, and a person who closes the tab on step four should be able to come
 * back to it from their history rather than start again.
 */
export const dynamic = "force-dynamic";

interface SpecRow {
  reference_name: string;
  product: string;
  metal: string;
  karatage: string;
  purpose: string;
  format: string;
  finish: string;
  has_centre_stone: boolean;
  centre_shape: string | null;
  centre_setting: string | null;
  centre_quantity: number;
  centre_length_um: number | null;
  centre_width_um: number | null;
  centre_depth_um: number | null;
  centre_carat_mct: number | null;
  centre_certified: boolean;
}

interface ImageRow {
  id: string;
  object_key: string;
  is_primary: boolean;
  position: number;
  order_reference_pins: Array<{ x_bp: number; y_bp: number; label: string; position: number }> | null;
}

interface AccentDbRow {
  position: number;
  shape: string;
  width_um: number;
  quantity: number;
  setting: string;
}

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const [orderRes, specRes, accentsRes, imagesRes] = await Promise.all([
    supabase.from("orders").select("id, status, client_id").eq("id", id).maybeSingle(),
    supabase.from("order_specs").select("*").eq("order_id", id).maybeSingle(),
    supabase
      .from("order_spec_accents")
      .select("position, shape, width_um, quantity, setting")
      .eq("order_id", id)
      .order("position"),
    supabase
      .from("order_reference_images")
      .select("id, object_key, is_primary, position, order_reference_pins(x_bp, y_bp, label, position)")
      .eq("order_id", id)
      .order("position"),
  ]);

  if (orderRes.error) {
    return (
      <main className="container max-w-2xl py-8">
        <ErrorPanel title="Couldn't load this order" message={orderRes.error.message} />
      </main>
    );
  }

  const order = orderRes.data;
  if (!order) {
    return (
      <main className="container max-w-2xl py-8">
        <BackLink id={id} />
        <div className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-10)] text-center">
          <p className="text-[length:var(--fs-3)] leading-[var(--lh-3)] font-medium">Order not available</p>
          <p className="mt-1 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
            This order isn&apos;t visible to your role, or the reference is wrong.
          </p>
        </div>
      </main>
    );
  }

  // The same rule the database enforces, surfaced early: after a quote the
  // brief is what the price was calculated against. Showing an editable form
  // that the server would then refuse is a worse experience than saying so.
  const frozen = !["DRAFT", "SUBMITTED"].includes(order.status);
  const isOwner = order.client_id === userId;

  // Private bucket: each picture needs its own short-lived signed URL. Minted
  // with the service role because the browser session has no storage grant —
  // the ROW was already filtered by RLS, so this only signs what the viewer was
  // allowed to see.
  const admin = createAdminSupabaseClient();
  const images: ReferenceImage[] = [];
  for (const row of (imagesRes.data ?? []) as ImageRow[]) {
    const { data: signed } = await admin.storage
      .from(ORDER_FILES_BUCKET)
      .createSignedUrl(row.object_key, REFERENCE_URL_TTL_SECONDS);
    if (!signed?.signedUrl) continue;
    images.push({
      id: row.id,
      signedUrl: signed.signedUrl,
      isPrimary: row.is_primary,
      pins: (row.order_reference_pins ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((p): Pin => ({ xBp: p.x_bp, yBp: p.y_bp, label: p.label })),
    });
  }

  const pinnedImageCount = images.filter((i) => i.pins.length > 0).length;

  const spec = specRes.data as SpecRow | null;
  const accents: AccentRow[] = ((accentsRes.data ?? []) as AccentDbRow[]).map((a) => ({
    shape: a.shape,
    setting: a.setting,
    widthMm: String(a.width_um / 1000),
    quantity: String(a.quantity),
  }));

  return (
    <main className="container max-w-2xl py-8">
      <BackLink id={id} />

      <h1 className="mt-4 text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
        The brief
      </h1>
      <p className="mt-1 text-[length:var(--fs-3)] text-muted-foreground">
        What we are making. The more of this that is answered, the less a designer has to guess —
        and guessing is what a first version coming back wrong is made of.
      </p>

      <div className="mt-6">
        {isOwner ? (
          <BriefWizard
            orderId={id}
            readOnly={frozen}
            referenceImageCount={images.length}
            pinnedImageCount={pinnedImageCount}
            defaults={{
              referenceName: spec?.reference_name,
              product: spec?.product,
              metal: spec?.metal,
              karatage: spec?.karatage,
              purpose: spec?.purpose,
              format: spec?.format,
              finish: spec?.finish,
              hasCentreStone: spec?.has_centre_stone,
              centreShape: spec?.centre_shape,
              centreSetting: spec?.centre_setting,
              centreQuantity: spec?.centre_quantity,
              centreLengthUm: spec?.centre_length_um,
              centreWidthUm: spec?.centre_width_um,
              centreDepthUm: spec?.centre_depth_um,
              accents,
            }}
          />
        ) : (
          // A designer or staff member reading someone else's brief. Read-only
          // by construction: the write function refuses anyone but the client.
          <ReadOnlyBrief spec={spec} accents={accents} />
        )}
      </div>

      <ReferenceSection orderId={id} images={images} readOnly={frozen || !isOwner} />
    </main>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <Link
      href={`/orders/${id}`}
      className="inline-flex min-h-[var(--ctl)] items-center gap-1 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground transition-colors hover:text-foreground"
    >
      ← Back to the order
    </Link>
  );
}

const pretty = (v: string | null | undefined) =>
  v ? v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—";

function ReadOnlyBrief({ spec, accents }: { spec: SpecRow | null; accents: AccentRow[] }) {
  if (!spec) {
    return (
      <div className="rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-10)] text-center">
        <p className="text-[length:var(--fs-3)] leading-[var(--lh-3)] font-medium">No brief yet</p>
        <p className="mt-1 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
          The client has not filled this in.
        </p>
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    ["Piece", pretty(spec.product)],
    ["Metal", `${pretty(spec.metal)} · ${spec.karatage}`],
    ["Purpose", pretty(spec.purpose)],
    ["Output", spec.format === "THREE_DM" ? "3DM" : pretty(spec.format)],
    ["Finish", pretty(spec.finish)],
  ];

  if (spec.has_centre_stone) {
    const dims =
      spec.centre_length_um && spec.centre_width_um
        ? `${spec.centre_length_um / 1000} × ${spec.centre_width_um / 1000} mm`
        : spec.centre_carat_mct
          ? `${spec.centre_carat_mct / 1000} ct`
          : "size not given";
    rows.push([
      "Centre stone",
      `${spec.centre_quantity} × ${pretty(spec.centre_shape)}, ${dims}, ${pretty(spec.centre_setting)}${
        spec.centre_certified ? " · certified" : ""
      }`,
    ]);
  }

  for (const [i, a] of accents.entries()) {
    rows.push([`Accents ${i + 1}`, `${a.quantity} × ${pretty(a.shape)} ${a.widthMm} mm, ${pretty(a.setting)}`]);
  }

  return (
    <dl className="divide-y divide-border overflow-hidden rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)]">
      {rows.map(([k, v]) => (
        <div key={k} className="px-4 py-3">
          <dt className="text-[length:var(--fs-2)] uppercase tracking-[var(--ls-1)] text-muted-foreground">
            {k}
          </dt>
          <dd className="mt-0.5 text-[length:var(--fs-4)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
