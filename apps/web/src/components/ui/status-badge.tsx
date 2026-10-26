import { OsBadge, type OsTone } from "@/components/os/pills";

/**
 * Shared across Leave, Reimbursements and Approvals — the one place the
 * submitted/pending_approval/approved/rejected/cancelled workflow states map
 * to a badge color and a plain-English "what happens next" line, instead of
 * each page keeping its own copy of both.
 */
const TONE_BY_STATUS: Record<string, OsTone> = {
  draft: "neutral",
  submitted: "blue",
  pending_approval: "amber",
  approved: "green",
  rejected: "red",
  cancelled: "quiet",
};

const NEXT_ACTION_BY_STATUS: Record<string, string> = {
  draft: "Not submitted yet.",
  submitted: "Waiting to enter the approval queue.",
  pending_approval: "Waiting on the approver's decision.",
  approved: "Approved — no further action needed.",
  rejected: "Rejected — no further action needed.",
  cancelled: "Cancelled.",
};

export function StatusBadge({ status }: { status: string }) {
  return <OsBadge tone={TONE_BY_STATUS[status] ?? "neutral"} dot={status !== "cancelled"}>{status.replace(/_/g, " ")}</OsBadge>;
}

/**
 * `asApprover` swaps the pending_approval line to address the person who
 * can act on it, rather than the person waiting on someone else.
 */
export function statusNextAction(status: string, { asApprover = false }: { asApprover?: boolean } = {}): string {
  if (asApprover && status === "pending_approval") return "Awaiting your decision below.";
  return NEXT_ACTION_BY_STATUS[status] ?? "";
}
