import type { LucideIcon } from "lucide-react";
import { CalendarClock, ClipboardCheck, FileClock, IdCard, ShieldCheck } from "lucide-react";

export type ActionItem = {
  key: string;
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
  /** The read behind this row failed: the row says so (count shown as "—"), never "0" or a missing row. */
  error?: boolean;
};

/**
 * The rows of "what requires my attention", already permission-scoped by the caller: each is a real count linking to the page
 * that handles it in detail. Built in ONE place so the card and the sentence under the greeting are always derived from the same
 * authorised data and can never contradict each other. Rows with a zero count are dropped; the order is the order shown.
 */
export function buildActionItems({
  myPendingApprovals,
  contractsEndingCount,
  probationDueCount,
  docsExpiringCount,
  identityExpiringCount,
  extraItems = [],
}: {
  /** "error" when the count could not be loaded: the row is then an error row, not a zero. */
  myPendingApprovals: number | "error";
  contractsEndingCount?: number;
  probationDueCount?: number;
  docsExpiringCount?: number;
  identityExpiringCount?: number;
  /** Rows from other modules (e.g. Sales follow-ups), already permission-scoped by the caller. */
  extraItems?: ActionItem[];
}): ActionItem[] {
  const items: ActionItem[] = [
    myPendingApprovals === "error"
      ? { key: "approvals", icon: ClipboardCheck, label: "Approvals could not be loaded", count: 0, href: "/approvals", error: true }
      : { key: "approvals", icon: ClipboardCheck, label: "Waiting on your decision", count: myPendingApprovals, href: "/approvals" },
    ...(contractsEndingCount !== undefined
      ? [{ key: "contracts", icon: CalendarClock, label: "Contracts ending soon", count: contractsEndingCount, href: "/alerts" }]
      : []),
    ...(probationDueCount !== undefined
      ? [{ key: "probation", icon: ShieldCheck, label: "Probation reviews due", count: probationDueCount, href: "/alerts" }]
      : []),
    ...(docsExpiringCount !== undefined
      ? [{ key: "docs", icon: FileClock, label: "Documents expiring or expired", count: docsExpiringCount, href: "/alerts" }]
      : []),
    ...(identityExpiringCount !== undefined
      ? [{ key: "identity", icon: IdCard, label: "Identity documents expiring soon", count: identityExpiringCount, href: "/alerts" }]
      : []),
    ...extraItems,
  ];
  return items.filter((item) => item.count > 0 || item.error);
}

/** The one sentence about attention under the greeting, from the same items the card shows. */
export function attentionSentence(items: readonly ActionItem[]): string {
  const total = items.reduce((n, i) => n + i.count, 0);
  const failed = items.filter((i) => i.error);
  const incomplete = failed.length > 0 ? ` ${failed.map((i) => i.label).join("; ")}, so this list may be incomplete.` : "";
  if (total === 0) return failed.length > 0 ? `Some items could not be loaded.${incomplete}` : "Nothing needs your attention right now.";
  return `Your updates for today: ${total} ${total === 1 ? "item needs" : "items need"} your attention.${incomplete}`;
}
