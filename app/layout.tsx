import { ClerkProvider } from "@clerk/nextjs";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";

import { ServiceWorker } from "@/components/pwa/service-worker";

import "./globals.css";

// Self-hosted rather than fetched from Google at build time: the build must not
// depend on an outbound request succeeding, and the fonts must not be requested
// from a third party at runtime by a page that shows people's order data.

export const metadata: Metadata = {
  title: {
    default: "The CAD Pillar",
    template: "%s | The CAD Pillar",
  },
  description: "The operational infrastructure for jewelry CAD production.",
  // Safari largely ignores the manifest and reads these instead, so an
  // installed iOS app takes its name and status-bar treatment from here.
  appleWebApp: {
    capable: true,
    title: "CAD Pillar",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

/**
 * `viewportFit: "cover"` lets the page paint into the display cutout area,
 * which is what makes `env(safe-area-inset-*)` return anything but zero — the
 * bottom tab bar depends on it to clear the home indicator.
 *
 * `maximumScale` is left alone on purpose. Capping it stops pinch-zoom, which
 * is a genuine accessibility regression, and the usual reason for adding it
 * (iOS zooming on focused inputs) is solved by not using type smaller than
 * 16px in form fields.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d0f" },
  ],
};

// Minimal shell: ClerkProvider + fonts + globals only. The marketing site and
// the authenticated product each provide their own header/nav via a nested
// layout in their respective route group — this root never renders chrome
// specific to either, keeping the two structurally isolated.
/**
 * `signInUrl` / `signUpUrl` / `afterSignOutUrl` are what keep authentication on
 * THIS origin.
 *
 * Unset, Clerk sends an unauthenticated visitor to its hosted Account Portal —
 * `accounts.<your-domain>` or `<slug>.accounts.dev` — which is a different
 * origin. In a browser that is merely a detour. In the installed app it is a
 * loop that never ends:
 *
 *   - the manifest's `scope` is this origin, so the portal is OUTSIDE the app;
 *   - an iOS home-screen app has a storage container SEPARATE from Safari, so
 *     the install starts signed out even when Safari is signed in;
 *   - the portal hands the session back across origins, the container does not
 *     keep it, and /dashboard redirects out again.
 *
 * The symptom is an app that opens to a spinner and reloads forever, with no
 * error anywhere. Pointing these at our own routes keeps every step inside the
 * installed app, where the cookie it sets is the cookie the next request reads.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/">
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <body className="min-h-screen bg-background font-sans text-foreground antialiased">
          {children}
          <ServiceWorker />
        </body>
      </html>
    </ClerkProvider>
  );
}
