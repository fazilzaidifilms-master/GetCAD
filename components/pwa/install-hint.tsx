"use client";

import { useEffect, useState } from "react";

import { installAdvice, type InstallAdvice } from "@/core";
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
 * THREE PLATFORMS, THREE HONEST ANSWERS.
 *
 *   - Chrome and Edge fire `beforeinstallprompt`, which must be stashed and
 *     replayed from a user gesture. That is a real button.
 *   - iOS SAFARI has no such API — Apple has never implemented it on any
 *     version — so the only truthful thing is to show where the button they
 *     need actually is, in their browser's own chrome.
 *   - iOS ANYTHING ELSE cannot install at all. Chrome, Firefox and every
 *     in-app browser on iOS run on WebKit but are denied the capability, so
 *     their "Add to Home Screen" makes a shortcut that reopens in a browser.
 *     That is what people mean when they say it saved a bookmark instead of
 *     installing, and it is invisible unless we name it.
 *
 * The decision itself is in `core/pwa/install`, unit-tested against real user
 * agent strings, because "which browser is this" is exactly the kind of logic
 * that rots silently.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallHint() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [advice, setAdvice] = useState<InstallAdvice | null>(null);

  useEffect(() => {
    const read = (hasPrompt: boolean) =>
      installAdvice({
        userAgent: window.navigator.userAgent,
        standalone:
          window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
        hasPrompt,
        maxTouchPoints: window.navigator.maxTouchPoints,
      });

    setAdvice(read(false));

    const onPrompt = (event: Event) => {
      // Suppress Chrome's own mini-infobar so the offer appears here, once,
      // where the user went looking for it.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
      setAdvice(read(true));
    };
    const onInstalled = () => {
      setDeferred(null);
      setAdvice("INSTALLED");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (advice === null || advice === "INSTALLED" || advice === "NOT_AVAILABLE") return null;

  if (advice === "PROMPT_READY" && deferred) {
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

  if (advice === "IOS_WRONG_BROWSER") {
    return (
      <Wrap>
        <p className="text-[length:var(--fs-3)] font-medium">Open this in Safari to install</p>
        <p className="mt-1.5 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
          On iPhone and iPad, only Safari can install an app. Adding to the Home Screen from this
          browser makes a shortcut that reopens in a browser — not the app.
        </p>
        <p className="mt-2.5 text-[length:var(--fs-2)] text-muted-foreground">
          Copy this page&apos;s address, open Safari, paste it, then follow the steps there.
        </p>
      </Wrap>
    );
  }

  // IOS_SAFARI — the Share-sheet route, shown as steps rather than a sentence.
  return (
    <Wrap>
      <p className="text-[length:var(--fs-3)] font-medium">Install on this iPhone</p>
      <p className="mt-1.5 text-[length:var(--fs-2)] text-muted-foreground">
        Apple gives websites no install button, so this is the only way — it makes a real app, not a
        bookmark.
      </p>

      <ol className="mt-3 flex flex-col gap-2.5">
        <Step n={1}>
          Tap the <ShareGlyph /> <strong className="font-medium text-foreground">Share</strong> button
          in Safari&apos;s toolbar
        </Step>
        <Step n={2}>
          Scroll down and choose{" "}
          <strong className="font-medium text-foreground">Add to Home Screen</strong>
        </Step>
        <Step n={3}>
          Tap <strong className="font-medium text-foreground">Add</strong>, then open the app from
          your Home Screen
        </Step>
      </ol>

      <p className="mt-3 text-[length:var(--fs-2)] text-muted-foreground">
        Notifications on iPhone only work once the app is installed this way.
      </p>
    </Wrap>
  );
}

/** The steps are genuinely ordered — do them out of order and nothing happens. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
      <span
        aria-hidden="true"
        className="tabular mt-[.15em] flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--r-full)] border border-border font-mono text-[length:var(--fs-1)] text-foreground"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Safari's Share icon, drawn rather than described.
 *
 * "Tap Share" is not findable if you do not already know the glyph — it is an
 * unlabelled icon in a toolbar of unlabelled icons.
 */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block align-[-2px] text-foreground"
      role="img"
      aria-label="the Share icon"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-card p-4">{children}</div>
  );
}
