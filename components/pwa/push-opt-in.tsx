"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  deletePushSubscriptionAction,
  savePushSubscriptionAction,
} from "@/app/(app)/account/pushActions";

/**
 * Turning notifications on, on purpose.
 *
 * WHY THIS IS A BUTTON AND NOT A PROMPT ON LOAD. `Notification.requestPermission`
 * can be called once, meaningfully. A denial is close to permanent — the
 * browser will not ask again, and the user has to find a padlock icon in a
 * settings menu to undo it. Firing it at someone who has just arrived, before
 * they know what the app does, converts a large share of users into a state we
 * cannot recover from. So it sits on the account screen behind an explicit
 * press, next to the install hint, where someone goes when they are configuring
 * the app rather than using it.
 *
 * iOS. Safari grants push only to a web app that has been added to the home
 * screen — not in a browser tab, at all, with no API to detect the difference
 * beyond display-mode. Asking there produces a denial the user cannot undo
 * without deleting and reinstalling. So on iOS-in-a-tab this renders the
 * install instruction instead of the button, which is the honest answer.
 *
 * The subscription is written by a Server Action running as the user, so the
 * database decides who owns this device (see 0031 — a shared laptop must
 * transfer ownership on re-registration, or one person's lock screen shows
 * another's orders).
 */

type State =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "blocked"
  | "off"
  | "on"
  | "working";

/** VAPID keys are base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function PushOptIn({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  const readCurrentState = useCallback(async () => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      // iOS in a tab lands here too — Safari hides PushManager entirely until
      // the app is installed, so the more useful message wins.
      setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (isIos() && !isStandalone()) {
      setState("needs-install");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    setState(existing ? "on" : "off");
  }, []);

  useEffect(() => {
    void readCurrentState().catch(() => setState("unsupported"));
  }, [readCurrentState]);

  // The service worker cannot write to the database — it has no session — so
  // when a push service rotates our subscription it asks the page to re-register.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") void enable();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
    // `enable` is stable for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    setError(null);
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required to be true by every browser: a push must result in a visible
        // notification. Silent pushes are a tracking vector and are refused.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys?.auth || !json.endpoint) {
        throw new Error("the browser returned an incomplete subscription");
      }
      await savePushSubscriptionAction({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      });
      setState("on");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't turn on notifications.",
      );
      setState("off");
    }
  }

  async function disable() {
    setError(null);
    setState("working");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Tell the server FIRST. If unsubscribing locally succeeded and the
        // delete then failed, the row would linger with an endpoint that no
        // longer exists and the dispatcher would push into the void.
        await deletePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't turn off notifications.",
      );
      setState("on");
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[length:var(--fs-3)] leading-[var(--lh-3)] font-medium">
            Notifications on this device
          </p>
          <p className="mt-0.5 text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground">
            {state === "needs-install"
              ? "On iPhone and iPad, add the app to your home screen first — Safari only allows notifications for installed apps."
              : state === "blocked"
                ? "Blocked in your browser settings. Allow notifications for this site there, then come back."
                : state === "on"
                  ? "You'll be told when work is assigned, a message arrives, or an order is ready for you."
                  : "Get told when work is assigned, a message arrives, or an order is ready for you."}
          </p>
        </div>

        {state === "on" || state === "off" || state === "working" ? (
          <Button
            type="button"
            variant={state === "on" ? "outline" : "default"}
            size="sm"
            disabled={state === "working"}
            onClick={() => void (state === "on" ? disable() : enable())}
          >
            {state === "working"
              ? "Working…"
              : state === "on"
                ? "Turn off"
                : "Turn on"}
          </Button>
        ) : null}
      </div>

      {/* Said once, here, rather than in the notification itself — where it
          would be the disclosure it is warning about. */}
      {state === "on" ? (
        <p className="text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground">
          Notifications never name the other party or show amounts — they say
          only what happened, so nothing sensitive appears on a locked screen.
        </p>
      ) : null}

      {error ? (
        <p className="text-[length:var(--fs-2)] leading-[var(--lh-2)] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
