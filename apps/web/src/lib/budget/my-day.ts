import { APPROVER_NAME } from "@enginious-hr/domain";
import type { PbxInbox } from "@/types/budget";

/**
 * What the project budget inbox means for ONE person's My Day. Built only from `pbx_inbox()` (already scoped to the companies the person may read, with
 * `i_can_decide` and `on_hold` worked out by the database) plus which of those submissions the person themselves prepared or submitted.
 *
 *  - waitingForMe: things the person can decide NOW: a budget or final-expense approval they may decide and that is not on hold, a settlement waiting for their
 *    receipts confirmation, or ready to close and theirs to close. Nothing they authored, nothing in another company, nothing on hold.
 *  - waitingOnOthers: budgets and final expenses the person prepared or submitted that still wait for someone else, plus (for a Project Manager) the ones waiting on their own
 *    projects. They stay visible (under "Waiting on others") and are never counted as a decision for them: the self-approval refusals live in the database and are unchanged.
 *  - returned (Project Managers): a budget or final-expense set sent back on a project the person manages, which now needs their changes. It is theirs to act on.
 *  - decidedRecently (Project Managers): a budget or final-expense set approved or rejected on their project in the last 14 days, so the PM does not have to open every project.
 * The Project Manager rows come from the authoritative budget records, read through the PM's own session (row-level security already lets the current PM read their project's
 * budget, versions and final-expense sets; nothing else): never from notices, which show participants only.
 */
export type BudgetDay = {
  /** `oldest`: when the oldest item the person can decide now was submitted (null when unknown): My Day shows how long it has waited. */
  waitingForMe: { count: number; href: string; oldest?: string | null };
  waitingOnOthers: number;
  /** Of the budgets and final expenses the person submitted themselves (read from the Finance inbox): the oldest submission and who decides them, named as the shared queue ("Finance", "the CEO or CTO"), never one invented person. */
  waitingOnOthersWith?: { oldest: string | null; queues: string[] };
  /** Where "waiting on others" opens: the Finance inbox when the person prepared items there, otherwise the budget of their project (or Projects when several). */
  waitingOnOthersHref: string;
  returned: { count: number; href: string };
  decidedRecently: { count: number; href: string };
  /** The Project Manager part could not be read: My Day says so, and keeps everything that did load. */
  pmReadFailed?: boolean;
};

/** What the PM's own session read about the projects they manage (columns only; the database decides which rows they may see). */
export type PmBudgetRows = {
  budgets: { id: string; project_id: string }[];
  versions: { id: string; budget_id: string; seq: number; status: string; decided_at: string | null }[];
  submissions: { id: string; budget_id: string; seq: number; status: string; decided_at: string | null }[];
};

export type PmBudgetDay = {
  returned: { count: number; projectIds: string[] };
  /** Ids of the submitted versions / final-expense sets still waiting for a decision on the PM's projects (and their projects, for the link). */
  waitingIds: string[];
  waitingProjectIds: string[];
  decided: { count: number; projectIds: string[] };
};

const RECENT_DAYS = 14;

/**
 * The state of each budget and each final-expense set is the LATEST one that has been submitted (highest sequence number; drafts and discarded versions are not a state):
 * submitted = waiting, returned = needs the PM, approved / rejected = decided (shown for 14 days).
 */
export function pmBudgetDay(rows: PmBudgetRows, now: Date): PmBudgetDay {
  const projectOf = new Map(rows.budgets.map((b) => [b.id, b.project_id]));
  const since = now.getTime() - RECENT_DAYS * 86_400_000;
  const out: PmBudgetDay = { returned: { count: 0, projectIds: [] }, waitingIds: [], waitingProjectIds: [], decided: { count: 0, projectIds: [] } };
  const latest = (list: { id: string; budget_id: string; seq: number; status: string; decided_at: string | null }[]) => {
    const best = new Map<string, (typeof list)[number]>();
    for (const r of list) {
      if (r.status === "draft" || r.status === "discarded" || !projectOf.has(r.budget_id)) continue;
      const cur = best.get(r.budget_id);
      if (!cur || r.seq > cur.seq) best.set(r.budget_id, r);
    }
    return [...best.values()];
  };
  for (const r of [...latest(rows.versions), ...latest(rows.submissions)]) {
    const project = projectOf.get(r.budget_id)!;
    if (r.status === "submitted") { out.waitingIds.push(r.id); out.waitingProjectIds.push(project); }
    else if (r.status === "returned") { out.returned.count += 1; out.returned.projectIds.push(project); }
    else if ((r.status === "approved" || r.status === "rejected") && r.decided_at && new Date(r.decided_at).getTime() >= since) { out.decided.count += 1; out.decided.projectIds.push(project); }
  }
  return out;
}

