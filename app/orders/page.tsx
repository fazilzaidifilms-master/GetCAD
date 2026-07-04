import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { availableTransitions, type TransitionRow } from "@/core";
import { Button } from "@/components/ui/button";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { createOrderAction, transitionAction } from "./actions";
import { uploadFileAction } from "./fileActions";

export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  product_type: string;
  status: string;
  client_id: string;
  designer_id: string | null;
}

interface VersionRow {
  id: string;
  order_id: string;
  version_no: number;
  content_type: string;
  size_bytes: number;
}

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self"); // ensure the caller has a users row

  const [meRes, ordersRes, transitionsRes, versionsRes] = await Promise.all([
    supabase.from("users").select("role").maybeSingle(),
    supabase
      .from("orders")
      .select("id, product_type, status, client_id, designer_id")
      .order("created_at", { ascending: false }),
    supabase.from("order_transitions").select("from_status, to_status, actor_role, actor_scope"),
    supabase
      .from("file_versions")
      .select("id, order_id, version_no, content_type, size_bytes")
      .order("version_no", { ascending: false }),
  ]);

  const role: string = meRes.data?.role ?? "CLIENT";
  const orders = (ordersRes.data ?? []) as OrderRow[];
  const transitions = (transitionsRes.data ?? []) as TransitionRow[];
  const versions = (versionsRes.data ?? []) as VersionRow[];

  return (
    <main className="container max-w-2xl py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
      </div>

      <form action={createOrderAction} className="mt-6 flex gap-2">
        <input
          name="product_type"
          defaultValue="CAD_MODEL"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          aria-label="Product type"
        />
        <Button type="submit">New order</Button>
      </form>

      <ul className="mt-6 space-y-3">
        {orders.length === 0 && (
          <li className="text-sm text-muted-foreground">No orders yet — create one above.</li>
        )}
        {orders.map((o) => {
          const actions = availableTransitions(o.status, transitions, {
            role,
            isOrderClient: o.client_id === userId,
            isOrderDesigner: o.designer_id === userId,
          });
          const isParticipant = o.client_id === userId || o.designer_id === userId;
          const orderVersions = versions.filter((v) => v.order_id === o.id);
          return (
            <li key={o.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-muted-foreground">{o.id}</p>
                  <p className="text-sm">
                    {o.product_type} · <span className="font-medium">{o.status}</span>
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {actions.length === 0 && (
                    <span className="text-xs text-muted-foreground">no actions</span>
                  )}
                  {actions.map((to) => (
                    <form key={to} action={transitionAction} className="flex items-center gap-1">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="to_status" value={to} />
                      {to === "ASSIGNED" && (
                        <input
                          name="designer_id"
                          placeholder="designer id"
                          className="w-28 rounded-md border px-2 py-1 text-xs"
                          aria-label="Designer id to assign"
                        />
                      )}
                      <Button type="submit" variant="outline" size="sm">
                        {to}
                      </Button>
                    </form>
                  ))}
                </div>
              </div>

              {(orderVersions.length > 0 || isParticipant) && (
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs text-muted-foreground">Files</p>
                  <ul className="mt-1 space-y-1">
                    {orderVersions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between text-sm">
                        <span>
                          v{v.version_no} · <span className="text-muted-foreground">{v.content_type}</span>
                        </span>
                        <a
                          href={`/api/files/${v.id}`}
                          className="text-xs text-muted-foreground underline hover:text-foreground"
                        >
                          Download
                        </a>
                      </li>
                    ))}
                    {orderVersions.length === 0 && (
                      <li className="text-xs text-muted-foreground">No files yet.</li>
                    )}
                  </ul>
                  {isParticipant && (
                    <form action={uploadFileAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input
                        type="file"
                        name="file"
                        required
                        className="text-xs"
                        aria-label="Upload a file"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Upload
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
