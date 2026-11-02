import type { PbxInbox } from "@/types/budget";

/**
 * What the project budget inbox means for ONE person's My Day. Built only from `pbx_inbox()` (already scoped to the companies the person may read, with
 * `i_can_decide` and `on_hold` worked out by the database) plus which of those submissions the person themselves prepared or submitted.
 *
 *  - waitingForMe: things the person can decide NOW: a budget or final-expense approval they may decide and that is not on hold, a settlement waiting for their
 *    receipts confirmation, or ready to close and theirs to close. Nothing they authored, nothing in another company, nothing on hold.
 *  - waitingOnOthers: budgets and final expenses the person prepared or submitted that still wait for someone else. They stay visible (under "Waiting on others")
 *    and are never counted as a decision for them: the self-approval refusals live in the database and are unchanged.
 */
export type BudgetDay = {
  waitingForMe: { count: number; href: string };
  waitingOnOthers: number;
};

export function budgetDayFromInbox(inbox: PbxInbox, authoredVersionIds: ReadonlySet<string>, authoredSubmissionIds: ReadonlySet<string>): BudgetDay {
  const budgets = inbox.budget_approvals.filter((r) => r.i_can_decide && !r.on_hold && !authoredVersionIds.has(r.version_id)).length;
  const actuals = inbox.final_expense_approvals.filter((r) => r.i_can_decide && !r.on_hold && !authoredSubmissionIds.has(r.submission_id)).length;
  const settlements = inbox.outstanding_settlement.filter((r) => r.has_approved_actuals && (r.i_can_confirm_receipts || (r.i_can_close && r.next === "Ready to close"))).length;
  const waitingOnOthers =
    inbox.budget_approvals.filter((r) => authoredVersionIds.has(r.version_id)).length + inbox.final_expense_approvals.filter((r) => authoredSubmissionIds.has(r.submission_id)).length;
  const kinds = [budgets > 0 ? "budget" : null, actuals > 0 ? "actuals" : null, settlements > 0 ? "settlement" : null].filter((k): k is string => k !== null);
  const href = kinds.length === 1 ? `/finance/project-budgets?filter=${kinds[0]}` : "/finance/project-budgets";
  return { waitingForMe: { count: budgets + actuals + settlements, href }, waitingOnOthers };
}
