import type { LucideIcon } from "lucide-react";
import { BadgeCheck, CalendarClock, ClipboardCheck, ClipboardList, FileCheck2, FileClock, Hourglass, IdCard, ShieldCheck } from "lucide-react";
import { HANDOVER_KIND_LABEL, type HandoverRowKind } from "@/lib/crm/handover-attention";
import type { HandoverCheck } from "@/lib/crm/handover-attention-data";
import type { ApprovalsWaiting } from "@/lib/crm/my-day";
import type { WaitingNotesLoad } from "@/lib/inventory/project-notes-data";
import { projectNotesHref } from "@/lib/inventory/project-notes";
import { waitingText, type WaitingResult, type WaitingSource } from "@/lib/my-day/waiting";

export type ActionItem = {
  key: string;
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
  /** The read behind this row failed: the row says so (count shown as "—"), never "0" or a missing row. */
  error?: boolean;
  /** A short second line, e.g. how long the oldest item has been waiting. */
  detail?: string;
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

/**
 * My Day rows for the Sales-to-Projects handover: one row per kind with a count. A single enquiry links straight to its handover page, several to Follow-ups
 * (where each is listed). A failed read is an error row ("Could not check handovers"), never a missing row.
 */
export function handoverItems(check: HandoverCheck): ActionItem[] {
  if (check.status === "none") return [];
  if (check.status === "error") return [{ key: "handover-check", icon: FileCheck2, label: "Could not check handovers", count: 0, href: "/sales/follow-ups", error: true }];
  const KEYS: Record<HandoverRowKind, string> = { handover_question: "handover-question", won_no_handover: "handover-won", handover_accepted: "handover-accepted" };
  return (Object.keys(KEYS) as HandoverRowKind[]).flatMap((kind) => {
    const rows = check.rows.filter((r) => r.kind === kind);
    if (rows.length === 0) return [];
    return [{ key: KEYS[kind], icon: FileCheck2, label: HANDOVER_KIND_LABEL[kind], count: rows.length, href: rows.length === 1 ? `/sales/opportunities/${rows[0]!.opportunityId}/handover` : "/sales/follow-ups" }];
  });
}

/** The My Day row for a Sales founder: commercial approval requests waiting for them. Opens the enquiry's Commercial tab (the oldest request). A failed read is an error row. */
export function commercialApprovalItems(a: ApprovalsWaiting): ActionItem[] {
  if (a.status === "none") return [];
  if (a.status === "error") return [{ key: "approval-commercial", icon: BadgeCheck, label: "Commercial approvals could not be loaded", count: 0, href: "/sales/opportunities", error: true }];
  if (a.count === 0) return [];
  return [{ key: "approval-commercial", icon: BadgeCheck, label: a.count === 1 ? "Commercial approval waiting for your decision" : "Commercial approvals waiting for your decision", count: a.count, href: `/sales/opportunities/${a.oldestOpportunityId}?tab=commercial` }];
}

const WAITING_LABEL: Record<WaitingSource, { one: string; many: string; error: string; href: string }> = {
  leave: { one: "Leave request you submitted, waiting for a decision", many: "Leave requests you submitted, waiting for decisions", error: "Your leave requests could not be loaded", href: "/leave" },
  claims: { one: "Expense claim you submitted, waiting for a decision", many: "Expense claims you submitted, waiting for decisions", error: "Your expense claims could not be loaded", href: "/reimbursements" },
  recovery: { one: "Recovery Leave request you submitted, waiting for a decision", many: "Recovery Leave requests you submitted, waiting for decisions", error: "Your Recovery Leave requests could not be loaded", href: "/leave" },
};

/**
 * "Waiting on others": things the person submitted themselves that wait for someone else's decision. They are never decisions for the person (a self-submitted item
 * is not counted in "Needs me"); they stay visible here with how long the oldest has waited. A source that failed is its own error row; a source with nothing waiting adds no row.
 * `inReview` is the number of the person's own tasks sent for review.
 */
export function waitingOnOthersItems(requests: Record<WaitingSource, WaitingResult> | "error" | null, inReview: number, now: Date): ActionItem[] {
  const items: ActionItem[] = [];
  if (requests === "error") {
    items.push({ key: "waiting-requests", icon: Hourglass, label: "Your submitted requests could not be loaded", count: 0, href: "/leave", error: true });
  } else if (requests) {
    for (const source of Object.keys(WAITING_LABEL) as WaitingSource[]) {
      const r = requests[source];
      const text = WAITING_LABEL[source];
      if (r.status === "error") items.push({ key: `waiting-${source}`, icon: Hourglass, label: text.error, count: 0, href: text.href, error: true });
      else if (r.count > 0) items.push({ key: `waiting-${source}`, icon: Hourglass, label: r.count === 1 ? text.one : text.many, count: r.count, href: text.href, detail: waitingText(r.oldest, now) });
    }
  }
  if (inReview > 0) items.push({ key: "waiting-review", icon: Hourglass, label: inReview === 1 ? "Task you sent for review, waiting on the reviewer" : "Tasks you sent for review, waiting on the reviewer", count: inReview, href: "/projects/work" });
  return items;
}

/**
 * "Needs me" rows for dispatch notes and return checklists waiting for the person's acknowledgement (they are the current Project Manager, an acting Project Manager
 * or a Projects founder: the database decides, `inv_notes_waiting_for_me`). One row per project, oldest waiting first, linking to that project's Equipment page where the
 * notes are. Acknowledging is never blocking: it is an item to do, not a gate. A failed read is an error row, never "nothing waiting".
 */
export function projectNoteItems(load: WaitingNotesLoad, now: Date): ActionItem[] {
  if (load.status === "none") return [];
  if (load.status === "error") return [{ key: "inv-notes", icon: ClipboardList, label: "Dispatch and return notes could not be loaded", count: 0, href: "/projects", error: true }];
  const byProject = new Map<string, typeof load.notes>();
  for (const n of load.notes) byProject.set(n.projectId, [...(byProject.get(n.projectId) ?? []), n]);
  return [...byProject.entries()].map(([projectId, notes]) => {
    const dispatches = notes.filter((n) => n.kind === "dispatch").length;
    const returns = notes.length - dispatches;
    const what = returns === 0 ? (dispatches === 1 ? "Dispatch note waiting for you" : "Dispatch notes waiting for you") : dispatches === 0 ? (returns === 1 ? "Returned equipment, please confirm" : "Returned equipment, please confirm") : "Dispatch and return notes waiting for you";
    const oldest = notes.map((n) => n.waitingSince).sort()[0] ?? null;
    return {
      key: `inv-notes-${projectId}`, icon: ClipboardList, label: `${what}: ${notes[0]!.projectName}`, count: notes.length,
      href: projectNotesHref(projectId, notes.length === 1 ? notes[0]!.noteId : undefined), detail: waitingText(oldest, now),
    };
  });
}
