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
/** One budget, final-expense set or settlement that is the person's to act on: what the My Day list names. `key` is the record's own id, so the same record is never listed twice. */
export type BudgetAttentionItem = { key: string; title: string; what: string; context?: string; at: string | null; href: string };

export type BudgetDay = {
  /** `oldest`: when the oldest item the person can decide now was submitted (null when unknown): My Day shows how long it has waited. `items` is the list behind `count`, one entry per record. */
  waitingForMe: { count: number; href: string; oldest?: string | null; items: BudgetAttentionItem[] };
  waitingOnOthers: number;
  /** Of the budgets and final expenses the person submitted themselves (read from the Finance inbox): the oldest submission and who decides them, named as the shared queue ("Finance", "the CEO or CTO"), never one invented person. */
  waitingOnOthersWith?: { oldest: string | null; queues: string[] };
  /** Where "waiting on others" opens: the Finance inbox when the person prepared items there, otherwise the budget of their project (or Projects when several). */
  waitingOnOthersHref: string;
  returned: { count: number; href: string; items: BudgetAttentionItem[] };
  decidedRecently: { count: number; href: string };
  /** The Project Manager part could not be read: My Day says so, and keeps everything that did load. */
  pmReadFailed?: boolean;
};

/** What the PM's own session read about the projects they manage (columns only; the database decides which rows they may see). */
export type PmBudgetRows = {
  budgets: { id: string; project_id: string }[];
  /** The reference and name of the projects the person manages, to name a returned budget (optional: without it the row says "Project"). */
  projects?: { id: string; reference: string; name: string }[];
  versions: { id: string; budget_id: string; seq: number; status: string; decided_at: string | null; approval_route?: string | null; submitted_at?: string | null }[];
  submissions: { id: string; budget_id: string; seq: number; status: string; decided_at: string | null; approval_route?: string | null; submitted_at?: string | null }[];
};

