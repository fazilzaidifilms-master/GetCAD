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
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <body className="min-h-screen bg-background font-sans text-foreground antialiased">
          {children}
          <ServiceWorker />
        </body>
      </html>
    </ClerkProvider>
  );
}
