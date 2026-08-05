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

/*
 * ------------------------------------------------------------------ push --
 *
 * The payload arrives already decrypted by the browser and was built by
 * core/notifications/push — fixed wording, no names, no amounts. This handler
 * deliberately does no formatting of its own: anything it composed here would
 * be a second place where lock-screen text is decided, and the anonymity tests
 * only cover the first.
 */
self.addEventListener("push", (event) => {
  // A push with no data is a "wake up and check" ping from some services. We
  // have nothing to show for it, and showing a generic placeholder would be a
  // notification that tells the user nothing.
  if (!event.data) return;

  let message;
  try {
    message = event.data.json();
  } catch {
    return;
  }
  if (!message || typeof message.title !== "string" || typeof message.body !== "string") return;

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      // Tag collapses repeats of the same event on the same order into one
      // entry rather than a stack of six during a delivery.
      tag: typeof message.tag === "string" ? message.tag : undefined,
      // Replacing a notification must not buzz again — the user has already
      // been told; this is an update to what they were told.
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof message.url === "string" ? message.url : "/dashboard" },
    }),
  );
});

/*
 * A tap should land on the thing the notification is about, in a window that is
 * already open if there is one. Opening a second copy of an installed app is
 * disorienting, and on desktop it leaves the user with two windows showing the
 * same order.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Same-origin check: matchAll can return windows from the whole origin,
        // and navigating an arbitrary one would yank the user out of whatever
        // they were doing in another tab.
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("focus" in client) {
          return client.navigate ? client.navigate(target).then((c) => c && c.focus()) : client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

/*
 * Push services rotate subscriptions. When that happens the old endpoint stops
 * working and the browser fires this event — without it, notifications simply
 * stop arriving one day and nothing anywhere reports why.
 *
 * The re-registration is posted to the page rather than sent from here, because
 * the endpoint has to be written to the database as the signed-in user and this
 * worker has no session.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" });
    }),
  );
});
