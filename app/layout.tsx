import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

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
      <html lang="en" className={inter.variable}>
        <body className="min-h-screen bg-background font-sans text-foreground antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
