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
