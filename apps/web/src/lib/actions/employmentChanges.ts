"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEditCompensation, canRecordCareerEvent, getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { planChange } from "@/lib/hr/changes";
import type { ActionState } from "./companies";

const schema = z.object({
  employeeId: z.string().uuid(),
  effectiveDate: z.string().min(1, "Enter the date the change takes effect."),
  newJobTitle: z.string().trim().max(120, "Keep the job title under 120 characters.").optional(),
  newBasicSalary: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("Basic salary must be more than zero.").optional()),
  newOtherAllowance: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0, "Others cannot be negative.").optional()),
  note: z.string().trim().max(300, "Keep the note under 300 characters.").optional(),
});

export interface EmploymentChangeState extends ActionState {
  /** What was saved: in force now, or scheduled for its date. Null when nothing was saved. */
  saved?: { status: "applied" | "scheduled"; message: string } | null;
}

const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The ONE place a job title and/or pay change is recorded (the Employment tab's "Change job or pay", and the Compensation tab's "Change salary" shortcut, which opens the same form).
 * The database function record_employment_change does the writing in a single transaction: a change dated today or earlier is applied at once, title and pay together or not at all; a
 * later date is saved as a SCHEDULED change that the daily job applies on its date. Its own checks are the real boundary (HR Admin of the company; Finance for pay only, in force now); the
 * pre-checks below only give the same answer in words before a round trip. "Today" is the employee's own country's calendar day.
 */
export async function recordEmploymentChange(_prev: EmploymentChangeState, formData: FormData): Promise<EmploymentChangeState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;

  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  const supabase = await createClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, company_id, country_code, job_title, deleted_at")
    .eq("id", d.employeeId)
    .maybeSingle();
  if (employeeError) return { error: "Couldn’t read this employee’s record. Nothing was saved. Try again." };
  if (!employee) return { error: "You cannot see this employee record." };

  const isHr = canRecordCareerEvent(session.grants, employee.company_id);
  const canPay = canEditCompensation(session.grants, employee.company_id);
  if (!isHr && !canPay) return { error: "You are not allowed to change this employee’s job or pay." };

  const { data: current, error: compError } = await supabase
    .from("compensation_details")
    .select("base_salary, allowances")
    .eq("employee_id", employee.id)
    .eq("is_current", true)
    .maybeSingle();
  if (compError) return { error: "Couldn’t read the current pay. Nothing was saved. Try again." };
  const currentOther = typeof current?.allowances?.other === "number" ? current.allowances.other : 0;

  const today = getBusinessDateString(resolveCountryTimeZone(employee.country_code));
  const title = d.newJobTitle || null;
  const plan = planChange({
    effectiveDate: d.effectiveDate, today,
    newJobTitle: title, currentJobTitle: employee.job_title,
    newBasic: d.newBasicSalary ?? null, newOther: d.newOtherAllowance ?? null,
    currentBasic: current ? Number(current.base_salary) : null, currentOther,
  });
  if (!plan.ok) return { error: plan.error };
  if (plan.titleChanged && !isHr) return { error: "Only an HR Admin can change the job title." };
  if (plan.when === "scheduled" && !isHr) return { error: "Only an HR Admin can schedule a pay change for a later date." };
  if (plan.payChanged && !canPay) return { error: "You are not allowed to change this employee’s pay." };

  const { error } = await supabase.rpc("record_employment_change", {
    p_employee_id: employee.id,
    p_effective_date: d.effectiveDate,
    p_job_title: title,
    p_basic: d.newBasicSalary ?? null,
    p_other: d.newOtherAllowance ?? null,
    p_note: isHr ? d.note || null : null,
    p_today: today,
  });
  if (error) {
    // The database's own sentences for a refused or invalid change are written for people; anything else is not shown raw.
    if (error.code === "42501" || error.code === "22023") return { error: error.message };
    if (error.code === "42883" || error.code === "PGRST202") return { error: "Job and pay changes are not installed in this environment yet. Nothing was saved." };
    return { error: "Couldn’t save the change. Nothing was saved: the job title and pay are saved together or not at all. Try again." };
  }

  revalidatePath(`/employees/${employee.id}`);
  const what = plan.kind === "both" ? "job title and pay" : plan.kind === "job" ? "job title" : "pay";
  if (plan.when === "scheduled") {
    return { error: null, saved: { status: "scheduled", message: `Scheduled. The new ${what} takes effect on ${longDate(d.effectiveDate)}; nothing changes until then, and it is applied automatically that day.` } };
  }
  return { error: null, saved: { status: "applied", message: `Saved. The new ${what} ${plan.kind === "both" ? "are" : "is"} in force${d.effectiveDate === today ? " from today" : ` from ${longDate(d.effectiveDate)}`}.` } };
}
