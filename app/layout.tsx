import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";

import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "The CAD Pillar",
  description: "Double-blind CAD marketplace for jewelry manufacturing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.variable}>
        <body className="min-h-screen bg-background font-sans text-foreground antialiased">
          <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
            <div className="container flex h-14 items-center justify-between">
              <Link href="/" aria-label="The CAD Pillar — home">
                <Wordmark />
              </Link>
              <nav className="flex items-center gap-1">
                <SignedOut>
                  <SignInButton mode="modal">
                    <Button variant="ghost" size="sm">
                      Sign in
                    </Button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <Button size="sm">Get started</Button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <NavLink href="/dashboard">Dashboard</NavLink>
                  <NavLink href="/orders">Orders</NavLink>
                  <NavLink href="/admin">Staff</NavLink>
                  <NavLink href="/onboarding/designer">Designers</NavLink>
                  <div className="ml-2 flex items-center">
                    <UserButton />
                  </div>
                </SignedIn>
              </nav>
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
