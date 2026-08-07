"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NavIcon } from "@/components/nav/icons";
import { Wordmark } from "@/components/wordmark";
import { activeTabKey, type Tab } from "@/core";
import { cn } from "@/lib/utils";

/**
 * The sidebar — the same navigation as the bottom bar, at desk width.
 *
 * WHAT THIS REPLACES, AND WHY. Desktop previously navigated from a row of text
 * links in the top header. That is the shape of a website, and it reads as one:
 * small, evenly-weighted words in a strip you learn to ignore. The phone shell
 * already had a proper app navigation — persistent, icon-and-label, one clearly
 * current destination — and the two did not resemble each other, so moving from
 * a phone to a desk felt like moving between two products.
 *
 * NOTHING ABOUT WHERE YOU CAN GO CHANGED. Destinations, their order and their
 * labels all still come from `core/nav/tabs` and are still decided by role.
 * This is only how they are drawn: a 48px row per destination instead of a
 * text link, an icon shared with the bottom bar, and a filled current state
 * that is visible from across a desk rather than a colour shift you have to
 * look for.
 *
 * `hidden md:flex` — one navigation on screen at a time. Below 768px this is
 * absent entirely and the bottom bar is the navigation; the two never coexist.
 */
export function SideNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname() ?? "";
  const active = activeTabKey(pathname, tabs);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-background",
        "md:flex",
      )}
    >
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/dashboard" aria-label="The CAD Pillar — dashboard">
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-1">
        <ul className="flex flex-col gap-1">
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[var(--ctl)] items-center gap-3 rounded-[var(--r-md)] px-3",
                    "text-[length:var(--fs-3)] leading-[var(--lh-3)]",
                    "transition-colors duration-[var(--dur-fast)]",
                    isActive
                      ? // Filled AND accented AND bolder. Where you are should be
                        // answerable at a glance rather than by comparing two
                        // greys, and three signals survive a dim screen where
                        // any one of them alone might not.
                        "bg-secondary font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <NavIcon icon={tab.icon} className="h-6 w-6 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom of the column, where an app puts the account control — and
          where it stops competing with navigation for the top-right corner. */}
      <div className="shrink-0 border-t border-border px-5 py-4">
        <UserButton />
      </div>
    </aside>
  );
}
