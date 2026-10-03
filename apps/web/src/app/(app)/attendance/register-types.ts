import type { AttendanceRegisterRow } from "@/types/database.types";

/** One registered employee for the selected date, ready for the client table (plain serializable data). */
export interface RegisterRowView {
  employeeId: string;
  name: string;
  timeZone: string;
  clockStatus: AttendanceRegisterRow["clock_status"];
  attendanceStatus: AttendanceRegisterRow["attendance_status"];
  attendanceSource: string | null;
  workModes: string[];
  firstClockIn: string | null;
  lastClockOut: string | null;
  recordedSeconds: number;
  isProvisional: boolean;
  openSince: string | null;
  sessionCount: number;
  recoverySummary: AttendanceRegisterRow["recovery_summary"];
  reviewFlags: string[];
  openAlertCount: number;
  presenceConflict: string | null;
  onLeave: boolean;
  hrRecorded: boolean;
  manualHours: number | null;
}

export interface SessionDetail {
  id: string;
  clockIn: string;
  clockOut: string | null;
  status: "open" | "closed";
  hrClosedReason: string | null;
  recordedByHr: boolean;
  recordedByHrReason: string | null;
  recoveryModel: "legacy" | "windowed";
  segments: { id: string; mode: string; projectName: string | null; leadName: string | null; start: string; end: string | null; location: string | null }[];
  corrections: { id: string; kind: "correct_times" | "add_missing"; reason: string; actorName: string; createdAt: string; originalIn: string | null; originalOut: string | null; correctedIn: string; correctedOut: string }[];
}

export interface WindowDetail {
  id: string;
  index: number;
  start: string;
  end: string;
  recordedSeconds: number;
  status: "open" | "closed";
  classification: string;
  entitlementDays: number;
  flags: string[];
  hrVerificationRequired: boolean;
  hrVerifiedAt: string | null;
  requestStatus: string | null;
}

export interface RegisterDetail {
  sessions: SessionDetail[];
  windows: WindowDetail[];
}

export interface Colleague {
  id: string;
  name: string;
}
