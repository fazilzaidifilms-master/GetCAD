"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Offers to install the app — quietly, and only where it means something.
 *
 * It lives on the account screen rather than appearing as a banner over the
 * work. An interstitial asking to be installed before someone has decided the
 * app is useful is the most-dismissed pattern on the web, and dismissing it
 * once suppresses the real prompt for a long time. Better to be findable than
 * insistent.
 *
 * Two platforms, two mechanisms:
 *
 *   - Chrome/Android fires `beforeinstallprompt`, which must be stashed and
 *     replayed from a user gesture. Calling `prompt()` outside one is ignored.
 *   - Safari/iOS fires nothing and has no API at all, so the only honest
 *     option is telling people where the button is. This matters more than it
 *     sounds: on iOS, web push ONLY works once the app is on the home screen,
 *     so this text is a prerequisite for notifications ever arriving.
 *
 * Renders nothing when already installed.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallHint() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // `display-mode: standalone` is the cross-browser signal; `navigator.standalone`
    // is the older iOS-only one, and iOS still needs it.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const onPrompt = (event: Event) => {
      // Suppress Chrome's own mini-infobar so the offer appears here, once,
      // where the user went looking for it.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  if (deferred) {
    return (
      <Wrap>
        <p className="text-[length:var(--fs-3)] text-muted-foreground">
          Install The CAD Pillar for a full screen and a home-screen icon.
        </p>
        <Button
          variant="outline"
          className="mt-3 min-h-[var(--ctl)] w-full"
          onClick={() => {
            void deferred.prompt();
            // Single-use: the browser will not replay the same event, so
            // clearing it stops a button that silently does nothing.
            setDeferred(null);
          }}
        >
          Install
        </Button>
      </Wrap>
    );
  }

  if (isIos) {
    return (
      <Wrap>
        <p className="text-[length:var(--fs-3)] text-muted-foreground">
          To install: tap <span className="font-medium text-foreground">Share</span>, then{" "}
          <span className="font-medium text-foreground">Add to Home Screen</span>. On iPhone,
          notifications only work once the app is installed this way.
        </p>
      </Wrap>
    );
  }

  // Chrome may not have fired the event yet, or the browser cannot install at
  // all. Saying nothing beats explaining an absent capability.
  return null;
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-card p-4">{children}</div>
  );
}
