import { clerkMiddleware } from "@clerk/nextjs/server";

import { isProtectedPath } from "@/core";

// Clerk runs on every matched request. Protection decisions come from the pure,
// unit-tested isProtectedPath() in core/ — the middleware is just the wiring.
export default clerkMiddleware(async (auth, req) => {
  if (isProtectedPath(req.nextUrl.pathname)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files...
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // ...and always on API routes.
    "/(api|trpc)(.*)",
  ],
};
