/*
 * Service worker.
 *
 * WHY THIS IS HAND-WRITTEN AND SIXTY LINES INSTEAD OF A LIBRARY.
 *
 * The usual choice here is Workbox or Serwist, and their defaults cache
 * navigations and API responses so the app "works offline". For this
 * application those defaults are a data-protection failure, not a feature:
 *
 *   - Order pages contain prices, briefs, escrow balances and message threads.
 *     Cached, they persist in the browser's storage on a phone that gets lost,
 *     sold, or handed to someone else — long after sign-out, which does not
 *     clear a service worker cache.
 *   - Responses are role-scoped. A cache keyed only by URL will happily serve
 *     one person's `/orders` to whoever opens the app next on a shared device.
 *   - The whole product rests on neither side learning who the other is. A
 *     stale cached page is a copy of that data outside the database's control,
 *     where RLS cannot reach it.
 *
 * So the rule here is narrow and absolute: cache STATIC BUILD OUTPUT and the
 * offline page. Never a navigation, never anything under /api, never a
 * response to an authenticated request. Offline you get the shell and an
 * honest "you're offline" — not yesterday's numbers presented as today's.
 *
 * The trade is deliberate. A note app should cache aggressively. An app that
 * moves money under an anonymity guarantee should not.
 */

const VERSION = "v1";
const STATIC_CACHE = `tcp-static-${VERSION}`;
const OFFLINE_URL = "/offline";

// Cached at install so the offline page is available the first time it is
// needed, which by definition is when it cannot be fetched.
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A failed precache must not block activation: an app that will not start
      // because its offline page is missing is worse than one with no offline
      // page.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Immutable, content-hashed build output. Safe to serve from cache forever. */
function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/favicon-32.png")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET. A cached POST would be a re-submitted order or a repeated
  // approval, which is the worst failure mode this app has.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch the API. Webhooks, signed file URLs and every mutation live
  // here, and a stale answer to any of them is worse than no answer.
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            // Only store a genuine 200 from our own origin — opaque responses
            // and errors are not worth persisting.
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations go to the network, always. On failure we show the offline page
  // rather than a cached copy of a page belonging to whoever used this device
  // last.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then(
          (hit) =>
            hit ??
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            }),
        ),
      ),
    );
  }

  // Everything else: left alone, straight to the network.
});
