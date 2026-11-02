import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadBudgetInbox } from "./data";
import { budgetDayFromInbox, type BudgetDay } from "./my-day";

/** "none": Project budgets are not installed here. "error": a read failed, so My Day says it could not check (never 0). */
export type BudgetDayLoad = { status: "none" } | { status: "error" } | { status: "ok"; day: BudgetDay };

/**
 * The budget rows of My Day for the signed-in person, from `pbx_inbox()` (the same source as the Finance inbox, scoped by the database). A person with
 * no budget access gets empty lists, hence no row. Which pending items the person authored is read through their own session (row-level security: Finance
 * and the author may read a submission), only for the submissions the inbox returned.
 */
export async function loadBudgetDay(userId: string): Promise<BudgetDayLoad> {
  const inbox = await loadBudgetInbox();
  if (inbox.state === "not_installed") return { status: "none" };
  if (inbox.state === "error") return { status: "error" };
  const { budget_approvals: budgets, final_expense_approvals: actuals } = inbox.inbox;
  // A reply without its lists is a failed read, never "nothing waiting".
  if (!Array.isArray(budgets) || !Array.isArray(actuals) || !Array.isArray(inbox.inbox.outstanding_settlement)) return { status: "error" };
  if (budgets.length === 0 && actuals.length === 0) return { status: "ok", day: budgetDayFromInbox(inbox.inbox, new Set(), new Set()) };
  try {
    const supabase = await createClient();
    const mine = `created_by.eq.${userId},submitted_by.eq.${userId}`;
    const [versions, submissions] = await Promise.all([
      budgets.length > 0 ? supabase.from("pbx_budget_versions").select("id").in("id", budgets.map((b) => b.version_id)).or(mine) : Promise.resolve({ data: [], error: null }),
      actuals.length > 0 ? supabase.from("pbx_actual_submissions").select("id").in("id", actuals.map((a) => a.submission_id)).or(mine) : Promise.resolve({ data: [], error: null }),
    ]);
    if (versions.error || submissions.error) return { status: "error" };
    return {
      status: "ok",
      day: budgetDayFromInbox(inbox.inbox, new Set((versions.data ?? []).map((r) => r.id as string)), new Set((submissions.data ?? []).map((r) => r.id as string))),
    };
  } catch {
    return { status: "error" };
  }
}
