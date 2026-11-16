import { describe, expect, it } from "vitest";
import { attendanceDayLabel } from "./attendance-status";

describe("attendance day wording", () => {
  it("a missing record stays 'No record' on a working day: it is never read as absence", () => {
    expect(attendanceDayLabel({ status: "not_recorded", isRestDay: false })).toBe("No record");
    expect(attendanceDayLabel({ status: undefined, isRestDay: false })).toBe("No record");
  });
  it("nothing recorded on a rest day or holiday is a 'Rest day', not 'No record' and not absent", () => {
    expect(attendanceDayLabel({ status: "not_recorded", isRestDay: true })).toBe("Rest day");
  });
  it("'Absent' only when the day was recorded as absent, even on a rest day", () => {
    expect(attendanceDayLabel({ status: "absent", isRestDay: false })).toBe("Absent");
    expect(attendanceDayLabel({ status: "absent", isRestDay: true })).toBe("Absent");
  });
  it("approved leave or a leave record says 'On leave'; clock evidence or a present record says 'Present' (also on a rest day)", () => {
    expect(attendanceDayLabel({ status: "not_recorded", onLeave: true, isRestDay: false })).toBe("On leave");
    expect(attendanceDayLabel({ status: "leave", isRestDay: false })).toBe("On leave");
    expect(attendanceDayLabel({ status: "not_recorded", hasClockEvidence: true, isRestDay: true })).toBe("Present");
    expect(attendanceDayLabel({ status: "present", isRestDay: false })).toBe("Present");
    expect(attendanceDayLabel({ status: "partial_day", isRestDay: false })).toBe("Partial day");
  });
});
