/**
 * Where someone lands after they authenticate.
 *
 * THE BUG THIS FIXES. Nothing set this, anywhere — not a prop, not an
 * environment variable. Clerk's default destination is `/`, which here is the
 * marketing homepage. So a person clicked "Sign in", completed Google, and
 * arrived back on the same page they started from. The marketing header does
 * not change when you are signed in either, so there was nothing on that page
 * to suggest anything had happened. It reads as "sign-in is broken" and it is
 * indistinguishable from it.
 *
 * ONE CONSTANT, NOT FOUR PROPS. There are four places a person can begin
 * authenticating — the /sign-in and /sign-up pages, and the two modal buttons in
 * the app header. Setting the destination at each of them is how three of them
 * end up right and the fourth silently keeps Clerk's default. A test asserts
 * every entry point uses this value.
 *
 * FALLBACK, NOT FORCE. Clerk distinguishes:
 *
 *   - `forceRedirectUrl` always wins, discarding any pending destination.
 *   - `fallbackRedirectUrl` applies only when nothing else asked for one.
 *
 * Fallback is correct here, and the difference matters. When the middleware
 * bounces an unauthenticated visitor off `/orders/ord_abc`, Clerk remembers that
 * URL and returns them to it after signing in. `force` would throw that away and
 * dump everyone on the dashboard, so a link to a specific order shared with a
 * client would never actually open that order.
 */

/**
 * The dashboard, not the homepage: it is the one authenticated screen every
 * role has, and it is what the installed PWA opens on (`start_url` in the
 * manifest), so signing in through the browser and launching from the home
 * screen agree about where "in the app" begins.
 */
export const POST_AUTH_PATH = "/dashboard";
