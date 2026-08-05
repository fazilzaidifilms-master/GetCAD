import type { EscrowKind, FileKind } from "@/core";

export interface OrderRow {
  id: string;
  product_type: string;
  status: string;
  client_id: string;
  designer_id: string | null;
  currency: string;
  price_total: number;
  designer_payout: number;
  qc_payout: number;
  platform_commission: number;
}

export interface VersionRow {
  id: string;
  order_id: string;
  version_no: number;
  content_type: string;
  size_bytes: number;
  /** What this file is. Drives the download gate — see core/files/downloadGate. */
  kind: FileKind;
  /** Opaque; only used to decide "this is your own upload". Never displayed. */
  uploaded_by: string;
}

export interface LedgerRow {
  order_id: string;
  kind: EscrowKind;
  amount: number;
}

export interface MessageRow {
  id: string;
  order_id: string;
  sender_id: string; // opaque; only used to detect "You" — never displayed
  sender_party: "CLIENT" | "DESIGNER";
  body: string;
  created_at: string;
}

export interface DisputeRow {
  id: string;
  order_id: string;
  reason: string;
  status: "OPEN" | "RESOLVED";
  resolution: "REWORK" | "REFUND" | null;
  resolution_notes: string | null;
}
