"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NavIcon } from "@/components/nav/icons";
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
 * SIZE IS THE POINT HERE. The icons are 24px and the labels 13px — both up from
 * the 20px/11px this shipped with. An 11px label under a small glyph is a
 * decoration you learn the position of rather than a word you read, which is
 * the wrong bet for someone in their forties holding a phone at arm's length.
 * The glyphs come from the shared set so the phone and the sidebar draw the
 * same navigation.
 *
 * Two details that are easy to omit and unpleasant to discover later:
 *
 *   - `env(safe-area-inset-bottom)` padding. Without it the bar sits under the
 *     home indicator on a modern iPhone and the tabs are half-tappable.
 *   - `md:hidden`. This is the phone shell. At desk width the sidebar is the
 *     navigation, so the two never appear at once.
 */
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
                  "flex min-h-[var(--ctl)] flex-col items-center justify-center gap-1 px-1 py-2",
                  "transition-colors duration-[var(--dur-fast)]",
                  isActive ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                <NavIcon icon={tab.icon} className="h-6 w-6" />
                <span className="text-[length:var(--fs-1)] leading-[var(--lh-1)] tracking-[var(--ls-1)]">
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
