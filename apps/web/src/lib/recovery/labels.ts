import type { AttendanceWorkMode, RecoveryAlertType, RecoveryDayClassification, RecoveryWindowReviewFlag } from "@/types/database.types";

export const WORK_MODE_LABELS: Record<AttendanceWorkMode, string> = {
  office: "Office",
  wfh: "Work from home",
  site_work: "Site work / Installation",
  client_meeting: "Client meeting",
  business_travel: "Business travel",
};

export function workModeLabel(mode: string | null | undefined): string {
  if (!mode) return "—";
  return WORK_MODE_LABELS[mode as AttendanceWorkMode] ?? mode;
}

export const CLASSIFICATION_LABELS: Record<RecoveryDayClassification, string> = {
  normal_day: "Normal working day",
  rest_day: "Weekly rest day",
  public_holiday: "Public holiday",
};

/** Plain-English review conditions HR sees — never raw flag codes. */
export const REVIEW_FLAG_LABELS: Record<RecoveryWindowReviewFlag, { label: string; hint: string; needsVerification: boolean }> = {
  business_travel: {
    label: "Business travel",
    hint: "Travel is recorded, but whether the time was working time needs HR's explicit review.",
    needsVerification: true,
  },
  multiple_leads: {
    label: "More than one project or lead",
    hint: "Work in this window named different projects or project leads. All of it is kept; HR reviews who should confirm it.",
    needsVerification: true,
  },
  forgotten_clock_out: {
    label: "Clock-out closed by HR",
    hint: "The employee did not clock out; HR set the end time. HR verifies the closing time before credit.",
    needsVerification: true,
  },
  hr_recorded: {
    label: "Recorded by HR",
    hint: "At least part of this window was entered by HR (\"Add missing attendance\"), not clocked by the employee.",
    needsVerification: false,
  },
  unusual_long_work: {
    label: "Unusually long recorded work",
    hint: "Recorded work in this window reached the long-work alert threshold. HR verifies it is genuine before credit.",
    needsVerification: true,
  },
  leave_conflict: {
    label: "Overlaps approved leave",
    hint: "The employee has approved leave or a leave record on the day this window starts. Nothing was changed; HR reconciles it.",
    needsVerification: true,
  },
  manual_conflict: {
    label: "Conflicts with a manual attendance entry",
    hint: "A manual daily entry exists for the day this window starts. Neither record was overwritten; HR reconciles them.",
    needsVerification: true,
  },
};

export function reviewFlagLabel(flag: string): string {
  return REVIEW_FLAG_LABELS[flag as RecoveryWindowReviewFlag]?.label ?? flag;
}

export const ALERT_TYPE_LABELS: Record<RecoveryAlertType, string> = {
  long_work: "Long work without rest",
  window_rollover: "24-hour window rolled over",
};

export const RECOVERY_SUMMARY_LABELS: Record<string, string> = {
  none: "—",
  awaiting_closure: "Awaiting closure",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  needs_review: "Needs review",
};

export const ROUTE_LABELS: Record<string, string> = {
  employee_lead_then_hr: "Project lead, then HR Admin",
  self_led_hr_direct: "HR Admin (the employee leads their own work)",
  manager_hr_direct: "HR Admin (permanent manager)",
  hr_admin_ceo_cto_queue: "CEO or CTO (HR Admin applicant)",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  standard: "Weekend / holiday work (same-day rule)",
  overnight: "Overnight extension (same-day rule)",
  window: "Recovery window",
  window_top_up: "Top-up after a correction",
  window_reduction: "Reduction after a correction",
};

/** "7h 05m" — minutes-level display for tables (exact seconds are shown where a boundary matters). */
export function formatHoursMinutes(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
