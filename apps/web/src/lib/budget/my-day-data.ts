import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/projects/format";
import { loadBudgetInbox } from "./data";
import { budgetDayFromInbox, pmBudgetDay, type BudgetDay, type PmBudgetDay, type PmBudgetRows } from "./my-day";

/** "none": Project budgets are not installed here. "error": a read failed, so My Day says it could not check (never 0). */
export type BudgetDayLoad = { status: "none" } | { status: "error" } | { status: "ok"; day: BudgetDay };

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * What the signed-in person's own session can read about the budgets of the projects they MANAGE (the current Project Manager, or an acting one): the budget, its versions and
 * the final-expense sets. Row-level security already gives the current PM exactly that and nothing about other projects. null = the person manages no open project.
 * Throws on a failed read (the caller keeps what did load and says this part could not).
 */
async function loadPmBudgetRows(supabase: SupabaseClient, userId: string): Promise<PmBudgetRows | null> {
  const [own, acting] = await Promise.all([
    supabase.from("proj_projects").select("id, reference, name").eq("pm_user_id", userId).not("status", "in", "(completed,archived)").limit(200),
    supabase.from("proj_project_members").select("project_id").eq("user_id", userId).eq("role", "acting_pm").is("removed_at", null).gte("acting_until", todayIso()).limit(200),
  ]);
  if (own.error || acting.error) throw new Error("projects you manage could not be read");
  const projectIds = [...new Set([...(own.data ?? []).map((p) => p.id as string), ...(acting.data ?? []).map((m) => m.project_id as string)])];
  if (projectIds.length === 0) return null;
  const projects = ((own.data ?? []) as { id: string; reference: string; name: string }[]).filter((p) => typeof p.reference === "string");
  const budgets = await supabase.from("pbx_budgets").select("id, project_id").in("project_id", projectIds);
  if (budgets.error) throw new Error("budgets could not be read");
  const budgetIds = (budgets.data ?? []).map((b) => b.id as string);
  if (budgetIds.length === 0) return { projects, budgets: [], versions: [], submissions: [] };
  const [versions, submissions] = await Promise.all([
    supabase.from("pbx_budget_versions").select("id, budget_id, seq, status, decided_at, approval_route, submitted_at").in("budget_id", budgetIds),
    supabase.from("pbx_actual_submissions").select("id, budget_id, seq, status, decided_at, approval_route, submitted_at").in("budget_id", budgetIds),
  ]);
  if (versions.error || submissions.error) throw new Error("budget versions could not be read");
  return {
    projects,
    budgets: (budgets.data ?? []) as PmBudgetRows["budgets"],
    versions: (versions.data ?? []) as PmBudgetRows["versions"],
    submissions: (submissions.data ?? []) as PmBudgetRows["submissions"],
  };
}

/**
 * The budget rows of My Day for the signed-in person, from `pbx_inbox()` (the same source as the Finance inbox, scoped by the database) and, for a Project Manager, from the
 * authoritative budget records of the projects they manage. A person with no budget access and no project gets empty lists, hence no row. Which pending items the person authored
 * is read through their own session (row-level security: Finance and the author may read a submission), only for the submissions the inbox returned. A failed read of the PM part
 * keeps the rest and sets `pmReadFailed`; a failed inbox read is an error (never 0).
 */
export async function loadBudgetDay(userId: string): Promise<BudgetDayLoad> {
  const inbox = await loadBudgetInbox();
  if (inbox.state === "not_installed") return { status: "none" };
  if (inbox.state === "error") return { status: "error" };
  const { budget_approvals: budgets, final_expense_approvals: actuals } = inbox.inbox;
  // A reply without its lists is a failed read, never "nothing waiting".
  if (!Array.isArray(budgets) || !Array.isArray(actuals) || !Array.isArray(inbox.inbox.outstanding_settlement)) return { status: "error" };
  try {
    const supabase = await createClient();
    const mine = `created_by.eq.${userId},submitted_by.eq.${userId}`;
    const [versions, submissions, pm] = await Promise.all([
      budgets.length > 0 ? supabase.from("pbx_budget_versions").select("id").in("id", budgets.map((b) => b.version_id)).or(mine) : Promise.resolve({ data: [], error: null }),
      actuals.length > 0 ? supabase.from("pbx_actual_submissions").select("id").in("id", actuals.map((a) => a.submission_id)).or(mine) : Promise.resolve({ data: [], error: null }),
      loadPmBudgetRows(supabase, userId).then((rows) => ({ rows, failed: false }), () => ({ rows: null, failed: true })),
    ]);
    if (versions.error || submissions.error) return { status: "error" };
    const pmDay: PmBudgetDay | null = pm.rows ? pmBudgetDay(pm.rows, new Date()) : null;
    const day = budgetDayFromInbox(inbox.inbox, new Set((versions.data ?? []).map((r) => r.id as string)), new Set((submissions.data ?? []).map((r) => r.id as string)), pmDay);
    return { status: "ok", day: pm.failed ? { ...day, pmReadFailed: true } : day };
  } catch {
    return { status: "error" };
  }
}
