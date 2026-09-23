import { describe, expect, it } from "vitest";
import { daysUntilNextBirthday, isBirthdayToday } from "../src/birthdays";

describe("daysUntilNextBirthday", () => {
  it("returns 0 when today is the birthday", () => {
    expect(daysUntilNextBirthday("1990-06-15", "2026-06-15")).toBe(0);
  });

  it("counts forward to this year's occurrence when it hasn't happened yet", () => {
    expect(daysUntilNextBirthday("1990-06-15", "2026-06-12")).toBe(3);
  });

  it("rolls over to next year's occurrence once this year's has passed", () => {
    expect(daysUntilNextBirthday("1990-06-15", "2026-06-16")).toBe(364); // 2027 is not a leap year gap here
  });

  it("handles the December-to-January wraparound", () => {
    expect(daysUntilNextBirthday("1990-01-02", "2026-12-30")).toBe(3);
  });

  it("ignores the birth year entirely — only month/day recur", () => {
    expect(daysUntilNextBirthday("1975-06-15", "2026-06-15")).toBe(0);
  });

  it("clamps a Feb 29 birthday to Feb 28 in a non-leap year", () => {
    expect(daysUntilNextBirthday("1992-02-29", "2026-02-27")).toBe(1);
    expect(daysUntilNextBirthday("1992-02-29", "2026-02-28")).toBe(0);
  });

  it("resolves a Feb 29 birthday on the real Feb 29 in a leap year", () => {
    expect(daysUntilNextBirthday("1992-02-29", "2028-02-28")).toBe(1);
    expect(daysUntilNextBirthday("1992-02-29", "2028-02-29")).toBe(0);
  });
});

describe("isBirthdayToday", () => {
  it("is true only on the exact day", () => {
    expect(isBirthdayToday("1990-06-15", "2026-06-15")).toBe(true);
    expect(isBirthdayToday("1990-06-15", "2026-06-14")).toBe(false);
    expect(isBirthdayToday("1990-06-15", "2026-06-16")).toBe(false);
  });
});
