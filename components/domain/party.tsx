import { cn } from "@/lib/utils";

/**
 * The other side of an order, named by ROLE and never by person.
 *
 * This component exists to make the anonymity guarantee structural rather than
 * remembered. It accepts a role and nothing else: there is no `name` prop, no
 * `avatarUrl`, no `company`. A screen that wanted to show who the designer is
 * would have to stop using this component to do it, which is a visible change
 * in a diff rather than a quiet one.
 *
 * That matters because the guarantee is not enforced anywhere in the UI layer —
 * it is enforced by the database holding no such data. This is the UI-side
 * companion: the shape that makes the wrong thing hard to type.
 *
 * Staff are shown by function too ("Ops", "Finance"). Neither the client nor
 * the designer learns which individual acted, and staff do not learn who the
 * client or designer are either.
 */
export type PartyRole = "CLIENT" | "DESIGNER" | "QC" | "OPS" | "SALES" | "FINANCE" | "SYSTEM";

const LABEL: Record<PartyRole, string> = {
  CLIENT: "Client",
  DESIGNER: "Designer",
  // Deliberately not "the reviewer" — an independent reviewer is a property of
  // the process, not a person the client is entitled to identify.
  QC: "Independent review",
  OPS: "Ops",
  SALES: "Sales",
  FINANCE: "Finance",
  SYSTEM: "The CAD Pillar",
};

export function partyLabel(role: string): string {
  return LABEL[role as PartyRole] ?? "Someone";
}

export function Party({
  role,
  className,
  /** Renders "You" instead, when the viewer is this side of the conversation. */
  isSelf = false,
}: {
  role: string;
  className?: string;
  isSelf?: boolean;
}) {
  return (
    <span className={cn("font-medium", className)}>{isSelf ? "You" : partyLabel(role)}</span>
  );
}
