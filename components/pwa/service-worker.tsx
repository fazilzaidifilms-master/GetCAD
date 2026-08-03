"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and unregisters it in development.
 *
 * The dev-mode unregister is not tidiness. A service worker installed while
 * running `npm run dev` outlives the dev server: it keeps serving cached build
 * output from a port you are no longer running, and the symptom is a blank page
 * or stale JavaScript that survives a hard refresh. It is a genuinely confusing
 * afternoon, and it happens to everyone once.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
      return;
    }

    // After load, so registration never competes with the first render for
    // bandwidth on a slow connection.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing means no offline page and no install prompt.
        // Both are enhancements; the app itself is unaffected, so this stays
        // silent rather than showing the user an error about a feature they
        // never asked for.
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
