/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { formatBusinessDateLong, formatBusinessTime } from "@enginious-hr/domain";
import { DashboardHeader } from "./dashboard-header";

// Every test pins the fake clock to the SAME instant used to compute the
// props it renders with — so it doesn't matter whether the component's
// post-mount effect has already resynced to "now" by the time we assert:
// either way, "now" and the props describe the same instant.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T20:30:00.000Z")); // 00:30 Dubai / 23:30 Riyadh / 22:30 Warsaw
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DashboardHeader", () => {
  it("renders the server-computed date/time on first paint without a hydration mismatch", () => {
    // The very first client render must show EXACTLY what the server sent
    // down as props, matching the current instant — proving the server and
    // client agree, so React never has to reconcile a mismatch.
    render(
      <DashboardHeader
        timeZone="Asia/Dubai"
        locationLabel="Dubai, UAE"
        initialDateLabel={formatBusinessDateLong("Asia/Dubai", new Date())}
        initialTimeLabel={formatBusinessTime("Asia/Dubai", new Date())}
        weather={{ temperatureC: 31, condition: "Clear" }}
      />,
    );

    expect(screen.getByText("Friday, 25 September 2026")).toBeTruthy();
    expect(screen.getByText("12:30 AM")).toBeTruthy();
    expect(screen.getByText("Dubai, UAE")).toBeTruthy();
    expect(screen.getByText(/31°C · Clear/)).toBeTruthy();
  });

  it("ticks the clock forward once a minute after mount, using the real business-time formatter", async () => {
    render(
      <DashboardHeader
        timeZone="Asia/Dubai"
        locationLabel="Dubai, UAE"
        initialDateLabel={formatBusinessDateLong("Asia/Dubai", new Date())}
        initialTimeLabel={formatBusinessTime("Asia/Dubai", new Date())}
        weather={null}
      />,
    );

    vi.setSystemTime(new Date("2026-09-24T21:45:00.000Z")); // over an hour later, Dubai 01:45
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText(formatBusinessTime("Asia/Dubai", new Date()))).toBeTruthy();
    expect(screen.queryByText("12:30 AM")).toBeNull(); // the stale pre-tick value is gone
  });

  it("shows Riyadh's own local time for an employee-only dashboard, independent of Dubai", () => {
    render(
      <DashboardHeader
        timeZone="Asia/Riyadh"
        locationLabel="Riyadh, Saudi Arabia"
        initialDateLabel={formatBusinessDateLong("Asia/Riyadh", new Date())}
        initialTimeLabel={formatBusinessTime("Asia/Riyadh", new Date())}
        weather={null}
      />,
    );

    expect(screen.getByText("Riyadh, Saudi Arabia")).toBeTruthy();
    expect(screen.getByText("11:30 PM")).toBeTruthy();
    // Riyadh (UTC+3) is one hour behind Dubai (UTC+4) for the same instant —
    // rendering the Dubai label here would be a silent cross-timezone bug.
    expect(screen.queryByText("12:30 AM")).toBeNull();
  });

  it("shows Warsaw's own local time and date for an employee-only dashboard", () => {
    render(
      <DashboardHeader
        timeZone="Europe/Warsaw"
        locationLabel="Warsaw, Poland"
        initialDateLabel={formatBusinessDateLong("Europe/Warsaw", new Date())}
        initialTimeLabel={formatBusinessTime("Europe/Warsaw", new Date())}
        weather={null}
      />,
    );

    expect(screen.getByText("Warsaw, Poland")).toBeTruthy();
    // Warsaw (UTC+2 in September, CEST) is on the calendar day BEFORE Dubai
    // for this instant — a shared cross-company "today" would get this
    // wrong for whichever side of midnight the other timezones aren't on.
    expect(screen.getByText("Thursday, 24 September 2026")).toBeTruthy();
    expect(screen.getByText("10:30 PM")).toBeTruthy();
  });

  it("omits the weather segment entirely (never a broken placeholder) when weather is unavailable", () => {
    render(
      <DashboardHeader
        timeZone="Asia/Dubai"
        locationLabel="Dubai, UAE"
        initialDateLabel={formatBusinessDateLong("Asia/Dubai", new Date())}
        initialTimeLabel={formatBusinessTime("Asia/Dubai", new Date())}
        weather={null}
      />,
    );

    expect(screen.queryByText(/°C/)).toBeNull();
    // Date, time and location must still render fine on their own.
    expect(screen.getByText("Friday, 25 September 2026")).toBeTruthy();
    expect(screen.getByText("12:30 AM")).toBeTruthy();
  });
});
