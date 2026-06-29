import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "GetCAD",
  description: "Double-blind CAD marketplace — foundation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-background text-foreground antialiased">
          <header className="flex items-center justify-between border-b px-6 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              GetCAD
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <SignedOut>
                <SignInButton mode="modal" />
                <SignUpButton mode="modal" />
              </SignedOut>
              <SignedIn>
                <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                  Dashboard
                </Link>
                <UserButton />
              </SignedIn>
            </nav>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
