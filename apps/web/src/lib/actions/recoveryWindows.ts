"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localDateTimeToUtcIso, resolveCountryTimeZone } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";

export interface RecoveryActionResult {
  error: string | null;
}

const WORK_MODES = ["office", "wfh", "site_work", "client_meeting", "business_travel"] as const;

function revalidateRecoveryPages() {
  revalidatePath("/attendance");
  revalidatePath("/attendance-clock");
  revalidatePath("/approvals");
  revalidatePath("/alerts");
  revalidatePath("/");
}

/**
 * Wall-clock times HR types are ALWAYS interpreted in the EMPLOYEE'S own
 * employment-country timezone — never the HR user's browser or device. The
 * timezone is looked up server-side from the employee record, so the browser
 * cannot choose one.
 */
async function employeeTimeZone(employeeId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("country_code").eq("id", employeeId).maybeSingle();
  if (!data) return null;
  return resolveCountryTimeZone(data.country_code);
}

const correctSchema = z.object({
  sessionId: z.string().uuid(),
  clockInLocal: z.string().min(1, "Enter the corrected clock-in."),
  clockOutLocal: z.string().min(1, "Enter the corrected clock-out."),
  reason: z.string().trim().min(1, "A reason is required."),
});

/** HR corrects the recorded start/end of a CLOSED session (hr_correct_attendance_session). */
export async function correctAttendanceSession(input: z.input<typeof correctSchema>): Promise<RecoveryActionResult> {
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: session } = await supabase.from("attendance_sessions").select("employee_id").eq("id", d.sessionId).maybeSingle();
  if (!session) return { error: "Attendance session not found." };
  const timeZone = await employeeTimeZone(session.employee_id);
  if (!timeZone) return { error: "Employee not found." };

  const clockIn = localDateTimeToUtcIso(timeZone, d.clockInLocal);
  const clockOut = localDateTimeToUtcIso(timeZone, d.clockOutLocal);
  if (!clockIn || !clockOut) return { error: `That time does not exist in ${timeZone} (a daylight-saving gap). Pick another time.` };

  const { error } = await supabase.rpc("hr_correct_attendance_session", {
    p_session_id: d.sessionId,
    p_clock_in_at: clockIn,
    p_clock_out_at: clockOut,
    p_reason: d.reason,
  });
  revalidateRecoveryPages();
  return { error: error?.message ?? null };
}

const addMissingSchema = z.object({
  employeeId: z.string().uuid(),
  clockInLocal: z.string().min(1, "Enter the clock-in."),
  clockOutLocal: z.string().min(1, "Enter the clock-out."),
  workMode: z.enum(WORK_MODES),
  projectName: z.string().trim().optional(),
  projectLeadEmployeeId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(1, "A reason is required."),
});

/** "Add missing attendance": a past shift HR records on the employee's behalf, flagged "Recorded by HR". */
export async function addMissingAttendance(input: z.input<typeof addMissingSchema>): Promise<RecoveryActionResult> {
  const parsed = addMissingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const timeZone = await employeeTimeZone(d.employeeId);
  if (!timeZone) return { error: "Employee not found." };
  const clockIn = localDateTimeToUtcIso(timeZone, d.clockInLocal);
  const clockOut = localDateTimeToUtcIso(timeZone, d.clockOutLocal);
  if (!clockIn || !clockOut) return { error: `That time does not exist in ${timeZone} (a daylight-saving gap). Pick another time.` };

  const supabase = await createClient();
  const { error } = await supabase.rpc("hr_add_missing_attendance", {
    p_employee_id: d.employeeId,
    p_clock_in_at: clockIn,
    p_clock_out_at: clockOut,
    p_work_mode: d.workMode,
    p_project_name: d.projectName || null,
    p_project_lead_employee_id: d.projectLeadEmployeeId || null,
    p_reason: d.reason,
  });
  revalidateRecoveryPages();
  return { error: error?.message ?? null };
}

const verifySchema = z.object({ windowId: z.string().uuid(), note: z.string().trim().min(1, "Describe what you checked.") });

/** HR verifies a window that carries a review condition (forgotten clock-out, unusual long work, travel, ...). */
export async function verifyRecoveryWindow(input: z.input<typeof verifySchema>): Promise<RecoveryActionResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hr_verify_recovery_window", { p_window_id: parsed.data.windowId, p_note: parsed.data.note });
  revalidateRecoveryPages();
  return { error: error?.message ?? null };
}

const reductionSchema = z.object({ requestId: z.string().uuid(), note: z.string().trim().min(1, "A note is required.") });

/** HR explicitly acknowledges a reduction that touches credit already used (never a silent negative balance). */
export async function acknowledgeRecoveryReduction(input: z.input<typeof reductionSchema>): Promise<RecoveryActionResult> {
  const parsed = reductionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hr_acknowledge_recovery_reduction", { p_request_id: parsed.data.requestId, p_note: parsed.data.note });
  revalidateRecoveryPages();
  return { error: error?.message ?? null };
}

