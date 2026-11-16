"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canCorrectPayRecord } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { impactLines, numericAllowances, payCorrectionErrorMessage, type PayCorrectionImpact } from "@/lib/hr/payCorrection";
import type { ActionState } from "./companies";

const schema = z.object({
  employeeId: z.string().uuid(),
  compensationId: z.string().uuid(),
  requestKey: z.string().min(8).max(100),
  effectiveDate: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the pay record really took effect.").optional()),
  basicSalary: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("Basic salary must be more than zero.").optional()),
  /** The allowances as a whole object, as the form shows them. */
  allowances: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().optional()),
  reason: z.string().trim().min(5, "Enter the reason for the correction (at least 5 characters).").max(500, "Keep the reason under 500 characters."),
});

export interface PayCorrectionState extends ActionState {
  /** What was saved. Null when nothing was saved. */
  saved?: {
    message: string;
    /** "This correction affects ..." sentences for a person to review with Finance or payroll; empty when no approved payroll or settlement uses the record. */
    affects: string[];
    /** True when this was a repeat of a correction already saved (the same request): nothing was applied a second time. */
    repeat: boolean;
  } | null;
}

/**
 * Corrects ONE pay record (a mistaken effective date, basic salary or allowances) and keeps the original. HR Admin or Finance of the employee's company, the same permission as changing pay;
 * the database function correct_pay_record is the real boundary (it locks the employee, checks dates against the neighbouring records and any scheduled changes, stores the original values, and
 * lists the approved payroll runs and final settlement that use the record WITHOUT changing them). This action only gives the same refusals in words before a round trip, sends a request key so a
 * repeated press never applies twice, and puts the database's answer into plain sentences. It never shows a raw database message.
 */
export async function correctPayRecord(_prev: PayCorrectionState, formData: FormData): Promise<PayCorrectionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;

  let allowances: Record<string, number> | null = null;
  if (d.allowances !== undefined) {
    try {
      const raw: unknown = JSON.parse(d.allowances);
      allowances = numericAllowances(raw);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(allowances).length !== Object.keys(raw as object).length) return { error: "The allowances are not valid. Reload the page and try again." };
      if (Object.values(allowances).some((v) => v < 0)) return { error: "Allowances must be numbers of zero or more." };
    } catch {
      return { error: "The allowances are not valid. Reload the page and try again." };
    }
  }

  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  const supabase = await createClient();

  const { data: record, error: recordError } = await supabase
    .from("compensation_details")
    .select("id, employee_id, effective_from, base_salary, allowances")
    .eq("id", d.compensationId)
    .eq("employee_id", d.employeeId)
    .maybeSingle();
  if (recordError) return { error: "Couldn’t read this pay record. Nothing was changed. Try again." };
  if (!record) return { error: "You cannot see this pay record." };
  const { data: employee, error: employeeError } = await supabase.from("employees").select("id, company_id").eq("id", d.employeeId).maybeSingle();
  if (employeeError) return { error: "Couldn’t read this employee’s record. Nothing was changed. Try again." };
  if (!employee) return { error: "You cannot see this employee record." };
  if (!canCorrectPayRecord(session.grants, employee.company_id)) return { error: "You are not allowed to correct this pay record." };

  const sameDate = d.effectiveDate === undefined || d.effectiveDate === record.effective_from;
  const sameBasic = d.basicSalary === undefined || d.basicSalary === Number(record.base_salary);
  const sameAllowances = allowances === null || JSON.stringify(Object.entries(allowances).sort()) === JSON.stringify(Object.entries(numericAllowances(record.allowances)).sort());
  if (sameDate && sameBasic && sameAllowances) return { error: "Nothing changed. Enter a new effective date and/or new pay." };

  const { data: result, error } = await supabase.rpc("correct_pay_record", {
    p_compensation_id: record.id,
    p_effective_from: sameDate ? null : (d.effectiveDate ?? null),
    p_basic: sameBasic ? null : (d.basicSalary ?? null),
    p_allowances: sameAllowances ? null : allowances,
    p_reason: d.reason,
    p_request_key: d.requestKey,
  });
  if (error) return { error: payCorrectionErrorMessage(error) };

  revalidatePath(`/employees/${employee.id}`);
  const done = (result ?? {}) as { status?: string; impact?: PayCorrectionImpact };
  const affects = impactLines(done.impact);
  const repeat = done.status === "already_applied";
  return {
    error: null,
    saved: {
      repeat,
      affects,
      message: repeat
        ? "This correction was already saved. Nothing was applied a second time."
        : "Saved. The pay record is corrected, and the original figures and dates stay on its entry in the history.",
    },
  };
}
