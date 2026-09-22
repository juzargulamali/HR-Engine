import { describe, expect, it } from "vitest";
import { addMonthsClamped } from "../src/addMonthsClamped";

describe("addMonthsClamped", () => {
  it("adds whole months keeping the same day-of-month", () => {
    expect(addMonthsClamped("2026-01-15", 2)).toBe("2026-03-15");
  });

  it("clamps to the last day of the target month when the source day doesn't exist there (matches Postgres date + interval)", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // leap year
  });

  it("rolls over into the next year", () => {
    expect(addMonthsClamped("2026-11-30", 2)).toBe("2027-01-30");
  });

  it("supports zero and negative months", () => {
    expect(addMonthsClamped("2026-06-15", 0)).toBe("2026-06-15");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
  });
});
