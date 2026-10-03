/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { RecoveryLiveSummary } from "@/types/database.types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { AttendanceClockCard } from "./attendance-clock-card";

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

async function renderCard(summary: RecoveryLiveSummary) {
  rpc.mockResolvedValue({ data: summary, error: null });
  render(await AttendanceClockCard({ employeeId: "emp-1" }));
}

const base: RecoveryLiveSummary = { linked: true, timezone: "Asia/Dubai", country_code: "AE", clock_status: "not_started", windowed: false, period: null, window: null };

describe("AttendanceClockCard (dashboard status)", () => {
  it("shows a neutral Not started state with a Clock In action — no break buttons anywhere", async () => {
    await renderCard(base);
    expect(screen.getByRole("heading", { name: "Attendance clock" })).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clock In" }).getAttribute("href")).toBe("/attendance-clock");
    expect(screen.queryByText(/break/i)).toBeNull();
  });

  it("shows clocked-in status, work mode, project and the clock-in time in the employee's own time zone", async () => {
    await renderCard({ ...base, clock_status: "clocked_in", open_since: "2027-01-12T05:20:00.000Z", work_mode: "site_work", project_name: "Tower" });
    expect(screen.getByText("Clocked in")).toBeTruthy();
    expect(screen.getByText(/Site work \/ Installation — Tower · since 9:20 AM/)).toBeTruthy(); // 05:20Z = 09:20 Dubai
    expect(screen.getByRole("link", { name: "Clock Out" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Switch mode" }).getAttribute("href")).toBe("/attendance-clock#switch");
  });

  it("shows a clocked-out person as Clocked out, not as not started", async () => {
    await renderCard({ ...base, clock_status: "clocked_out" });
    expect(screen.getByText("Clocked out")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clock In" })).toBeTruthy();
  });

  it("shows recorded hours in the window, the original period start, and provisional recovery as a status — never a balance", async () => {
    await renderCard({
      ...base,
      clock_status: "clocked_in",
      open_since: "2027-01-09T05:00:00.000Z",
      work_mode: "office",
      windowed: true,
      period: { started_at: "2027-01-09T05:00:00.000Z", elapsed_seconds: 7 * 3600, recorded_seconds: 7 * 3600, rest_completes_at: null, rollover_count: 0, long_work_warning: false, alert_work_hours: 20, rest_gap_hours: 8 },
      window: { index: 1, started_at: "2027-01-09T05:00:00.000Z", ends_at: "2027-01-10T05:00:00.000Z", recorded_seconds: 7 * 3600, closed: false, classification: "rest_day", entitlement_days: 1, review_flags: [], request_status: null },
    });
    expect(screen.getByText("7h 00m")).toBeTruthy();
    expect(screen.getByText("so far")).toBeTruthy();
    expect(screen.getByText(/Sat.*09 Jan.*09:00/)).toBeTruthy(); // original working-period start, Dubai local
    expect(screen.getByText("Awaiting closure")).toBeTruthy();
    expect(screen.getByText(/Provisional: not part of your available balance until approved/)).toBeTruthy();
    expect(screen.queryByText(/available balance:/i)).toBeNull();
  });

  it.each([
    ["awaiting_approval", "pending_approval" as const, "Awaiting approval"],
    ["approved", "approved" as const, "Approved"],
  ])("labels a closed window's request as %s", async (_name, requestStatus, label) => {
    await renderCard({
      ...base,
      clock_status: "clocked_out",
      windowed: true,
      period: { started_at: "2027-01-09T05:00:00.000Z", elapsed_seconds: 1, recorded_seconds: 1, rest_completes_at: null, rollover_count: 0, long_work_warning: false, alert_work_hours: 20, rest_gap_hours: 8 },
      window: { index: 1, started_at: "2027-01-09T05:00:00.000Z", ends_at: "2027-01-10T05:00:00.000Z", recorded_seconds: 8 * 3600, closed: true, classification: "rest_day", entitlement_days: 1, review_flags: [], request_status: requestStatus },
    });
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows the amber long-work notice and the automatic-rollover note, without any action that stops recording", async () => {
    await renderCard({
      ...base,
      clock_status: "clocked_in",
      open_since: "2027-01-09T05:00:00.000Z",
      windowed: true,
      period: { started_at: "2027-01-09T05:00:00.000Z", elapsed_seconds: 26 * 3600, recorded_seconds: 26 * 3600, rest_completes_at: null, rollover_count: 1, long_work_warning: true, alert_work_hours: 20, rest_gap_hours: 8 },
      window: { index: 2, started_at: "2027-01-10T05:00:00.000Z", ends_at: "2027-01-11T05:00:00.000Z", recorded_seconds: 2 * 3600, closed: false, classification: "rest_day", entitlement_days: 1, review_flags: [], request_status: null },
    });
    expect(screen.getByText(/20\+ hours of work without a 8-hour rest/)).toBeTruthy();
    expect(screen.getByText(/rolled over automatically — you do not need to clock out/)).toBeTruthy();
  });
});
