import { describe, expect, it } from "vitest";
import { nextWorkingDay } from "./next-working-day";

describe("the suggested date for the next follow-up", () => {
  it("is the next Monday to Friday day when the company has no working calendar", () => {
    expect(nextWorkingDay("2026-11-02", null)).toBe("2026-11-03"); // Monday -> Tuesday
    expect(nextWorkingDay("2026-11-06", null)).toBe("2026-11-09"); // Friday -> Monday
    expect(nextWorkingDay("2026-11-07", undefined)).toBe("2026-11-09"); // Saturday -> Monday
  });
  it("follows the company's own working days and skips its holidays", () => {
    const cal = { workdays: [0, 1, 2, 3, 4], start: "08:00", end: "17:00", holidays: ["2026-11-09"] };
    expect(nextWorkingDay("2026-11-05", cal)).toBe("2026-11-08"); // Thursday -> Sunday (a working day here)
    expect(nextWorkingDay("2026-11-08", cal)).toBe("2026-11-10"); // Monday the 9th is a holiday
  });
  it("ignores a calendar that is not valid", () => {
    expect(nextWorkingDay("2026-11-06", { workdays: [], start: "x" })).toBe("2026-11-09");
  });
});
