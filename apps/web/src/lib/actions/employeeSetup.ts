"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEditEmployeeCore } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

const ALREADY = "Opening balances were already recorded for this employee.";

const openingSchema = z.object({
  employeeId: z.string().uuid(),
  openingAnnualLeaveDays: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0, "Days cannot be negative.").optional()),
  openingCompDays: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0, "Days cannot be negative.").optional()),
});

const isDuplicate = (e: { code?: string; message?: string } | null) => !!e && (e.code === "23505" || /duplicate key|unique/i.test(e.message ?? ""));

/**
 * Records an employee's carried-over annual leave and/or comp days ONCE (the setup step "Opening balances").
 *
 * The same rows the create form used to write: a `leave_ledger` adjustment tagged `reference_type = 'opening_balance'` and a `comp_day_ledger` earned entry with
 * `source = 'opening_balance'` (the leave-accrual job's baseline depends on those tags), dated the hire date. Repeating the step, or a second click that races the
 * first, can never post a second entry: a kind (annual leave, comp days) that already has an opening-balance row is refused, and the partial unique indexes on both
 * ledgers make the database refuse a concurrent duplicate too (`23505` is reported as "already recorded"). The other kind can still be completed on its own. The company is read from the employee row, never from the form, and the caller must be HR
 * Admin of that company (the ledgers' own insert policies decide again).
 */
export async function recordOpeningBalances(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = openingSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
  const d = p.data;
  if (!d.openingAnnualLeaveDays && !d.openingCompDays) return { error: "Enter annual leave days and/or comp days. Leave this step alone for a fresh start." };

  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  const supabase = await createClient();

  const { data: employee } = await supabase.from("employees").select("id, company_id, hire_date, deleted_at").eq("id", d.employeeId).maybeSingle();
  if (!employee) return { error: "You cannot see this employee record." };
  if (employee.deleted_at) return { error: "This employee record was removed. Restore it before recording balances." };
  if (!canEditEmployeeCore(session.grants, employee.company_id)) return { error: "Only an HR Admin of this employee's company can record opening balances." };

  const [{ count: leaveRows, error: leaveReadError }, { count: compRows, error: compReadError }] = await Promise.all([
    supabase.from("leave_ledger").select("id", { count: "exact", head: true }).eq("employee_id", employee.id).eq("reference_type", "opening_balance"),
    supabase.from("comp_day_ledger").select("id", { count: "exact", head: true }).eq("employee_id", employee.id).eq("source", "opening_balance"),
  ]);
  if (leaveReadError || compReadError) return { error: "Could not check whether opening balances were already recorded. Nothing was saved. Try again." };
  // Each kind is recorded once on its own: a kind already on the ledger is never added again, the other can still be completed.
  const leaveDays = d.openingAnnualLeaveDays ?? 0;
  const compDays = d.openingCompDays ?? 0;
  const wantLeave = leaveDays > 0;
  const wantComp = compDays > 0;
  const doLeave = wantLeave && (leaveRows ?? 0) === 0;
  const doComp = wantComp && (compRows ?? 0) === 0;
  if (!doLeave && !doComp) return { error: ALREADY };
  const skipped = [wantLeave && !doLeave ? "annual leave" : null, wantComp && !doComp ? "comp days" : null].filter((x): x is string => x !== null);

  const saved: string[] = [];
  const notes: string[] = skipped.length ? [`${skipped.join(" and ")} ${skipped.length > 1 ? "were" : "was"} already recorded and not added again.`] : [];
  if (doLeave) {
    const { error } = await supabase.from("leave_ledger").insert({
      employee_id: employee.id,
      leave_type_code: "annual",
      txn_date: employee.hire_date,
      entry_type: "adjustment",
      amount_days: leaveDays,
      reference_type: "opening_balance",
      note: "Opening annual leave balance recorded at onboarding",
      created_by: session.userId,
    });
    if (isDuplicate(error)) notes.push("Annual leave was already recorded and not added again.");
    else if (error) return { error: `The annual leave opening balance could not be saved (${error.message}). Nothing was saved.` };
    else saved.push("annual leave");
  }

  if (doComp) {
    const { error } = await supabase.from("comp_day_ledger").insert({
      employee_id: employee.id,
      txn_date: employee.hire_date,
      entry_type: "earned",
      days: compDays,
      source: "opening_balance",
      reference_type: "manual_adjustment",
      created_by: session.userId,
    });
    if (isDuplicate(error)) notes.push("Comp days were already recorded and not added again.");
    else if (error) {
      revalidatePath(`/employees/${employee.id}`);
      return saved.length
        ? { error: null, warning: `Annual leave was saved, but the comp days were not (${error.message}). Open this step again to record the comp days.` }
        : { error: `The comp-day opening balance could not be saved (${error.message}). Nothing was saved.` };
    } else saved.push("comp days");
  }

  if (saved.length === 0) return { error: ALREADY };
  revalidatePath(`/employees/${employee.id}`);
  return { error: null, warning: notes.length ? notes.join(" ") : null };
}
