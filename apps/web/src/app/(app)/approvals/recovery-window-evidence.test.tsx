/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/recoveryWindows", () => ({ verifyRecoveryWindow: vi.fn(), acknowledgeRecoveryReduction: vi.fn() }));

import { RecoveryWindowEvidence, type WindowEvidenceData } from "./recovery-window-evidence";
import { RecoveryCreditDecisionForm } from "./recovery-credit-decision-form";

vi.mock("@/lib/actions/recoveryCredit", () => ({ adjustRecoveryCreditRequest: vi.fn(), decideRecoveryCreditRequest: vi.fn() }));

afterEach(cleanup);

const data: WindowEvidenceData = {
  requestId: "r1",
  eventType: "window",
  proposedDays: 1,
  applicantRoute: "employee_lead_then_hr",
  routingIssue: null,
  needsAcknowledgement: false,
  blocker: null,
  canVerify: true,
  timeZone: "Asia/Dubai",
  countryCode: "AE",
  policyVersionLabel: "version 3",
  rulesSummary: "Rule (Weekly rest day): under 2 h = 0; 2–6 h = 0.5; over 6 h = 1 day.",
  window: {
    id: "w1",
    index: 1,
    start: "2027-01-09T05:00:00.000Z",
    end: "2027-01-10T05:00:00.000Z",
    startingLocalDate: "2027-01-09",
    classification: "rest_day",
    holidayName: null,
    recordedSeconds: 7 * 3600 + 1,
    status: "closed",
    closedReason: "rest",
    entitlementDays: 1,
    flags: ["forgotten_clock_out"],
    hrVerificationRequired: true,
    hrVerifiedAt: null,
    hrVerificationNote: null,
    revisionNo: 2,
  },
  periodStartedAt: "2027-01-09T05:00:00.000Z",
  allocations: [
    { id: "a1", mode: "site_work", projectName: "Tower", leadName: "Leo Lead", start: "2027-01-09T05:00:00.000Z", end: "2027-01-09T12:00:01.000Z", seconds: 7 * 3600 + 1, byHr: false },
  ],
  revisions: [
    { revisionNo: 1, recordedSeconds: 5 * 3600, entitlementDays: 0.5, reason: "Window closed", origin: "engine", createdAt: "2027-01-09T21:00:00.000Z" },
    { revisionNo: 2, recordedSeconds: 7 * 3600 + 1, entitlementDays: 1, reason: "Forgot to clock out", origin: "hr_correction", createdAt: "2027-01-10T01:00:00.000Z" },
  ],
  corrections: [
    { id: "c1", reason: "Forgot to clock out", createdAt: "2027-01-10T01:00:00.000Z", originalIn: "2027-01-09T05:00:00.000Z", originalOut: "2027-01-09T10:00:00.000Z", correctedIn: "2027-01-09T05:00:00.000Z", correctedOut: "2027-01-09T12:00:01.000Z", actor: "Hana HrOne" },
  ],
  steps: [
    { stepOrder: 1, label: "Project lead", decision: "approved" },
    { stepOrder: 2, label: "HR Admin", decision: "pending" },
  ],
};

describe("RecoveryWindowEvidence", () => {
  it("shows the exact contributing hours, the window, the region/date/rule, the policy version and the route", () => {
    render(<RecoveryWindowEvidence data={data} />);
    expect(screen.getAllByText(/7h 00m 01s/).length).toBeGreaterThan(0); // exact to the second
    expect(screen.getByText(/Asia\/Dubai, AE/)).toBeTruthy();
    expect(screen.getByText("2027-01-09")).toBeTruthy();
    expect(screen.getByText("Weekly rest day")).toBeTruthy();
    expect(screen.getByText(/over 6 h = 1 day/)).toBeTruthy();
    expect(screen.getByText(/Policy version 3/)).toBeTruthy();
    expect(screen.getByText(/Tower · lead Leo Lead/)).toBeTruthy();
    expect(screen.getByText("Project lead, then HR Admin")).toBeTruthy();
    expect(screen.getByText(/Project lead: approved → HR Admin: pending/)).toBeTruthy();
  });

  it("shows original versus corrected evidence with who, when and why", () => {
    render(<RecoveryWindowEvidence data={data} />);
    expect(screen.getByText("Corrected after the first calculation")).toBeTruthy();
    expect(screen.getByText(/Original: 5h 00m 00s → 0.5 day. Now: 7h 00m 01s → 1 day./)).toBeTruthy();
    expect(screen.getByText(/Hana HrOne/)).toBeTruthy();
    expect(screen.getByText(/Reason: Forgot to clock out/)).toBeTruthy();
  });

  it("states pending review conditions in plain English and offers verification only to HR", () => {
    const { rerender } = render(<RecoveryWindowEvidence data={data} />);
    expect(screen.getByText("Clock-out closed by HR")).toBeTruthy();
    expect(screen.getByText(/HR verification is still required/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark window as verified" })).toBeTruthy();
    rerender(<RecoveryWindowEvidence data={{ ...data, canVerify: false }} />);
    expect(screen.queryByRole("button", { name: "Mark window as verified" })).toBeNull();
  });

  it("explains why final approval is blocked, and surfaces unresolved routing", () => {
    render(<RecoveryWindowEvidence data={{ ...data, blocker: "This recovery window has not closed yet.", routingIssue: "No HR Admin is currently available." }} />);
    expect(screen.getByText(/Cannot be approved yet: This recovery window has not closed yet./)).toBeTruthy();
    expect(screen.getByText(/Unresolved routing: No HR Admin is currently available./)).toBeTruthy();
  });

  it("an adjustment request says only the difference is requested", () => {
    render(<RecoveryWindowEvidence data={{ ...data, eventType: "window_top_up", proposedDays: 0.5 }} />);
    expect(screen.getByText(/only the difference is requested/)).toBeTruthy();
  });
});

describe("RecoveryCreditDecisionForm for a window request", () => {
  const props = {
    requestId: "r1",
    originalWorkDate: "2027-01-09",
    originalHours: null,
    currentWorkDate: "2027-01-09",
    currentDays: 1,
    wasCorrected: true,
    canCorrect: true,
    checkedWithRequired: false,
  };

  it("never offers to type hours over a calculated request, and says how to correct it instead", () => {
    render(<RecoveryCreditDecisionForm {...props} windowMode />);
    expect(screen.queryByLabelText("Hours")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save correction" })).toBeNull();
    expect(screen.getByText(/correct the\s+attendance evidence/i)).toBeTruthy();
  });

  it("disables Approve while the database would refuse it", () => {
    render(<RecoveryCreditDecisionForm {...props} windowMode blockedReason="HR must verify this window." />);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the previous hours-correction controls for the previous (same-day) requests", () => {
    render(<RecoveryCreditDecisionForm {...props} originalHours={5} />);
    expect(screen.getByLabelText("Hours")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save correction" })).toBeTruthy();
  });
});
