"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeTabKey, type Tab } from "@/core";
import { cn } from "@/lib/utils";

/**
 * The bottom tab bar — the app's primary navigation on a phone.
 *
 * Which tabs exist is decided in `core/nav/tabs` from the viewer's role, not
 * here; this renders what it is given. That split is what keeps "a client must
 * never be shown /admin" a unit-tested rule rather than a JSX condition someone
 * can quietly get wrong.
 *
 * Two details that are easy to omit and unpleasant to discover later:
 *
 *   - `env(safe-area-inset-bottom)` padding. Without it the bar sits under the
 *     home indicator on a modern iPhone and the tabs are half-tappable.
 *   - `md:hidden`. This is the phone shell. Desktop keeps the existing header,
 *     so the two navigations never appear at once.
 */
const ICONS: Record<Tab["icon"], React.ReactNode> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  list: (
    <path
      d="M4 6h16M4 12h16M4 18h10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  work: (
    <path
      d="M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  queue: (
    <path
      d="M4 5h16M4 10h16M4 15h9M4 20h9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  user: (
    <path
      d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

export function BottomNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname() ?? "";
  const active = activeTabKey(pathname, tabs);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur",
        "md:hidden",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-[var(--ctl)] flex-col items-center justify-center gap-1 py-2",
                  "transition-colors duration-[var(--dur-fast)]",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="h-5 w-5"
                  aria-hidden
                >
                  {ICONS[tab.icon]}
                </svg>
                <span className="text-[length:var(--fs-1)] tracking-[var(--ls-1)]">
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
