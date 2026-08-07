"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Tells you when the network is gone, before you find out by losing a form.
 *
 * THE FAILURE THIS FIXES. Every mutation in this app is a Server Action — a
 * POST. Submitted with no network it rejects with a generic fetch error, and
 * what the user sees is a button that did nothing, or an error that reads like
 * the platform broke. On a screen where the button says "Approve" or "Release
 * payment", "did that go through?" is a genuinely bad question to leave someone
 * holding. A visible, persistent bar answers it before they press anything.
 *
 * WHY THIS ONLY EVER WARNS, AND NEVER BLOCKS. `navigator.onLine` is trustworthy
 * in exactly one direction. False means there is definitively no network
 * interface. True means only that there IS one — a captive portal, a hotel
 * wifi that has not been paid for, or a phone with one bar all report true
 * while nothing reaches our origin. So `false` is worth showing, `true` proves
 * nothing, and neither is sound enough to disable a control on. Blocking
 * submission on this signal would sometimes stop a person completing work on a
 * connection that was fine.
 *
 * It also does not poll. A heartbeat to prove reachability would be a request
 * every few seconds from every open tab, forever, to answer a question the
 * user's next action answers for free.
 *
 * `className` exists for one reason: the sticky offset. This sits below the
 * header, and the header is not always the same height — on a phone it is 56px,
 * at desk width the sidebar has replaced it and there is nothing above this at
 * all. The shell owns that geometry, so the shell passes it in.
 */
export function ConnectionStatus({ className }: { className?: string }) {
  // Starts online: rendering an "offline" bar during hydration on a perfectly
  // good connection, for the split second before the event listener attaches,
  // is a worse lie than being briefly late to report a real outage.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      // `status` rather than `alert`: this is a state that persists, not an
      // interruption, and an assertive live region would talk over whatever a
      // screen-reader user was in the middle of reading.
      role="status"
      aria-live="polite"
      className={cn(
        "sticky z-20 border-b border-border bg-muted px-4 py-2 text-center",
        "text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground",
        className ?? "top-14",
      )}
    >
      You&apos;re offline. Nothing will save until you&apos;re back — anything you type stays on
      screen.
    </div>
  );
}
