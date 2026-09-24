import { describe, expect, it } from "vitest";
import { isBirthdayToday } from "../src/birthdays";
import {
  COUNTRY_TIMEZONES,
  DASHBOARD_TIMEZONE,
  formatBusinessDateLong,
  formatBusinessTime,
  getBusinessDateString,
  getBusinessHour,
  getBusinessMonthStartString,
  resolveCountryTimeZone,
} from "../src/businessTime";

// The canonical fixed instant from this correction round's own bug report:
// 24 September 2026, 20:30 UTC is already 25 September 2026, 00:30 in
// Dubai (UTC+4) — a UTC-derived "today" would still say the 24th for four
// more hours.
const DUBAI_BOUNDARY_INSTANT = new Date("2026-09-24T20:30:00.000Z");

describe("resolveCountryTimeZone / COUNTRY_TIMEZONES", () => {
  it("maps every country this system operates in to its correct IANA timezone", () => {
    expect(COUNTRY_TIMEZONES.AE).toBe("Asia/Dubai");
    expect(COUNTRY_TIMEZONES.SA).toBe("Asia/Riyadh");
    expect(COUNTRY_TIMEZONES.PL).toBe("Europe/Warsaw");
  });

  it("resolves each country code to its own timezone", () => {
    expect(resolveCountryTimeZone("AE")).toBe("Asia/Dubai");
    expect(resolveCountryTimeZone("SA")).toBe("Asia/Riyadh");
    expect(resolveCountryTimeZone("PL")).toBe("Europe/Warsaw");
  });

  it("falls back to the Dubai dashboard timezone for an unrecognised or missing country code, rather than throwing", () => {
    expect(resolveCountryTimeZone("ZZ")).toBe(DASHBOARD_TIMEZONE);
    expect(resolveCountryTimeZone(null)).toBe(DASHBOARD_TIMEZONE);
    expect(resolveCountryTimeZone(undefined)).toBe(DASHBOARD_TIMEZONE);
  });
});

describe("getBusinessDateString — the core UTC-boundary-crossing fix", () => {
  it("24 September 2026 20:30 UTC is already 25 September 2026 in Dubai", () => {
    expect(getBusinessDateString("Asia/Dubai", DUBAI_BOUNDARY_INSTANT)).toBe("2026-09-25");
  });

  it("the same instant is still 24 September in plain UTC — proving the fix is real, not a no-op", () => {
    expect(DUBAI_BOUNDARY_INSTANT.toISOString().slice(0, 10)).toBe("2026-09-24");
  });

  it("resolves Riyadh (UTC+3, no DST) correctly at the same instant", () => {
    // 20:30 UTC + 3h = 23:30 Riyadh, same calendar day as UTC here.
    expect(getBusinessDateString("Asia/Riyadh", DUBAI_BOUNDARY_INSTANT)).toBe("2026-09-24");
  });

  it("resolves Warsaw correctly at the same instant", () => {
    // Late September is CEST (UTC+2) in Warsaw: 20:30 UTC + 2h = 22:30, same calendar day.
    expect(getBusinessDateString("Europe/Warsaw", DUBAI_BOUNDARY_INSTANT)).toBe("2026-09-24");
  });

  it("Warsaw's own boundary crossing: 23:30 UTC in summer (CEST, UTC+2) is already the next day locally", () => {
    const instant = new Date("2026-09-24T23:30:00.000Z");
    expect(getBusinessDateString("Europe/Warsaw", instant)).toBe("2026-09-25");
  });
});

describe("Warsaw daylight-saving behaviour uses the real IANA timezone, not a fixed offset", () => {
  it("applies the summer (CEST, UTC+2) offset in late September", () => {
    // 22:30 UTC + 2h = 00:30 the next day in Warsaw during CEST.
    const summerInstant = new Date("2026-09-24T22:30:00.000Z");
    expect(getBusinessDateString("Europe/Warsaw", summerInstant)).toBe("2026-09-25");
    expect(getBusinessHour("Europe/Warsaw", summerInstant)).toBe(0);
  });

  it("applies the winter (CET, UTC+1) offset in January — the same UTC hour that rolled over in summer does NOT roll over in winter", () => {
    // 22:30 UTC + 1h = 23:30 the SAME day in Warsaw during CET (no DST).
    const winterInstant = new Date("2026-01-24T22:30:00.000Z");
    expect(getBusinessDateString("Europe/Warsaw", winterInstant)).toBe("2026-01-24");
    expect(getBusinessHour("Europe/Warsaw", winterInstant)).toBe(23);
  });
});

