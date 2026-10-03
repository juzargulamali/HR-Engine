/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/lib/actions/recoveryWindows", () => ({
  correctAttendanceSession: vi.fn(),
  closeMissingClockOut: vi.fn(),
  addMissingAttendance: vi.fn(),
}));

import { RegisterTable } from "./register-table";
import type { RegisterDetail, RegisterRowView } from "./register-types";

afterEach(cleanup);

const base: RegisterRowView = {
  employeeId: "e1",
  name: "Alice Clocked",
  timeZone: "Asia/Dubai",
  clockStatus: "clocked_in",
  attendanceStatus: "present",
  attendanceSource: "self_clock",
  workModes: ["office"],
  firstClockIn: "2027-01-12T05:00:00.000Z",
  lastClockOut: null,
  recordedSeconds: 4 * 3600 + 5 * 60,
  isProvisional: true,
  openSince: "2027-01-12T05:00:00.000Z",
  sessionCount: 1,
  recoverySummary: "none",
  reviewFlags: [],
  openAlertCount: 0,
  presenceConflict: null,
  onLeave: false,
  hrRecorded: false,
  manualHours: null,
};
const rows: RegisterRowView[] = [
  base,
  { ...base, employeeId: "e2", name: "Bob Out", clockStatus: "clocked_out", lastClockOut: "2027-01-12T09:00:00.000Z", isProvisional: false, openSince: null, workModes: ["office", "wfh"], recordedSeconds: 8 * 3600 },
  { ...base, employeeId: "e3", name: "Cara Nothing", clockStatus: "not_started", attendanceStatus: "not_recorded", attendanceSource: null, workModes: [], firstClockIn: null, lastClockOut: null, recordedSeconds: 0, isProvisional: false, openSince: null, sessionCount: 0 },
  { ...base, employeeId: "e4", name: "Dan HrAdded", clockStatus: "clocked_out", lastClockOut: "2027-01-12T08:00:00.000Z", isProvisional: false, openSince: null, hrRecorded: true, recoverySummary: "needs_review", reviewFlags: ["hr_recorded", "unusual_long_work"], openAlertCount: 1 },
];
const details: Record<string, RegisterDetail> = {
  e1: {
    sessions: [
      {
        id: "s1",
        clockIn: "2027-01-12T05:00:00.000Z",
        clockOut: null,
        status: "open",
        hrClosedReason: null,
        recordedByHr: false,
        recordedByHrReason: null,
        recoveryModel: "windowed",
        segments: [{ id: "g1", mode: "site_work", projectName: "Tower", leadName: "Leo Lead", start: "2027-01-12T05:00:00.000Z", end: null, location: "start captured" }],
        corrections: [],
      },
    ],
    windows: [],
  },
};

function renderTable(canEdit = true) {
  return render(<RegisterTable rows={rows} details={details} colleagues={[{ id: "l1", name: "Leo Lead" }]} workDate="2027-01-12" canEdit={canEdit} />);
}

describe("RegisterTable", () => {
  it("has the columns the register is specified to have, in order", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Employee",
      "Clock status",
      "Attendance for 2027-01-12",
      "Work mode",
      "First clock-in",
      "Last clock-out",
      "Recorded hours",
      "Recovery / review",
      "Edit",
    ]);
  });

  it("shows clock status as text for each real state, and keeps a clocked-out person Present", () => {
    renderTable();
    const alice = screen.getByText("Alice Clocked").closest("tr")!;
    expect(within(alice).getByText("Clocked in")).toBeTruthy();
    expect(within(alice).getByText("so far — still clocked in")).toBeTruthy(); // provisional while open
    const bob = screen.getByText("Bob Out").closest("tr")!;
    expect(within(bob).getByText("Clocked out")).toBeTruthy();
    expect(within(bob).getByText("Present")).toBeTruthy(); // presence stays Present after clock-out
    expect(within(bob).getByText("Office, Work from home")).toBeTruthy(); // every mode shown
  });

  it("shows no evidence as Not started / Not recorded, never as absent", () => {
    renderTable();
    const cara = screen.getByText("Cara Nothing").closest("tr")!;
    expect(within(cara).getByText("Not started")).toBeTruthy();
    expect(within(cara).getByText("Not started / Not recorded")).toBeTruthy();
    expect(within(cara).queryByText(/absent/i)).toBeNull();
  });

  it("marks HR-recorded evidence and raises review conditions in plain English, without a Clocked-in state", () => {
    renderTable();
    const dan = screen.getByText("Dan HrAdded").closest("tr")!;
    expect(within(dan).getByText("Recorded by HR")).toBeTruthy();
    expect(within(dan).queryByText("Clocked in")).toBeNull();
    expect(within(dan).getByText("Needs review")).toBeTruthy();
    expect(within(dan).getByText("HR alert")).toBeTruthy();
    expect(within(dan).getByText(/Unusually long recorded work/)).toBeTruthy();
  });

  it("expands a row to show sessions, modes, project, lead and location evidence", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Alice Clocked/ }));
    expect(screen.getByText(/Site work \/ Installation · Tower · lead Leo Lead · location: start captured/)).toBeTruthy();
    expect(screen.getByText(/still clocked in/, { selector: "span" })).toBeTruthy();
  });

  it("offers the Edit control (with the required-reason forms behind it) to HR only", () => {
    renderTable(true);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(4);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(screen.getByText("Close a missing clock-out")).toBeTruthy();
    expect(screen.getByText("Add missing attendance (recorded by HR)")).toBeTruthy();
    expect(screen.getAllByLabelText(/Reason/).length).toBeGreaterThan(0);
    cleanup();
    renderTable(false);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("requires a reason before an HR edit can be saved", () => {
    renderTable(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const save = screen.getByRole("button", { name: "Close session" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getAllByLabelText(/^Reason/)[0]!, { target: { value: "Left at five" } });
    expect(save.disabled).toBe(false);
  });
});
