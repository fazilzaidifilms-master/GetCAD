import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { startBriefAction } from "../[id]/brief/actions";
import { Button } from "@/components/ui/button";

/**
 * "New order" — a landing that exists mostly to be a bottom-nav destination.
 *
 * It creates the DRAFT and sends you into the brief rather than collecting
 * anything itself. Two screens asking for a name would be one too many, and the
 * order row has to exist before the brief can reference it anyway.
 */
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="container max-w-md py-12">
      <h1 className="text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
        Start a new order
      </h1>
      <p className="mt-2 text-[length:var(--fs-4)] leading-[var(--lh-4)] text-muted-foreground">
        Next you&apos;ll describe the piece. Nothing is committed and no price is set until you
        submit it — you can leave and come back to a half-finished brief.
      </p>

      <form action={startBriefAction} className="mt-8">
        <Button type="submit" className="min-h-[var(--ctl)] w-full">
          Describe the piece
        </Button>
      </form>
    </main>
  );
}