export type PmBudgetDay = {
  returned: { count: number; projectIds: string[]; items?: { id: string; kind: "budget" | "actuals"; projectId: string; label: string; at: string | null }[] };
  /** Ids of the submitted versions / final-expense sets still waiting for a decision on the PM's projects (and their projects, for the link). */
  waitingIds: string[];
  waitingProjectIds: string[];
  /** The same waiting items with the shared route that decides them and when they were submitted (null when the record does not say). */
  waitingDetail?: { id: string; route: string | null; at: string | null }[];
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
  const projectLabel = new Map((rows.projects ?? []).map((p) => [p.id, `${p.reference} · ${p.name}`]));
  const out: PmBudgetDay = { returned: { count: 0, projectIds: [], items: [] }, waitingIds: [], waitingProjectIds: [], waitingDetail: [], decided: { count: 0, projectIds: [] } };
  const latest = <R extends { id: string; budget_id: string; seq: number; status: string; decided_at: string | null }>(list: R[]) => {
    const best = new Map<string, (typeof list)[number]>();
    for (const r of list) {
      if (r.status === "draft" || r.status === "discarded" || !projectOf.has(r.budget_id)) continue;
      const cur = best.get(r.budget_id);
      if (!cur || r.seq > cur.seq) best.set(r.budget_id, r);
    }
    return [...best.values()];
  };
  const tagged = [...latest(rows.versions).map((r) => ({ r, kind: "budget" as const })), ...latest(rows.submissions).map((r) => ({ r, kind: "actuals" as const }))];
  for (const { r, kind } of tagged) {
    const project = projectOf.get(r.budget_id)!;
    if (r.status === "submitted") { out.waitingIds.push(r.id); out.waitingProjectIds.push(project); (out.waitingDetail ??= []).push({ id: r.id, route: r.approval_route ?? null, at: r.submitted_at ?? null }); }
    else if (r.status === "returned") { out.returned.count += 1; out.returned.projectIds.push(project); (out.returned.items ??= []).push({ id: r.id, kind, projectId: project, label: projectLabel.get(project) ?? "Project", at: r.decided_at }); }
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
  const inboxHref = (kind: string) => `/finance/project-budgets?filter=${kind}`;
  const who = (r: { company_name: string; submitted_by_name?: string | null }) => [r.company_name, r.submitted_by_name ? `submitted by ${r.submitted_by_name}` : null].filter(Boolean).join(" · ");
  const settlementRows = inbox.outstanding_settlement.filter((r) => r.has_approved_actuals && (r.i_can_confirm_receipts || (r.i_can_close && r.next === "Ready to close")));
  const waitingItems: BudgetAttentionItem[] = [
    ...decidableBudgets.map((r) => ({ key: `budget:${r.version_id}`, title: `${r.reference} · ${r.name}`, what: r.kind === "addition" ? "Budget addition waiting for your decision" : "Project budget waiting for your decision", context: who(r), at: r.submitted_at, href: inboxHref("budget") })),
    ...decidableActuals.map((r) => ({ key: `actuals:${r.submission_id}`, title: `${r.reference} · ${r.name}`, what: "Final expenses waiting for your decision", context: who(r), at: r.submitted_at, href: inboxHref("actuals") })),
    ...settlementRows.map((r) => ({ key: `settlement:${r.budget_id}`, title: `${r.reference} · ${r.name}`, what: r.i_can_confirm_receipts ? "Settlement: receipts to confirm" : "Settlement ready to close", context: r.company_name, at: null, href: inboxHref("settlement") })),
  ];
  const oldestOf = (xs: readonly (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
  const oldestDecidable = oldestOf([...decidableBudgets, ...decidableActuals].map((r) => r.submitted_at));
  const authoredRows = [
    ...inbox.budget_approvals.filter((r) => authoredVersionIds.has(r.version_id) && !decidableBudgets.includes(r)).map((r) => ({ id: r.version_id, route: r.approval_route as string | null, at: r.submitted_at })),
    ...inbox.final_expense_approvals.filter((r) => authoredSubmissionIds.has(r.submission_id) && !decidableActuals.includes(r)).map((r) => ({ id: r.submission_id, route: r.approval_route as string | null, at: r.submitted_at })),
  ];
  // The Project Manager's own waiting items (from the budget records of their projects) say the same: which shared route decides them and since when. Counted once per item.
  const detailRows = [...authoredRows, ...(pm?.waitingDetail ?? []).filter((d) => waiting.has(d.id) && !authoredRows.some((a) => a.id === d.id))];
  const routeNames = (rows: { route: string | null }[]) => [...new Set(rows.map((r) => (r.route === "finance" || r.route === "executive" ? APPROVER_NAME[r.route] : null)).filter((x): x is string => !!x))];
  return {
    waitingForMe: { count: budgets + actuals + settlements, href, ...(oldestDecidable ? { oldest: oldestDecidable } : {}), items: waitingItems },
    waitingOnOthers,
    ...(detailRows.length > 0 ? { waitingOnOthersWith: { oldest: oldestOf(detailRows.map((r) => r.at)), queues: routeNames(detailRows) } } : {}),
    waitingOnOthersHref: authoredWaiting.length > 0 ? "/finance/project-budgets" : projectHref(pm?.waitingProjectIds ?? []),
    returned: {
      count: pm?.returned.count ?? 0, href: projectHref(pm?.returned.projectIds ?? []),
      items: (pm?.returned.items ?? []).map((r) => ({ key: `${r.kind === "budget" ? "budget" : "actuals"}:${r.id}`, title: r.label, what: r.kind === "budget" ? "Project budget returned to you" : "Final expenses returned to you", at: r.at, href: `/projects/${r.projectId}/budget` })),
    },
    decidedRecently: { count: pm?.decided.count ?? 0, href: projectHref(pm?.decided.projectIds ?? []) },
  };
}