const projectHref = (projectIds: string[]) => {
  const unique = [...new Set(projectIds)];
  return unique.length === 1 ? `/projects/${unique[0]}/budget` : "/projects";
};

export function budgetDayFromInbox(
  inbox: PbxInbox,
  authoredVersionIds: ReadonlySet<string>,
  authoredSubmissionIds: ReadonlySet<string>,
  pm?: PmBudgetDay | null,
): BudgetDay {
  const decidableBudgets = inbox.budget_approvals.filter((r) => r.i_can_decide && !r.on_hold && !authoredVersionIds.has(r.version_id));
  const decidableActuals = inbox.final_expense_approvals.filter((r) => r.i_can_decide && !r.on_hold && !authoredSubmissionIds.has(r.submission_id));
  const budgets = decidableBudgets.length;
  const actuals = decidableActuals.length;
  const settlements = inbox.outstanding_settlement.filter((r) => r.has_approved_actuals && (r.i_can_confirm_receipts || (r.i_can_close && r.next === "Ready to close"))).length;
  // One set of ids, so an item the person both authored and manages is counted once, and one they can decide themselves is never "waiting on others".
  const authoredWaiting = [
    ...inbox.budget_approvals.filter((r) => authoredVersionIds.has(r.version_id)).map((r) => r.version_id),
    ...inbox.final_expense_approvals.filter((r) => authoredSubmissionIds.has(r.submission_id)).map((r) => r.submission_id),
  ];
  const waiting = new Set<string>([...authoredWaiting, ...(pm?.waitingIds ?? [])]);
  for (const r of decidableBudgets) waiting.delete(r.version_id);
  for (const r of decidableActuals) waiting.delete(r.submission_id);
  const waitingOnOthers = waiting.size;
  const kinds = [budgets > 0 ? "budget" : null, actuals > 0 ? "actuals" : null, settlements > 0 ? "settlement" : null].filter((k): k is string => k !== null);
  const href = kinds.length === 1 ? `/finance/project-budgets?filter=${kinds[0]}` : "/finance/project-budgets";
  const oldestOf = (xs: readonly (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
  const authoredRows = [
    ...inbox.budget_approvals.filter((r) => authoredVersionIds.has(r.version_id) && !decidableBudgets.includes(r)),
    ...inbox.final_expense_approvals.filter((r) => authoredSubmissionIds.has(r.submission_id) && !decidableActuals.includes(r)),
  ];
  const oldestDecidable = oldestOf([...decidableBudgets, ...decidableActuals].map((r) => r.submitted_at));
  const queues = [...new Set(authoredRows.map((r) => (r.approval_route ? APPROVER_NAME[r.approval_route] : null)).filter((x): x is string => !!x))];
  return {
    waitingForMe: { count: budgets + actuals + settlements, href, ...(oldestDecidable ? { oldest: oldestDecidable } : {}) },
    waitingOnOthers,
    ...(authoredRows.length > 0 ? { waitingOnOthersWith: { oldest: oldestOf(authoredRows.map((r) => r.submitted_at)), queues } } : {}),
    waitingOnOthersHref: authoredWaiting.length > 0 ? "/finance/project-budgets" : projectHref(pm?.waitingProjectIds ?? []),
    returned: { count: pm?.returned.count ?? 0, href: projectHref(pm?.returned.projectIds ?? []) },
    decidedRecently: { count: pm?.decided.count ?? 0, href: projectHref(pm?.decided.projectIds ?? []) },
  };
}
