import type { LucideIcon } from "lucide-react";
import { FileCheck2, Hourglass } from "lucide-react";
import { HANDOVER_KIND_LABEL } from "@/lib/crm/handover-attention";
import type { HandoverCheck } from "@/lib/crm/handover-attention-data";
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
 * "Handover accepted" rows: news for the Sales owner and preparer (the Project Manager accepted it, the project exists), not something to do. They are shown
 * under "Also open" and never counted in the attention headline, which counts actions only.
 */
export function handoverNotice(check: HandoverCheck): ActionItem[] {
  if (check.status !== "ok") return [];
  const rows = check.rows.filter((r) => r.kind === "handover_accepted");
  if (rows.length === 0) return [];
  return [{ key: "handover-accepted", icon: FileCheck2, label: HANDOVER_KIND_LABEL.handover_accepted, count: rows.length, href: rows.length === 1 ? `/sales/opportunities/${rows[0]!.opportunityId}/handover` : "/sales/follow-ups" }];
}

const WAITING_LABEL: Record<WaitingSource, { one: string; many: string; error: string; href: string }> = {
  leave: { one: "Leave request you submitted, waiting for a decision", many: "Leave requests you submitted, waiting for decisions", error: "Your leave requests could not be loaded", href: "/leave" },
  claims: { one: "Expense claim you submitted, waiting for a decision", many: "Expense claims you submitted, waiting for decisions", error: "Your expense claims could not be loaded", href: "/reimbursements" },
  recovery: { one: "Recovery Leave request you submitted, waiting for a decision", many: "Recovery Leave requests you submitted, waiting for decisions", error: "Your Recovery Leave requests could not be loaded", href: "/leave" },
};

/** The budget "waiting on others" row's second line: the oldest wait and which shared queue decides ("Finance", "the CEO or CTO"). Nothing is said about people. */
export function budgetWaitingDetail(w: { oldest: string | null; queues: string[] } | undefined, now: Date): string | undefined {
  if (!w) return undefined;
  const named = w.queues.map((q) => (q.startsWith("the ") ? `${q} queue` : `the ${q} queue`));
  const parts = [waitingText(w.oldest, now), named.length > 0 ? `with ${named.join(" and ")}` : undefined].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** "Oldest waiting 3 days · with Pia Manager" (or "with the HR queue"); when who decides could not be read the line says so, never stays silent. */
function waitingDetail(r: Extract<WaitingResult, { status: "ok" }>, now: Date): string | undefined {
  const parts = [waitingText(r.oldest, now), r.with ? `with ${r.with}` : r.withFailed ? "who decides could not be loaded" : undefined].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

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
      else if (r.count > 0) items.push({ key: `waiting-${source}`, icon: Hourglass, label: r.count === 1 ? text.one : text.many, count: r.count, href: text.href, detail: waitingDetail(r, now) });
    }
  }
  if (inReview > 0) items.push({ key: "waiting-review", icon: Hourglass, label: inReview === 1 ? "Task you sent for review, waiting on the reviewer" : "Tasks you sent for review, waiting on the reviewer", count: inReview, href: "/projects/work" });
  return items;
}
