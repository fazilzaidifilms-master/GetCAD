import { clerkMiddleware } from "@clerk/nextjs/server";

import { isProtectedPath } from "@/core";

// Clerk runs on every matched request. Protection decisions come from the pure,
// unit-tested isProtectedPath() in core/ — the middleware is just the wiring.
export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedPath(req.nextUrl.pathname)) {
      await auth.protect();
    }
  },
  {
    // Where auth.protect() sends someone who is not signed in.
    //
    // Without these it is Clerk's hosted Account Portal, on a DIFFERENT ORIGIN.
    // A browser follows that happily; an installed PWA does not — the portal is
    // outside the manifest's scope, and on iOS the app's storage container is
    // separate from Safari's, so the session set over there is not the session
    // read back here. The result is an app that launches straight into a
    // redirect loop and never finishes loading. Both must be set here as well
    // as on ClerkProvider: this one governs the redirect, that one governs the
    // links inside Clerk's own components.
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  },
);

export const config = {
  matcher: [
    // Run on everything except Next internals and static files...
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // ...and always on API routes.
    "/(api|trpc)(.*)",
  ],
};
