"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Deletes/corrects a single day's attendance record — recording it now
 * only happens through the dedicated bulk daily register
 * (bulkRecordAttendance below); the per-employee single-day input form
 * this used to pair with was removed as a duplicate entry point.
 *
 * Goes through delete_attendance_record() rather than a bare table delete:
 * a plain delete would leave any active comp_day_ledger 'earned' credit for
 * this record orphaned (referencing a row that no longer exists) instead of
 * reversing it atomically first.
 */
export async function deleteAttendanceRecord(recordId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_attendance_record", { p_record_id: recordId });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/attendance");
  return { error: error ? "Could not delete this attendance record. Please try again." : null };
}

const bulkRowSchema = z.object({
  employeeId: z.string().uuid(),
  status: z.enum(["not_recorded", "present", "absent", "leave", "partial_day"]),
  workMode: z.enum(["office", "client_site", "work_from_home", "field_work", "business_travel"]).optional(),
  hoursWorked: z.number().min(0).max(24).optional(),
});

const bulkAttendanceSchema = z.object({
  workDate: z.string().min(1),
  rows: z.array(bulkRowSchema).min(1),
});

export interface BulkAttendanceResult {
  error: string | null;
  creditedCount: number;
  needsPolicyReviewCount: number;
}

/**
 * The daily HR register: fills in *only the rows the admin actually
 * touched* for one date in a single call — an untouched "Not recorded"
 * default is never written, so opening a day and clicking Save without
 * changing anything creates zero rows instead of one per employee. All of
 * what IS sent — the attendance upsert, re-deriving whether today is a
 * recovery day (weekend/public holiday), and any resulting comp-day credit
 * or reversal — happens inside record_attendance_and_recovery(), one
 * atomic transaction per call. Nothing here tells the database whether a
 * day is a recovery day; that's re-derived server-side from
 * countries.week_start_day and public_holidays every time, never trusted
 * from the browser.
 */
export async function bulkRecordAttendance(input: {
  workDate: string;
  rows: { employeeId: string; status: string; workMode?: string; hoursWorked?: number }[];
}): Promise<BulkAttendanceResult> {
  const parsed = bulkAttendanceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input.", creditedCount: 0, needsPolicyReviewCount: 0 };
  const { workDate, rows } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", creditedCount: 0, needsPolicyReviewCount: 0 };

  const { data, error } = await supabase.rpc("record_attendance_and_recovery", {
    p_work_date: workDate,
    p_rows: rows.map((r) => ({
      employee_id: r.employeeId,
      status: r.status,
      work_mode: r.workMode ?? null,
      hours_worked: r.hoursWorked ?? null,
    })),
  });
  if (error) return { error: "Could not save attendance. Please try again.", creditedCount: 0, needsPolicyReviewCount: 0 };

  revalidatePath("/attendance");
  const creditedCount = (data ?? []).filter((r) => r.credited).length;
  const needsPolicyReviewCount = (data ?? []).filter((r) => r.needs_policy_review).length;
  return { error: null, creditedCount, needsPolicyReviewCount };
}
