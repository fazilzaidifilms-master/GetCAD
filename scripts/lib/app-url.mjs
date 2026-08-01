// Resolving and sanity-checking APP_URL for the verify:* scripts.
//
// Two configuration mistakes account for nearly all the confusion when these
// scripts are first pointed at a deployed environment, and both of them look
// like a code failure:
//
//   1. APP_URL without a scheme. `fetch("example.com/x")` throws "Failed to
//      parse URL", which surfaces as "is `npm run dev` running?" — sending you
//      to look at a server that is perfectly fine.
//
//   2. A URL behind a platform auth wall (Vercel Deployment Protection guards
//      every preview deployment by default). Requests are answered by the
//      platform's login page, with a 401, before ever reaching the route. That
//      is dangerous rather than merely annoying: the checks that assert "a bad
//      signature is refused" are *looking for* a 401, so they pass without the
//      application having been consulted at all. A security check that goes
//      green while testing nothing is worse than one that goes red.
//
// Both are caught here, once, with an explanation rather than a stack trace.

/** Markers that identify a platform auth wall rather than our own 401. */
const AUTH_WALL_MARKERS = [
  "Protected deployment", // Vercel's JSON body
  "_vercel_sso_nonce", // the cookie its login redirect sets
  "Authentication Required",
  "vercel.com/sso", // the login page it serves
];

/**
 * Normalise a user-supplied APP_URL: supply the scheme if it is missing and
 * drop a trailing slash. `localhost` gets http, everything else https.
 */
export function normalizeAppUrl(raw) {
  const value = (raw ?? "http://localhost:3000").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) return value;
  const local = /^(localhost|127\.0\.0\.1|\[?::1\]?)(:|$)/.test(value);
  return `${local ? "http" : "https"}://${value}`;
}

/** True if this response came from a platform login wall, not from our app. */
export function isAuthWall(res, text) {
  if (res.status !== 401 && res.status !== 403) return false;
  if (res.headers.get("set-cookie")?.includes("_vercel_sso_nonce")) return true;
  return AUTH_WALL_MARKERS.some((m) => text.includes(m));
}

function authWallError(appUrl) {
  return new Error(
    `${appUrl} is behind a deployment auth wall — the platform answered before the app did.\n` +
      `      Nothing below this point would be testing your code.\n` +
      `      Fix: use the PRODUCTION url (no deployment hash in the hostname), and\n` +
      `      turn off Vercel → Settings → Deployment Protection for Production.`,
  );
}

/**
 * Confirm APP_URL actually reaches this application before any check runs.
 *
 * Returns a short note about configuration health, or throws with an
 * explanation. Uses /api/health, which reports whether each configuration
 * group is set without ever revealing a value.
 */
export async function assertAppReachable(appUrl) {
  let res;
  let text;
  try {
    res = await fetch(`${appUrl}/api/health`);
    text = await res.text();
  } catch (e) {
    throw new Error(
      `Could not reach ${appUrl}/api/health — is the app running and the URL right? ` +
        `(${e instanceof Error ? e.message : String(e)})`,
    );
  }

  if (isAuthWall(res, text)) throw authWallError(appUrl);

  let health;
  try {
    health = JSON.parse(text);
  } catch {
    throw new Error(
      `${appUrl}/api/health did not answer with JSON (status ${res.status}). ` +
        `Something other than this app is serving that URL.`,
    );
  }

  const unset = Object.entries(health.configured ?? {})
    .filter(([, v]) => v === false)
    .map(([k]) => k);
  return { status: health.status, unset };
}

/**
 * Wrap a webhook POST so an auth wall is reported as the configuration error it
 * is, instead of being mistaken for the route's own rejection.
 */
export function assertNotAuthWall(appUrl, res, text) {
  if (isAuthWall(res, text)) throw authWallError(appUrl);
}
