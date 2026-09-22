"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

const recordAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().min(1),
  status: z.enum(["present", "absent", "leave", "holiday", "weekend"]),
  clockIn: z.string().optional(),
  clockOut: z.string().optional(),
  hoursWorked: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).max(24).optional()),
});

/**
 * Records or corrects a single day's attendance — attendance_write is HR
 * Admin only (manual entry/import), never self-service. Keyed on the
 * table's own unique(employee_id, work_date), so re-submitting the same
 * date corrects it in place instead of erroring.
 */
export async function recordAttendance(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = recordAttendanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("attendance_records").upsert(
    {
      employee_id: d.employeeId,
      work_date: d.workDate,
      status: d.status,
      clock_in: d.clockIn ? new Date(`${d.workDate}T${d.clockIn}`).toISOString() : null,
      clock_out: d.clockOut ? new Date(`${d.workDate}T${d.clockOut}`).toISOString() : null,
      hours_worked: d.hoursWorked ?? null,
      source: "manual",
    },
    { onConflict: "employee_id,work_date" },
  );
  if (error) return { error: error.message };

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

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
      const { error: creditError } = await supabase.from("comp_day_ledger").insert(
        toCredit.map((c) => ({
          employee_id: c.employee_id,
          txn_date: workDate,
          entry_type: "earned",
          days: 1,
          source: "holiday_worked",
          reference_type: "attendance_record",
          reference_id: c.id,
          created_by: user.id,
        })),
      );
      if (!creditError) creditedCount = toCredit.length;
    }
  }

  revalidatePath("/attendance");
  return { error: null, creditedCount };
}