describe("getBusinessHour — used for a business-local time-of-day greeting", () => {
  it("returns the correct Dubai local hour at the boundary instant", () => {
    expect(getBusinessHour("Asia/Dubai", DUBAI_BOUNDARY_INSTANT)).toBe(0); // 00:30 Dubai
  });
});

describe("getBusinessMonthStartString — used by country-sensitive cron processing", () => {
  it("derives the correct business-local month start even when UTC is still in the previous month", () => {
    // 31 Aug 20:30 UTC is already 1 Sept 00:30 in Dubai.
    const instant = new Date("2026-08-31T20:30:00.000Z");
    expect(getBusinessDateString("Asia/Dubai", instant)).toBe("2026-09-01");
    expect(getBusinessMonthStartString("Asia/Dubai", instant)).toBe("2026-09-01");
    // The same instant is still August everywhere UTC or further behind it.
    expect(getBusinessMonthStartString("Asia/Riyadh", instant)).toBe("2026-08-01");
  });
});

describe("Dubai birthday displays as Today, not Tomorrow, in the affected UTC window", () => {
  it("an employee born on 25 September shows isBirthdayToday === true at 24 Sep 20:30 UTC when checked against Dubai's local date", () => {
    const dubaiToday = getBusinessDateString("Asia/Dubai", DUBAI_BOUNDARY_INSTANT);
    expect(isBirthdayToday("1990-09-25", dubaiToday)).toBe(true);
  });

  it("the same check against a UTC-derived date would have wrongly said 'not yet' — this is exactly the bug being fixed", () => {
    const utcToday = DUBAI_BOUNDARY_INSTANT.toISOString().slice(0, 10);
    expect(isBirthdayToday("1990-09-25", utcToday)).toBe(false);
  });
});

describe("Attendance/holiday lookup uses the company-local date, not a single global UTC date", () => {
  it("a UAE company and a Poland company resolve DIFFERENT local dates from the exact same instant near a boundary", () => {
    const instant = new Date("2026-09-24T22:30:00.000Z"); // 02:30 Dubai (25th), 00:30 Warsaw (25th, CEST) — pick a UAE-only-rolled instant instead
    const uaeOnlyRolled = new Date("2026-09-24T21:00:00.000Z"); // 01:00 Dubai (25th), 23:00 Warsaw (24th, CEST)
    expect(getBusinessDateString(resolveCountryTimeZone("AE"), uaeOnlyRolled)).toBe("2026-09-25");
    expect(getBusinessDateString(resolveCountryTimeZone("PL"), uaeOnlyRolled)).toBe("2026-09-24");
    // Sanity: the later instant has BOTH already rolled over.
    expect(getBusinessDateString(resolveCountryTimeZone("AE"), instant)).toBe("2026-09-25");
    expect(getBusinessDateString(resolveCountryTimeZone("PL"), instant)).toBe("2026-09-25");
  });
});

describe("formatBusinessDateLong / formatBusinessTime — dashboard header display strings", () => {
  it("formats a full business-local date string", () => {
    expect(formatBusinessDateLong("Asia/Dubai", DUBAI_BOUNDARY_INSTANT)).toBe("Friday, 25 September 2026");
  });

  it("formats a business-local time-of-day string", () => {
    expect(formatBusinessTime("Asia/Dubai", DUBAI_BOUNDARY_INSTANT)).toMatch(/12:30\s*AM/);
  });
});

describe("UTC database timestamps remain unchanged", () => {
  it("every function here returns a formatted string derived FROM an instant — it never mutates the instant itself, so a value stored/compared as a timestamptz elsewhere is completely unaffected", () => {
    const beforeIso = DUBAI_BOUNDARY_INSTANT.toISOString();
    getBusinessDateString("Asia/Dubai", DUBAI_BOUNDARY_INSTANT);
    getBusinessHour("Europe/Warsaw", DUBAI_BOUNDARY_INSTANT);
    formatBusinessDateLong("Asia/Riyadh", DUBAI_BOUNDARY_INSTANT);
    expect(DUBAI_BOUNDARY_INSTANT.toISOString()).toBe(beforeIso);
    expect(beforeIso).toBe("2026-09-24T20:30:00.000Z"); // still plain UTC, untouched
  });
});
