import { ClerkProvider } from "@clerk/nextjs";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";

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
        </body>
      </html>
    </ClerkProvider>
  );
}
