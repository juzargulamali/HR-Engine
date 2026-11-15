import { describe, expect, it } from "vitest";
import { addDays, companyTimeZone, crmToday, CRM_TIME_ZONE_CHOICES, followUpTiming, isSkippedLocalTime, isValidTimeZone, timeOfDayIn, timeZoneCity, zonedDateTimeToIso } from "../src";

// Follow-up deadlines on a company's own clock. Poland changes its clocks on the last Sunday of March (02:00 becomes 03:00) and of October (03:00 becomes 02:00):
// 28 March 2027 and 31 October 2027. Fictional deadlines throughout.
const WAW = "Europe/Warsaw";
const DXB = "Asia/Dubai";

describe("a company's follow-up time zone", () => {
  it("is the company's setting when it is a named zone, and Dubai otherwise (no settings, an old database, a fixed offset)", () => {
    expect(companyTimeZone({ follow_up_time_zone: WAW })).toBe(WAW);
    expect(companyTimeZone({ follow_up_time_zone: null })).toBe(DXB);
    expect(companyTimeZone({})).toBe(DXB);
    expect(companyTimeZone(null)).toBe(DXB);
    for (const bad of ["+01:00", "UTC+1", "Etc/GMT+1", "CET", "Europe/Atlantis", "", "Warsaw"]) expect(companyTimeZone({ follow_up_time_zone: bad }), bad).toBe(DXB);
  });
  it("accepts IANA names only, and every zone offered in settings is one", () => {
    for (const z of CRM_TIME_ZONE_CHOICES) expect(isValidTimeZone(z), z).toBe(true);
    for (const bad of ["+01:00", "UTC", "GMT+1", "Etc/GMT+1", "CET", null, undefined, 5, "Europe/Atlantis"]) expect(isValidTimeZone(bad), String(bad)).toBe(false);
    expect([timeZoneCity(WAW), timeZoneCity(DXB), timeZoneCity("America/New_York")]).toEqual(["Warsaw", "Dubai", "New York"]);
  });
});

describe("typing a deadline on the company's clock", () => {
  it("is the same wall-clock time, a different moment, in Warsaw and in Dubai; winter and summer offsets come from the zone database", () => {
    expect(zonedDateTimeToIso(DXB, "2027-01-15", "11:00")).toBe("2027-01-15T07:00:00.000Z");
    expect(zonedDateTimeToIso(WAW, "2027-01-15", "11:00")).toBe("2027-01-15T10:00:00.000Z");   // winter, UTC+1
    expect(zonedDateTimeToIso(WAW, "2027-07-15", "11:00")).toBe("2027-07-15T09:00:00.000Z");   // summer, UTC+2
    expect(zonedDateTimeToIso(WAW, "2027-07-15", "25:00")).toBeNull();
    expect(zonedDateTimeToIso(WAW, "15/07/2027", "11:00")).toBeNull();
  });
  it("02:30 on the spring-forward night does not exist in Warsaw: it is refused, never moved; the same time in Dubai is fine", () => {
    expect(zonedDateTimeToIso(WAW, "2027-03-28", "02:30")).toBeNull();
    expect(isSkippedLocalTime(WAW, "2027-03-28", "02:30")).toBe(true);
    expect(isSkippedLocalTime(WAW, "2027-03-28", "03:00")).toBe(false);
    expect(isSkippedLocalTime(WAW, "2027-03-27", "02:30")).toBe(false);
    expect(isSkippedLocalTime(DXB, "2027-03-28", "02:30")).toBe(false);
    expect(isSkippedLocalTime(WAW, "2027-02-30", "02:30")).toBe(false);                         // not a date at all: a different message
    expect(zonedDateTimeToIso(DXB, "2027-03-28", "02:30")).toBe("2027-03-27T22:30:00.000Z");
    // just before and just after the gap
    expect(zonedDateTimeToIso(WAW, "2027-03-28", "01:59")).toBe("2027-03-28T00:59:00.000Z");
    expect(zonedDateTimeToIso(WAW, "2027-03-28", "03:00")).toBe("2027-03-28T01:00:00.000Z");
  });
  it("00:15 on both change nights is an ordinary time; 02:30 on the autumn night happens twice and is its first occurrence", () => {
    expect(zonedDateTimeToIso(WAW, "2027-03-28", "00:15")).toBe("2027-03-27T23:15:00.000Z");
    expect(zonedDateTimeToIso(WAW, "2027-10-31", "00:15")).toBe("2027-10-30T22:15:00.000Z");
    expect(zonedDateTimeToIso(WAW, "2027-10-31", "02:30")).toBe("2027-10-31T00:30:00.000Z");   // still summer time
  });
  it("a stored moment reads back on the company's clock: an existing Dubai 11:00 deadline is 08:00 in Warsaw in winter, and is not moved", () => {
    const stored = "2027-01-15T07:00:00.000Z";
    expect(timeOfDayIn(DXB, stored)).toBe("11:00");
    expect(timeOfDayIn(WAW, stored)).toBe("08:00");
    expect(timeOfDayIn(WAW, "2027-03-27T23:15:00.000Z")).toBe("00:15");
    expect(timeOfDayIn(WAW, "not a date")).toBeNull();
    expect(timeOfDayIn(WAW, null)).toBeNull();
  });
});

