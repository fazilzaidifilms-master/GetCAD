import type { MetadataRoute } from "next";

/**
 * The web app manifest — what makes this installable.
 *
 * Served from `/manifest.webmanifest` and linked automatically by Next.
 *
 * `start_url` is `/dashboard`, not `/`. Someone who has installed the app to
 * their home screen has already decided what this is; landing them on the
 * marketing homepage every time makes it feel like a bookmark rather than an
 * application. Signed-out visitors are redirected to sign-in from there, which
 * is the right destination for them anyway.
 *
 * `scope` deliberately covers the whole origin rather than just `/dashboard`.
 * Order detail, account and the admin queues all live outside it, and a
 * navigation outside scope would eject the user into a browser tab mid-task.
 *
 * `display: standalone` rather than `fullscreen`: this app takes irreversible
 * money actions, and the status bar showing the clock and battery is worth
 * keeping. Nobody should approve a payout without knowing what time it is.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The CAD Pillar",
    short_name: "CAD Pillar",
    description: "The operational infrastructure for jewelry CAD production.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0d0f",
    theme_color: "#0c0d0f",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Cropped to whatever shape the launcher wants — a circle on much of
      // Android — so its artwork sits inside the middle 80% safe zone. Without
      // a maskable variant the OS pads the "any" icon into a white square,
      // which is how installed apps end up looking broken next to native ones.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
