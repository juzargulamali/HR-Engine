import { describe, expect, it } from "vitest";
import { attendanceSentence, CALENDAR_NOTE, noRecordHint } from "./attendance-summary";

const base = { totalEmployees: 11, notRecordedCount: 10, notRecordedScheduledCount: 0, notRecordedRestCount: 0, notRecordedUnknownCount: 0 };

describe("attendanceSentence", () => {
  it("on a scheduled workday names the people who should have recorded something", () => {
    const s = attendanceSentence({ ...base, notRecordedCount: 10, notRecordedScheduledCount: 10 });
    expect(s).toBe("Attendance is recorded for 1 of 11 employees today. 10 scheduled to work have no attendance recorded yet.");
  });
  it("on a weekly rest day or public holiday a missing record is not described as a gap", () => {
    const s = attendanceSentence({ ...base, notRecordedRestCount: 10 });
    expect(s).toContain("10 are on a weekly rest day or public holiday, so no attendance is expected.");
    expect(s).not.toMatch(/scheduled to work|missing|no attendance recorded yet/i);
  });
  it("separates the three groups when a company spans calendars", () => {
    const s = attendanceSentence({ totalEmployees: 8, notRecordedCount: 6, notRecordedScheduledCount: 2, notRecordedRestCount: 3, notRecordedUnknownCount: 1 });
    expect(s).toContain("2 scheduled to work have no attendance recorded yet.");
    expect(s).toContain("3 are on a weekly rest day or public holiday");
    expect(s).toContain("1 could not be classified for today");
  });
  it("handles singular wording and never says anyone is 'in' (present, on leave and clocked in are different facts)", () => {
    const s = attendanceSentence({ totalEmployees: 1, notRecordedCount: 1, notRecordedScheduledCount: 1, notRecordedRestCount: 0, notRecordedUnknownCount: 0 });
    expect(s).toBe("Attendance is recorded for 0 of 1 employee today. 1 scheduled to work has no attendance recorded yet.");
    expect(s).not.toMatch(/\bin today\b|everyone/i);
  });
});

describe("noRecordHint", () => {
  it("on a normal workday with a gap, says who should have recorded", () => {
    expect(noRecordHint({ notRecordedScheduledCount: 3, notRecordedRestCount: 0, notRecordedUnknownCount: 0 })).toBe("Scheduled to work, nothing recorded yet");
  });
  it("when everyone scheduled has a record, says so instead of implying a problem", () => {
    expect(noRecordHint({ notRecordedScheduledCount: 0, notRecordedRestCount: 0, notRecordedUnknownCount: 0 })).toBe("Everyone scheduled to work has a record");
  });
  it("on a rest day or holiday the zero is explained, not read as a failure", () => {
    expect(noRecordHint({ notRecordedScheduledCount: 0, notRecordedRestCount: 8, notRecordedUnknownCount: 0 })).toBe(
      "No one scheduled to work is without a record. 8 on a weekly rest day or public holiday (no attendance expected)",
    );
  });
  it("mixed calendars and unclassified people are accounted for in words", () => {
    const h = noRecordHint({ notRecordedScheduledCount: 2, notRecordedRestCount: 3, notRecordedUnknownCount: 1 });
    expect(h).toContain("Scheduled to work, nothing recorded yet");
    expect(h).toContain("3 more on a weekly rest day or public holiday (no attendance expected)");
    expect(h).toContain("1 more not classified (no workweek data for their country)");
  });
});

describe("calendar note", () => {
  it("says expectations follow the country calendar and not individual rosters", () => {
    expect(CALENDAR_NOTE).toMatch(/country calendar/);
    expect(CALENDAR_NOTE).toMatch(/not individual rosters/);
  });
});
