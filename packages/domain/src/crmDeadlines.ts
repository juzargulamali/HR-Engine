/**
 * Dates, deadlines and "is this configured?" rules for Sales & CRM. Pure functions of (data, instant) so they can be
 * tested deterministically. All Sales dates are Dubai time (Asia/Dubai), Enginious's reference timezone.
 */
import { getBusinessDateString, localDateTimeToUtcIso } from "./businessTime";

export const CRM_TIME_ZONE = "Asia/Dubai";

export type FollowUpTiming = "overdue" | "due_today" | "upcoming";

/** Overdue = the due moment has passed. Due today = still to come, on today's Dubai date. */
export function followUpTiming(dueAtIso: string, now: Date = new Date()): FollowUpTiming {
  const due = new Date(dueAtIso);
  if (due.getTime() < now.getTime()) return "overdue";
  return getBusinessDateString(CRM_TIME_ZONE, due) === getBusinessDateString(CRM_TIME_ZONE, now) ? "due_today" : "upcoming";
}

/** Whole days past the due moment (0 if not overdue). */
export function daysOverdue(dueAtIso: string, now: Date = new Date()): number {
  const diff = now.getTime() - new Date(dueAtIso).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

/** "2026-10-20" + "11:00" in Dubai time -> UTC ISO string for storing in timestamptz. Null if invalid. */
export function dubaiDateTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return localDateTimeToUtcIso(CRM_TIME_ZONE, `${date}T${time}`);
}

export const crmToday = (now: Date = new Date()) => getBusinessDateString(CRM_TIME_ZONE, now);

// ----------------------------------------------------------------------------------------------------------------
// Equipment availability: a dated check, not a reservation and not a commercial confirmation.
// ----------------------------------------------------------------------------------------------------------------

export interface AvailabilitySnapshot {
  install_start: string | null;
  event_start: string | null;
  event_end: string | null;
  technologies: { name: string; qty: number }[];
}

export interface AvailabilitySubject {
  availabilityState: "unverified" | "awaiting" | "confirmed" | "unavailable";
  availabilityCovers: AvailabilitySnapshot | null;
  installStart: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  technologies: { name: string; qty: number }[];
}

export type AvailabilityDisplay = "unverified" | "awaiting" | "confirmed" | "unavailable" | "needs_recheck";

/** Mirrors crm_availability_needs_recheck: any drift from what the check covered means it must be repeated. */
export function availabilityDisplay(o: AvailabilitySubject): AvailabilityDisplay {
  if (o.availabilityState === "confirmed" || o.availabilityState === "unavailable") {
    const now: AvailabilitySnapshot = { install_start: o.installStart, event_start: o.eventStart, event_end: o.eventEnd, technologies: o.technologies };
    const then = o.availabilityCovers;
    const same =
      !!then &&
      then.install_start === now.install_start &&
      then.event_start === now.event_start &&
      then.event_end === now.event_end &&
      JSON.stringify(then.technologies.map((t) => [t.name, t.qty])) === JSON.stringify(now.technologies.map((t) => [t.name, t.qty]));
    return same ? o.availabilityState : "needs_recheck";
  }
  return o.availabilityState;
}

export const AVAILABILITY_LABELS: Record<AvailabilityDisplay, string> = {
  unverified: "Not checked",
  awaiting: "Check requested",
  confirmed: "Available (checked)",
  unavailable: "Not available",
  needs_recheck: "Needs recheck (details changed)",
};

// ----------------------------------------------------------------------------------------------------------------
// Commercial approval: never presented as granted unless a founder recorded it under a configured policy.
// ----------------------------------------------------------------------------------------------------------------

export type ApprovalPolicy = "not_configured" | "not_required" | "required";
export type ApprovalState = "pending" | "approved" | "changes_requested";

export function commercialApprovalLabel(policy: ApprovalPolicy, latest: { state: ApprovalState } | null): { label: string; tone: "neutral" | "warning" | "positive" } {
  if (policy === "not_configured") return { label: "Approval rules not configured", tone: "neutral" };
  if (policy === "not_required") return { label: "Approval not required (founders' decision)", tone: "neutral" };
  if (!latest) return { label: "Approval not requested", tone: "warning" };
  if (latest.state === "approved") return { label: "Approved", tone: "positive" };
  if (latest.state === "changes_requested") return { label: "Changes requested", tone: "warning" };
  return { label: "Waiting for a founder's decision", tone: "warning" };
}

