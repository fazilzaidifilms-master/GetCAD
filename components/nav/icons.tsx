import type { Tab } from "@/core";

/**
 * One icon set, drawn once, used by both navigations.
 *
 * The bottom bar and the sidebar are the same navigation at two widths. When
 * the glyphs lived inside the bottom bar, the sidebar would have had to either
 * import from it or redraw them — and redrawn icons drift, so a person moving
 * between their phone and a desk sees two subtly different apps.
 *
 * Stroked rather than filled, at a single weight, so they read as a family and
 * inherit colour from the link around them.
 */
export const NAV_ICONS: Record<Tab["icon"], React.ReactNode> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  list: <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" strokeLinejoin="round" />,
  work: (
    <path
      d="M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  queue: <path d="M4 5h16M4 10h16M4 15h9M4 20h9" strokeLinecap="round" strokeLinejoin="round" />,
  user: (
    <path
      d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />,
};

/** The glyph at a given size, with the shared stroke treatment. */
export function NavIcon({ icon, className }: { icon: Tab["icon"]; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden="true"
    >
      {NAV_ICONS[icon]}
    </svg>
  );
}
