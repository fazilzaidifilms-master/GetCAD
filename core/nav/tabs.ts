/**
 * What each role can navigate to.
 *
 * THE BUG THIS FIXES. The app header currently renders Dashboard, Orders, Staff
 * and Designers to every signed-in user, unconditionally. A client sees links
 * into staff tooling. On a desktop header that reads as clutter; in a four-item
 * bottom bar it is most of the app, and it tells a customer what internal
 * screens exist. Navigation is not access control — the database refuses those
 * pages either way — but advertising a door you cannot open is still a
 * disclosure, and it is one this product in particular should not make.
 *
 * The design prototype collapses staff into a single "Staff" persona with one
 * queue. The system does not: OPS, SALES, FINANCE and QC have genuinely
 * different permissions, and the same screen means different things to them.
 * The shell here is deliberately shared — same tabs, same shape — while what
 * the queue CONTAINS is filtered per role by the database. That keeps the
 * design's structure without pretending four roles are one.
 *
 * Framework-free (no next/*, no react) so the rule is unit-tested rather than
 * inspected by eye in a component.
 */

export interface Tab {
  /** Stable key — used for the active-state comparison, never displayed. */
  key: string;
  label: string;
  href: string;
  /** Icon name; the component maps it. Kept as data so this stays framework-free. */
  icon: "home" | "list" | "work" | "queue" | "user" | "plus";
}

const ACCOUNT: Tab = { key: "account", label: "Account", href: "/account", icon: "user" };

/**
 * Tabs are per role, and the labels differ on purpose.
 *
 * A designer's "My work" and a client's "Orders" are the same route showing
 * different rows, but they are not the same idea to the person reading it: one
 * is a queue of things to do, the other is a record of things bought.
 *
 * Missing on purpose, until the routes they point at exist: the designer's
 * "Earnings" and staff "Inbox". A tab that leads to a 404 is worse than a tab
 * that is not there yet.
 */
const CLIENT_TABS: Tab[] = [
  { key: "home", label: "Home", href: "/dashboard", icon: "home" },
  { key: "orders", label: "Orders", href: "/orders", icon: "list" },
  // Ranked ahead of Account because starting a job is the thing a client comes
  // here to do. `activeTabKey` prefers the longer match, so /orders/new lights
  // this rather than Orders.
  { key: "new", label: "New order", href: "/orders/new", icon: "plus" },
  ACCOUNT,
];

const DESIGNER_TABS: Tab[] = [
  { key: "home", label: "Home", href: "/dashboard", icon: "home" },
  { key: "orders", label: "My work", href: "/orders", icon: "work" },
  ACCOUNT,
];

const STAFF_TABS: Tab[] = [
  { key: "queue", label: "Queue", href: "/admin", icon: "queue" },
  { key: "orders", label: "Orders", href: "/orders", icon: "list" },
  ACCOUNT,
];

export function tabsForRole(role: string): Tab[] {
  switch (role) {
    case "DESIGNER":
      return DESIGNER_TABS;
    case "OPS":
    case "SALES":
    case "FINANCE":
    case "QC":
      return STAFF_TABS;
    case "CLIENT":
      return CLIENT_TABS;
    default:
      // An unrecognised or not-yet-assigned role gets the client shell: the
      // least-privileged set, and the one whose pages fail gracefully rather
      // than showing an empty staff queue.
      return CLIENT_TABS;
  }
}

/**
 * Which tab is highlighted for a given path.
 *
 * Prefix-matched so a detail route keeps its parent tab lit — `/orders/abc123`
 * is still "Orders". Longest match wins, so a future `/orders/new` tab would
 * beat `/orders` rather than both appearing active.
 */
export function activeTabKey(pathname: string, tabs: Tab[]): string | null {
  let best: Tab | null = null;
  for (const tab of tabs) {
    if (pathname === tab.href || pathname.startsWith(`${tab.href}/`)) {
      if (!best || tab.href.length > best.href.length) best = tab;
    }
  }
  return best?.key ?? null;
}