/** "Commercially won" means a recorded Won stage WITH evidence. A proposal being sent or accepted is not that. */
export const isCommerciallyWon = (o: { stage: string; evidenceReference?: string | null }) => o.stage === "won" && !!o.evidenceReference;

// ----------------------------------------------------------------------------------------------------------------
// Response-time KPI: only computed once a target AND a working calendar exist. Otherwise: "not configured".
// ----------------------------------------------------------------------------------------------------------------

export interface WorkingCalendar {
  /** Days of week that count as working days, 0 = Sunday ... 6 = Saturday. */
  workdays: number[];
  /** Working hours "HH:MM" in Dubai time. */
  start: string;
  end: string;
  /** Non-working dates, YYYY-MM-DD. */
  holidays: string[];
}

export function parseWorkingCalendar(raw: unknown): WorkingCalendar | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const workdays = Array.isArray(r.workdays) ? (r.workdays as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) : [];
  const ok = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (workdays.length === 0 || !ok(r.start) || !ok(r.end) || r.end <= r.start) return null;
  const holidays = Array.isArray(r.holidays) ? (r.holidays as unknown[]).filter((h): h is string => typeof h === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h)) : [];
  return { workdays: [...new Set(workdays)].sort(), start: r.start, end: r.end, holidays };
}

/** Working hours between two instants under the calendar (Dubai time). */
export function workingHoursBetween(cal: WorkingCalendar, from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  // Walk Dubai calendar days from the day of `from` to the day of `to`.
  const firstDay = getBusinessDateString(CRM_TIME_ZONE, from);
  const lastDay = getBusinessDateString(CRM_TIME_ZONE, to);
  for (let d = new Date(`${firstDay}T00:00:00Z`); d <= new Date(`${lastDay}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const dateStr = d.toISOString().slice(0, 10);
    if (!cal.workdays.includes(d.getUTCDay()) || cal.holidays.includes(dateStr)) continue;
    const dayStart = new Date(localDateTimeToUtcIso(CRM_TIME_ZONE, `${dateStr}T${cal.start}`) ?? NaN);
    const dayEnd = new Date(localDateTimeToUtcIso(CRM_TIME_ZONE, `${dateStr}T${cal.end}`) ?? NaN);
    if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) continue;
    const a = Math.max(from.getTime(), dayStart.getTime());
    const b = Math.min(to.getTime(), dayEnd.getTime());
    if (b > a) total += (b - a) / 3_600_000;
  }
  return total;
}

export type ResponseKpi =
  | { status: "not_configured"; reason: string }
  | { status: "ok"; targetHours: number; measured: number; withinTarget: number; waiting: number; medianHours: number | null };

/**
 * Share of enquiries first answered within the target (in working hours). Returns "not configured" — never zero or a
 * made-up percentage — until the company has BOTH a response target and a working calendar. Enquiries with no first
 * response yet count as "waiting" (excluded from the share unless already past the target).
 */
export function responseTimeKpi(
  config: { responseTargetHours: number | null; workingCalendar: unknown },
  opportunities: readonly { createdAt: string; firstResponseAt: string | null }[],
  now: Date = new Date(),
): ResponseKpi {
  const cal = parseWorkingCalendar(config.workingCalendar);
  if (!config.responseTargetHours || config.responseTargetHours <= 0) {
    return { status: "not_configured", reason: "No response-time target has been set." };
  }
  if (!cal) return { status: "not_configured", reason: "No working calendar has been set." };
  const target = config.responseTargetHours;
  const hours: number[] = [];
  let within = 0;
  let waiting = 0;
  for (const o of opportunities) {
    const created = new Date(o.createdAt);
    if (o.firstResponseAt) {
      const h = workingHoursBetween(cal, created, new Date(o.firstResponseAt));
      hours.push(h);
      if (h <= target) within++;
    } else {
      const h = workingHoursBetween(cal, created, now);
      if (h > target) hours.push(h); // already late
      else waiting++;
    }
  }
  hours.sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  const median = hours.length === 0 ? null : hours.length % 2 ? (hours[mid] as number) : ((hours[mid - 1] as number) + (hours[mid] as number)) / 2;
  return { status: "ok", targetHours: target, measured: hours.length, withinTarget: within, waiting, medianHours: median };
}

/** Never add amounts of different currencies. Groups totals per currency. */
export function totalsByCurrency(items: readonly { currency: string; value: number | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) if (i.value != null) out[i.currency] = (out[i.currency] ?? 0) + i.value;
  return out;
}