const alertSchema = z.object({ alertId: z.string().uuid(), note: z.string().trim().optional() });

export async function acknowledgeRecoveryAlert(input: z.input<typeof alertSchema>): Promise<RecoveryActionResult> {
  const parsed = alertSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_recovery_alert", { p_alert_id: parsed.data.alertId, p_note: parsed.data.note || null });
  revalidateRecoveryPages();
  return { error: error?.message ?? null };
}

export interface RecoveryWindowsDraftResult {
  error: string | null;
  results: { countryCode: string; versionNo: number | null; action: string }[];
}

/** Creates the NEXT Recovery Leave version as a DRAFT for UAE/Saudi Arabia/Poland. Never activates anything. */
export async function createRecoveryWindowsPolicyDrafts(): Promise<RecoveryWindowsDraftResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seed_recovery_windows_policy_drafts");
  revalidatePath("/policies");
  if (error) return { error: error.message, results: [] };
  return { error: null, results: (data ?? []).map((r) => ({ countryCode: r.country_code, versionNo: r.version_no, action: r.action })) };
}

const activateSchema = z.object({
  policyVersionId: z.string().uuid(),
  /** HR Admin chooses the date. The CEO/CTO omit it: they may only activate on the date HR already set on the draft. */
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the effective date.")
    .nullish(),
});

/**
 * The ONLY activation path for a window-based Recovery Leave policy. Who may use it is the same as for every other policy
 * version (HR Admin, or CEO/CTO activating without changing the draft; never the drafter) — the database enforces that,
 * the controlled effective date, and that the 5-minute processor is verified running.
 */
export async function activateRecoveryWindowsPolicy(input: z.input<typeof activateSchema>): Promise<RecoveryActionResult> {
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_recovery_windows_policy", {
    p_policy_version_id: parsed.data.policyVersionId,
    p_effective_from: parsed.data.effectiveFrom ?? null,
  });
  revalidatePath("/policies");
  revalidatePath(`/policies/${parsed.data.policyVersionId}`);
  revalidatePath("/alerts");
  return { error: error?.message ?? null };
}

const deactivateSchema = z.object({
  policyVersionId: z.string().uuid(),
  lastEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day the window rules apply."),
});

/** Stops the window model for NEW working periods from the day after the chosen date. Deletes and rewrites nothing. */
export async function deactivateRecoveryWindowsPolicy(input: z.input<typeof deactivateSchema>): Promise<RecoveryActionResult> {
  const parsed = deactivateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_recovery_windows_policy", {
    p_policy_version_id: parsed.data.policyVersionId,
    p_last_effective_date: parsed.data.lastEffectiveDate,
  });
  revalidatePath("/policies");
  revalidatePath(`/policies/${parsed.data.policyVersionId}`);
  revalidatePath("/alerts");
  return { error: error?.message ?? null };
}

const plannedDateSchema = z.object({
  policyVersionId: z.string().uuid(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the planned effective date."),
});

/**
 * HR Admin sets the planned effective date ON THE DRAFT (the existing draft-edit path: a plain update that RLS and
 * guard_policy_version_update already restrict to HR Admin). The CEO/CTO then activate on exactly that date — they can
 * never change it.
 */
export async function setRecoveryWindowsDraftDate(input: z.input<typeof plannedDateSchema>): Promise<RecoveryActionResult> {
  const parsed = plannedDateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("policy_versions")
    .update({ effective_from: parsed.data.plannedDate })
    .eq("id", parsed.data.policyVersionId)
    .eq("status", "draft");
  revalidatePath(`/policies/${parsed.data.policyVersionId}`);
  return { error: error?.message ?? null };
}

const closeSchema = z.object({
  sessionId: z.string().uuid(),
  clockOutLocal: z.string().min(1, "Enter the clock-out time."),
  reason: z.string().trim().min(1, "A reason is required."),
});

/**
 * "Close missing clock-out" for a session still open: HR sets the end time (in the
 * EMPLOYEE'S own timezone) with a mandatory reason. Wraps hr_close_attendance_session(),
 * which refuses a future time; the original clock-in is never altered.
 */
export async function closeMissingClockOut(input: z.input<typeof closeSchema>): Promise<RecoveryActionResult> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: session } = await supabase.from("attendance_sessions").select("employee_id").eq("id", d.sessionId).maybeSingle();
  if (!session) return { error: "Attendance session not found." };
  const timeZone = await employeeTimeZone(session.employee_id);
  if (!timeZone) return { error: "Employee not found." };
  const clockOut = localDateTimeToUtcIso(timeZone, d.clockOutLocal);
  if (!clockOut) return { error: `That time does not exist in ${timeZone} (a daylight-saving gap). Pick another time.` };

  const { error } = await supabase.rpc("hr_close_attendance_session", {
    p_session_id: d.sessionId,
    p_corrected_clock_out_at: clockOut,
    p_reason: d.reason,
  });
  revalidateRecoveryPages();
  return { error: error?.message ?? null };
}
