import Link from "next/link";

import { Wordmark } from "@/components/wordmark";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How It Works" },
      { href: "/quality-control", label: "Quality Control" },
      { href: "/security", label: "Security" },
      { href: "/blog", label: "Blog" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/for-designers", label: "For Designers" },
      { href: "/contact", label: "Contact Sales" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Operational infrastructure for jewelry CAD production.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {col.title}
            </p>
            <ul className="mt-3 space-y-2">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border py-4">
        <p className="container text-xs text-muted-foreground">
          © {new Date().getFullYear()} The CAD Pillar. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