describe("Overdue, Today and Upcoming on the company's calendar day", () => {
  it("a follow-up due 00:15 Warsaw is Today in Warsaw from Warsaw midnight, and still Upcoming there while it is already that day in Dubai", () => {
    const due = "2027-01-15T23:15:00.000Z";                                                     // 00:15 on the 16th in Warsaw, 03:15 on the 16th in Dubai
    const lateEvening = new Date("2027-01-15T21:30:00.000Z");                                   // 22:30 on the 15th in Warsaw, 01:30 on the 16th in Dubai
    expect(followUpTiming(due, lateEvening, WAW)).toBe("upcoming");
    expect(followUpTiming(due, lateEvening, DXB)).toBe("due_today");
    expect(followUpTiming(due, lateEvening)).toBe("due_today");                                 // the default stays Dubai
    expect(followUpTiming(due, new Date("2027-01-15T23:05:00.000Z"), WAW)).toBe("due_today");   // 00:05 on the 16th in Warsaw
    expect(followUpTiming(due, new Date("2027-01-15T23:16:00.000Z"), WAW)).toBe("overdue");     // overdue is the moment, the same in every zone
    expect(followUpTiming(due, new Date("2027-01-15T23:16:00.000Z"), DXB)).toBe("overdue");
  });
  it("around midnight on the spring-forward night and the autumn night", () => {
    const spring = "2027-03-27T23:15:00.000Z";                                                  // 00:15 on Sunday 28 March in Warsaw
    expect(followUpTiming(spring, new Date("2027-03-27T22:59:00.000Z"), WAW)).toBe("upcoming"); // 23:59 on the 27th
    expect(followUpTiming(spring, new Date("2027-03-27T23:00:00.000Z"), WAW)).toBe("due_today");// 00:00 on the 28th
    // a deadline at 23:30 on the 28th (21:30 UTC, summer time already) is still "today" at 03:30 local, just after the missing hour
    expect(followUpTiming("2027-03-28T21:30:00.000Z", new Date("2027-03-28T01:30:00.000Z"), WAW)).toBe("due_today");
    const autumn = "2027-10-30T22:15:00.000Z";                                                  // 00:15 on Sunday 31 October in Warsaw (summer time)
    expect(followUpTiming(autumn, new Date("2027-10-30T21:59:00.000Z"), WAW)).toBe("upcoming");
    expect(followUpTiming(autumn, new Date("2027-10-30T22:00:00.000Z"), WAW)).toBe("due_today");
    // 23:30 on the 31st is 22:30 UTC (winter time): the 25-hour day is one calendar day
    expect(followUpTiming("2027-10-31T22:30:00.000Z", new Date("2027-10-30T22:30:00.000Z"), WAW)).toBe("due_today");
    expect(followUpTiming("2027-10-31T23:30:00.000Z", new Date("2027-10-30T22:30:00.000Z"), WAW)).toBe("upcoming");
  });
  it("'today' and 'tomorrow' are calendar days of the zone: tomorrow across each change is the next date at the same clock time, not 24 hours later", () => {
    const eveSpring = new Date("2027-03-27T20:00:00.000Z");                                     // 21:00 on the 27th in Warsaw, 00:00 on the 28th in Dubai
    expect(crmToday(eveSpring, WAW)).toBe("2027-03-27");
    expect(crmToday(eveSpring, DXB)).toBe("2027-03-28");
    expect(crmToday(eveSpring)).toBe("2027-03-28");
    expect(zonedDateTimeToIso(WAW, addDays(crmToday(eveSpring, WAW), 1), "10:00")).toBe("2027-03-28T08:00:00.000Z");   // 23 hours after 10:00 on the 27th
    const eveAutumn = new Date("2027-10-30T20:00:00.000Z");                                     // 22:00 on the 30th in Warsaw
    expect(zonedDateTimeToIso(WAW, addDays(crmToday(eveAutumn, WAW), 1), "10:00")).toBe("2027-10-31T09:00:00.000Z");   // 25 hours after 10:00 on the 30th
  });
});
