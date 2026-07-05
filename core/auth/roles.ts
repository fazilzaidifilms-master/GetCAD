// Role helpers. Framework-free (no next/react). The canonical role set lives in
// the DB `role` enum; these mirror the staff subset for UI gating. Authorization
// is always enforced in the database (RLS + SECURITY DEFINER functions) — this is
// only for deciding what to *show*.

export const STAFF_ROLES = ["SALES", "OPS", "QC", "FINANCE"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** True if the role is an internal staff role (not CLIENT / DESIGNER). */
export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return role != null && (STAFF_ROLES as readonly string[]).includes(role);
}
