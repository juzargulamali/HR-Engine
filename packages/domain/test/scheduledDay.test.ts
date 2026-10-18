import { describe, expect, it } from "vitest";
import { classifyScheduledDay, describeScheduledDay } from "../src/scheduledDay";

// Real dates: Sun 18 Oct 2026 is a Sunday; Thu 15 Oct 2026 a Thursday; Fri 16 Oct a Friday; Sat 17 Oct a Saturday.
const UAE = { weekStartDay: 0, workingWeekdays: [1, 2, 3, 4, 5] }; // as configured for AE: Mon-Fri worked
const KSA = { weekStartDay: 0, workingWeekdays: [0, 1, 2, 3, 4] }; // SA: Sun-Thu worked
const PL = { weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5] };

describe("classifyScheduledDay", () => {
  it("uses each country's own workweek: the same date is a rest day in one country and a workday in another", () => {
    expect(classifyScheduledDay({ date: "2026-10-18", workweek: UAE, holidayName: null }).kind).toBe("weekly_rest"); // Sunday
    expect(classifyScheduledDay({ date: "2026-10-18", workweek: KSA, holidayName: null }).kind).toBe("workday"); // Sunday is a Saudi workday
    expect(classifyScheduledDay({ date: "2026-10-16", workweek: KSA, holidayName: null }).kind).toBe("weekly_rest"); // Friday
    expect(classifyScheduledDay({ date: "2026-10-17", workweek: PL, holidayName: null }).kind).toBe("weekly_rest"); // Saturday
    expect(classifyScheduledDay({ date: "2026-10-15", workweek: PL, holidayName: null }).kind).toBe("workday");
  });
  it("a public holiday of the person's own country wins, and keeps its name", () => {
    expect(classifyScheduledDay({ date: "2026-10-15", workweek: UAE, holidayName: "National Day" })).toEqual({ kind: "public_holiday", holidayName: "National Day" });
    expect(classifyScheduledDay({ date: "2026-10-18", workweek: UAE, holidayName: "Commemoration Day" }).kind).toBe("public_holiday");
  });
  it("falls back to the contiguous five days from the week start when no explicit working weekdays are stored", () => {
    const contiguous = { weekStartDay: 1, workingWeekdays: null };
    expect(classifyScheduledDay({ date: "2026-10-17", workweek: contiguous, holidayName: null }).kind).toBe("weekly_rest"); // Saturday
    expect(classifyScheduledDay({ date: "2026-10-14", workweek: contiguous, holidayName: null }).kind).toBe("workday"); // Wednesday
  });
  it("does not guess when the country workweek is unavailable", () => {
    expect(classifyScheduledDay({ date: "2026-10-18", workweek: null, holidayName: null }).kind).toBe("unknown");
    // ...but a known holiday is still a holiday
    expect(classifyScheduledDay({ date: "2026-10-18", workweek: null, holidayName: "X" }).kind).toBe("public_holiday");
  });
});

describe("describeScheduledDay", () => {
  it("names each kind in plain words", () => {
    expect(describeScheduledDay("workday", null)).toBe("Scheduled workday");
    expect(describeScheduledDay("weekly_rest", null)).toBe("Weekly rest day");
    expect(describeScheduledDay("public_holiday", "National Day")).toBe("Public holiday: National Day");
    expect(describeScheduledDay("unknown", null)).toBe("Day type not known");
  });
});
