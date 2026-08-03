/**
 * The domain component set — one component per concept in the business.
 *
 * Screens compose these and do not re-implement them. The rule that keeps this
 * useful: if two screens need to show the same idea, the idea moves here rather
 * than being written twice. That is what makes "change how a status looks" a
 * one-file edit instead of a search across every route.
 *
 * `StatusBadge` and `OrderTimeline` predate this folder and are re-exported
 * rather than moved, so every screen can import from one place without a
 * rename churning through unrelated diffs.
 */
export { Money } from "./money";
export { Party, partyLabel } from "./party";
export type { PartyRole } from "./party";
export { ActionBar } from "./action-bar";
export { FileCard, FileNotice, formatBytes, fileKind } from "./file-card";
export { StatusBadge } from "../status-badge";
