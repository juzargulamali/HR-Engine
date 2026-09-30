"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface AttendanceClockActionResult {
  error: string | null;
}

const locationSchema = z
  .object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    accuracyMeters: z.number().optional(),
    permissionStatus: z.enum(["granted", "denied", "unavailable", "timeout"]),
  })
  .optional();

// Shared by clock_in()/switch_work_segment() below — a Site work /
// Installation segment always needs a project name and lead (see
// attendance_segments' own check constraint in schema.sql); every other
// mode may supply them when relevant but is never required to.
function toLocationArg(loc: z.infer<typeof locationSchema>) {
  if (!loc) return null;
  return {
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
    accuracy_meters: loc.accuracyMeters ?? null,
    permission_status: loc.permissionStatus,
  };
}

const clockInSchema = z.object({
  workMode: z.enum(["office", "wfh", "site_work", "client_meeting", "business_travel"]),
  projectName: z.string().optional(),
  projectLeadEmployeeId: z.string().uuid().optional(),
  location: locationSchema,
});

/**
 * Starts a brand-new attendance session for the CALLER'S OWN employee row —
 * clock_in() itself resolves current_employee_id() server-side, never a
 * client-supplied employee id. p_location is only ever meaningful (and only
 * ever sent) for site_work; see that RPC's own doc comment for why
 * permission denial/unavailability never blocks clocking.
 */
export async function clockIn(input: {
  workMode: "office" | "wfh" | "site_work" | "client_meeting" | "business_travel";
  projectName?: string;
  projectLeadEmployeeId?: string;
  location?: { latitude?: number; longitude?: number; accuracyMeters?: number; permissionStatus: "granted" | "denied" | "unavailable" | "timeout" };
}): Promise<AttendanceClockActionResult> {
  const parsed = clockInSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_in", {
    p_work_mode: d.workMode,
    p_project_name: d.projectName || null,
    p_project_lead_employee_id: d.projectLeadEmployeeId || null,
    p_location: toLocationArg(d.location),
  });

  revalidatePath("/attendance-clock");
  revalidatePath("/");
  return { error: error?.message ?? null };
}

const switchWorkSegmentSchema = z.object({
  workMode: z.enum(["office", "wfh", "site_work", "client_meeting", "business_travel"]),
  projectName: z.string().optional(),
  projectLeadEmployeeId: z.string().uuid().optional(),
  closingLocation: locationSchema,
  openingLocation: locationSchema,
});

/**
 * Changes work mode/project mid-shift WITHOUT ending the overall attendance
 * session — see switch_work_segment()'s own doc comment for why this takes
 * two independent location params (the segment being CLOSED and the one
 * being OPENED are each only ever site_work-gated on their own terms).
 */
export async function switchWorkSegment(input: {
  workMode: "office" | "wfh" | "site_work" | "client_meeting" | "business_travel";
  projectName?: string;
  projectLeadEmployeeId?: string;
  closingLocation?: { latitude?: number; longitude?: number; accuracyMeters?: number; permissionStatus: "granted" | "denied" | "unavailable" | "timeout" };
  openingLocation?: { latitude?: number; longitude?: number; accuracyMeters?: number; permissionStatus: "granted" | "denied" | "unavailable" | "timeout" };
}): Promise<AttendanceClockActionResult> {
  const parsed = switchWorkSegmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("switch_work_segment", {
    p_work_mode: d.workMode,
    p_project_name: d.projectName || null,
    p_project_lead_employee_id: d.projectLeadEmployeeId || null,
    p_closing_location: toLocationArg(d.closingLocation),
    p_opening_location: toLocationArg(d.openingLocation),
  });

  revalidatePath("/attendance-clock");
  revalidatePath("/");
  return { error: error?.message ?? null };
}

const clockOutSchema = z.object({ location: locationSchema });

/**
 * Ends the whole attendance session — closes the open segment, then
 * re-derives Recovery Leave eligibility for every local date the session's
 * segments touch (sync_attendance_recovery_for_day(), inside clock_out()
 * itself). p_location is only meaningful when the closing segment is
 * site_work.
 */
export async function clockOut(input: {
  location?: { latitude?: number; longitude?: number; accuracyMeters?: number; permissionStatus: "granted" | "denied" | "unavailable" | "timeout" };
}): Promise<AttendanceClockActionResult> {
  const parsed = clockOutSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_out", { p_location: toLocationArg(d.location) });

  revalidatePath("/attendance-clock");
  revalidatePath("/");
  return { error: error?.message ?? null };
}

const hrCloseSchema = z.object({
  sessionId: z.string().uuid(),
  correctedClockOutAt: z.string().min(1),
  reason: z.string().min(1, "A reason is required."),
});

/**
 * HR's correction for a forgotten clock-out (see hr_close_attendance_session()
 * in schema.sql) — the ONLY way an attendance_sessions row is ever closed by
 * anyone other than the employee themselves, and the one place a clock
 * event's timing is asserted rather than observed, which is exactly why a
 * reason is mandatory.
 */
export async function hrCloseAttendanceSession(input: {
  sessionId: string;
  correctedClockOutAt: string;
  reason: string;
}): Promise<AttendanceClockActionResult> {
  const parsed = hrCloseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("hr_close_attendance_session", {
    p_session_id: d.sessionId,
    p_corrected_clock_out_at: d.correctedClockOutAt,
    p_reason: d.reason,
  });

  revalidatePath("/attendance-clock");
  revalidatePath("/attendance");
  return { error: error?.message ?? null };
}

const resolveProjectLeadSchema = z.object({
  requestId: z.string().uuid(),
  projectLeadEmployeeId: z.string().uuid(),
});

/**
 * Supplies the missing project lead for a self-clock recovery-credit
 * candidate that synced as "ordinary employee, not self-led" but never
 * captured one (Office/WFH work only requires a lead "when relevant" — see
 * resolve_recovery_credit_project_lead()'s own doc comment). Completes
 * routing in the same call.
 */
export async function resolveRecoveryCreditProjectLead(input: {
  requestId: string;
  projectLeadEmployeeId: string;
}): Promise<AttendanceClockActionResult> {
  const parsed = resolveProjectLeadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_recovery_credit_project_lead", {
    p_request_id: d.requestId,
    p_project_lead_employee_id: d.projectLeadEmployeeId,
  });

  revalidatePath("/approvals");
  revalidatePath("/attendance-clock");
  return { error: error?.message ?? null };
}
