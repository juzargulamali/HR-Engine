import { describe, expect, it } from "vitest";
import { dubaiTimeOfDay, formatDueExact, resultingDue, whenShortcuts } from "./follow-up-reschedule";

describe("reschedule shortcuts", () => {
  it("count from today's date in Dubai: tomorrow, in 2 days, the same weekday next week", () => {
    // Monday 9 Nov 2026, 10:00 in Dubai.
    expect(whenShortcuts(new Date("2026-11-09T06:00:00Z"))).toEqual([
      { key: "tomorrow", label: "Tomorrow", date: "2026-11-10" },
      { key: "two_days", label: "In 2 days", date: "2026-11-11" },
      { key: "next_week", label: "Next week", date: "2026-11-16" },
    ]);
  });

  it("use the Dubai day, not the UTC day: 22:30 UTC on the 9th is already the 10th in Dubai", () => {
    expect(whenShortcuts(new Date("2026-11-09T22:30:00Z")).map((s) => s.date)).toEqual(["2026-11-11", "2026-11-12", "2026-11-17"]);
  });

  it("cross a month and a year end correctly", () => {
    expect(whenShortcuts(new Date("2026-12-30T08:00:00Z")).map((s) => s.date)).toEqual(["2026-12-31", "2027-01-01", "2027-01-06"]);
  });

  it("the resulting moment is the Dubai date and time as the server stores it (Dubai is UTC+4), and it reads back as the exact date and time", () => {
    const due = resultingDue("2026-11-16", "15:00")!;
    expect(new Date(due).toISOString()).toBe("2026-11-16T11:00:00.000Z");
    expect(formatDueExact(due)).toBe("Mon, 16 Nov 2026, 15:00");
  });

  it("a missing or malformed time is 09:00, exactly as the server saves it; no date gives no result", () => {
    expect(new Date(resultingDue("2026-11-16", "")!).toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(new Date(resultingDue("2026-11-16", "9am")!).toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(resultingDue("", "10:00")).toBeNull();
    expect(resultingDue("16/11/2026", "10:00")).toBeNull();
  });

  it("a rescheduled follow-up keeps its own time of day in Dubai; without one it is 10:00", () => {
    expect(dubaiTimeOfDay("2026-11-06T11:30:00Z")).toBe("15:30");
    expect(dubaiTimeOfDay("2026-11-06T20:00:00Z")).toBe("00:00");
    expect(dubaiTimeOfDay(undefined)).toBe("10:00");
    expect(dubaiTimeOfDay("not a date")).toBe("10:00");
  });
});
