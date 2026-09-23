"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addMonthsClamped } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";

/**
 * Deletes/corrects a single day's attendance record — recording it now
 * only happens through the dedicated bulk daily register
 * (bulkRecordAttendance below); the per-employee single-day input form
 * this used to pair with was removed as a duplicate entry point.
 */
export async function deleteAttendanceRecord(recordId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_records").delete().eq("id", recordId);
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

const bulkRowSchema = z.object({
  employeeId: z.string().uuid(),
  status: z.enum(["present", "absent", "leave", "holiday", "weekend"]),
  hoursWorked: z.number().min(0).max(24).optional(),
  // Set by the page from that day's real holiday/weekend data (packages/domain's
  // isWeekend + the company's public_holidays row) — trusted here rather than
  // re-derived, same tradeoff as goals_write_manager's full-row simplicity:
  // this action is HR-Admin-only regardless, per comp_ledger_insert_hr.
  isRecoveryEligible: z.boolean().optional(),
});

const bulkAttendanceSchema = z.object({
  workDate: z.string().min(1),
  rows: z.array(bulkRowSchema).min(1),
});

export interface BulkAttendanceResult {
  error: string | null;
  creditedCount: number;
}

/**
 * The daily HR register: fills in every employee's attendance for one date
 * in a single call, upserting on attendance_records' own
 * unique(employee_id, work_date) so re-saving a date corrects it rather
 * than erroring. Anyone marked "present" on a day the page flagged as a
 * public holiday or weekend earns a comp_day_ledger credit — keyed to that
 * attendance record's own id (reference_type/reference_id), so re-saving
 * the same day never double-credits.
 */
export async function bulkRecordAttendance(input: {
  workDate: string;
  rows: { employeeId: string; status: string; hoursWorked?: number; isRecoveryEligible?: boolean }[];
}): Promise<BulkAttendanceResult> {
  const parsed = bulkAttendanceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input.", creditedCount: 0 };
  const { workDate, rows } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", creditedCount: 0 };

  const { data: upserted, error } = await supabase
    .from("attendance_records")
    .upsert(
      rows.map((r) => ({
        employee_id: r.employeeId,
        work_date: workDate,
        status: r.status,
        hours_worked: r.hoursWorked ?? null,
        source: "manual",
      })),
      { onConflict: "employee_id,work_date" },
    )
    .select("id, employee_id");
  if (error) return { error: error.message, creditedCount: 0 };

  const eligibleEmployeeIds = new Set(
    rows.filter((r) => r.status === "present" && r.isRecoveryEligible).map((r) => r.employeeId),
  );
  const candidates = (upserted ?? []).filter((rec) => eligibleEmployeeIds.has(rec.employee_id));

  let creditedCount = 0;
  if (candidates.length > 0) {
    const { data: alreadyCredited } = await supabase
      .from("comp_day_ledger")
      .select("reference_id")
      .eq("reference_type", "attendance_record")
      .in(
        "reference_id",
        candidates.map((c) => c.id),
      );
    const alreadyCreditedIds = new Set((alreadyCredited ?? []).map((c) => c.reference_id));
    const toCredit = candidates.filter((c) => !alreadyCreditedIds.has(c.id));

    if (toCredit.length > 0) {
      // expiry_date has no default and nothing else sets it for this earn
      // path — without it, these entries never expire regardless of
      // country policy (computeCompDayExpiry() only ever flags an entry
      // with a non-null expiry_date). overtime_rules' comp_day_expiry_months
      // is the one field this system already has for "how long does an
      // earned comp day last" (previously read only by the now-removed
      // timesheet-overtime conversion) — reused here for the same purpose,
      // resolved per employee's own country as of the work date. A country
      // with no active overtime_rules policy, or one that doesn't define
      // this field, gets a null expiry_date — an explicit "never expires"
      // policy choice, not a bug, same as the original conversion's own
      // fallback.
      const { data: employeeCountries } = await supabase
        .from("employees")
        .select("id, country_code")
        .in(
          "id",
          toCredit.map((c) => c.employee_id),
        );
      const countryByEmployee = new Map((employeeCountries ?? []).map((e) => [e.id, e.country_code]));
      const uniqueCountries = [...new Set(countryByEmployee.values())];

      const expiryMonthsByCountry = new Map<string, number | null>();
      await Promise.all(
        uniqueCountries.map(async (countryCode) => {
          const { data: overtimeRules } = await supabase.rpc("resolve_policy", {
            p_country_code: countryCode,
            p_policy_type: "overtime_rules",
            p_as_of: workDate,
          });
          const rawMonths = (overtimeRules as Record<string, unknown> | null)?.comp_day_expiry_months;
          expiryMonthsByCountry.set(countryCode, typeof rawMonths === "number" ? rawMonths : null);
        }),
      );

      const { error: creditError } = await supabase.from("comp_day_ledger").insert(
        toCredit.map((c) => {
          const expiryMonths = expiryMonthsByCountry.get(countryByEmployee.get(c.employee_id) ?? "") ?? null;
          return {
            employee_id: c.employee_id,
            txn_date: workDate,
            entry_type: "earned" as const,
            days: 1,
            source: "holiday_worked",
            expiry_date: expiryMonths !== null ? addMonthsClamped(workDate, expiryMonths) : null,
            reference_type: "attendance_record",
            reference_id: c.id,
            created_by: user.id,
          };
        }),
      );
      if (creditError) {
        // A unique-constraint hit here (comp_day_ledger_attendance_uniq)
        // means a concurrent save already credited one of these exact
        // attendance records — surface it rather than silently reporting
        // 0 credited, so the admin knows to re-check rather than assume
        // this run credited nothing at all.
        revalidatePath("/attendance");
        return { error: `Attendance was saved, but comp-day crediting failed: ${creditError.message}`, creditedCount: 0 };
      }
      creditedCount = toCredit.length;
    }
  }

  revalidatePath("/attendance");
  return { error: null, creditedCount };
}
