import { describe, expect, it } from "vitest";
import {
  availabilityDisplay, commercialApprovalLabel, daysOverdue, dubaiDateTimeToIso, followUpTiming, isCommerciallyWon,
  parseWorkingCalendar, responseTimeKpi, totalsByCurrency, workingHoursBetween,
} from "../src";

const NOW = new Date("2026-10-19T05:30:00Z"); // 09:30 in Dubai, Monday

describe("follow-up timing (Dubai)", () => {
  it("classifies overdue, due today and upcoming", () => {
    expect(followUpTiming("2026-10-19T04:00:00Z", NOW)).toBe("overdue");
    expect(followUpTiming("2026-10-19T11:00:00Z", NOW)).toBe("due_today"); // 15:00 Dubai
    expect(followUpTiming("2026-10-19T20:30:00Z", NOW)).toBe("upcoming"); // 00:30 on the 20th in Dubai
    expect(followUpTiming("2026-10-21T08:00:00Z", NOW)).toBe("upcoming");
  });
  it("counts whole days overdue", () => {
    expect(daysOverdue("2026-10-17T05:30:00Z", NOW)).toBe(2);
    expect(daysOverdue("2026-10-19T09:00:00Z", NOW)).toBe(0);
  });
  it("converts Dubai wall time to UTC", () => {
    expect(dubaiDateTimeToIso("2026-10-20", "11:00")).toBe("2026-10-20T07:00:00.000Z");
    expect(dubaiDateTimeToIso("20/10/2026", "11:00")).toBeNull();
  });
});

describe("equipment availability recheck", () => {
  const covers = { install_start: "2026-11-20", event_start: "2026-11-24", event_end: "2026-11-26", technologies: [{ name: "LED tunnel", qty: 1 }] };
  const subject = { availabilityState: "confirmed" as const, availabilityCovers: covers, installStart: "2026-11-20", eventStart: "2026-11-24", eventEnd: "2026-11-26", technologies: [{ name: "LED tunnel", qty: 1 }] };
  it("stays confirmed while nothing changed", () => expect(availabilityDisplay(subject)).toBe("confirmed"));
  it("needs recheck when dates, technologies or quantities change", () => {
    expect(availabilityDisplay({ ...subject, eventStart: "2026-11-25" })).toBe("needs_recheck");
    expect(availabilityDisplay({ ...subject, installStart: null })).toBe("needs_recheck");
    expect(availabilityDisplay({ ...subject, technologies: [{ name: "LED tunnel", qty: 2 }] })).toBe("needs_recheck");
    expect(availabilityDisplay({ ...subject, technologies: [...subject.technologies, { name: "Kiosk", qty: 1 }] })).toBe("needs_recheck");
  });
  it("treats a check with no recorded coverage as needing a recheck", () => {
    expect(availabilityDisplay({ ...subject, availabilityCovers: null })).toBe("needs_recheck");
  });
  it("passes unchecked and awaiting through", () => {
    expect(availabilityDisplay({ ...subject, availabilityState: "unverified", availabilityCovers: null })).toBe("unverified");
    expect(availabilityDisplay({ ...subject, availabilityState: "awaiting", availabilityCovers: null })).toBe("awaiting");
  });
});

describe("commercial approval is never shown as granted unless recorded", () => {
  it("shows 'not configured' by default", () => {
    expect(commercialApprovalLabel("not_configured", null).label).toMatch(/not configured/i);
    expect(commercialApprovalLabel("not_configured", { state: "approved" }).label).not.toBe("Approved"); // a stale record cannot override
  });
  it("shows the real state under a configured policy", () => {
    expect(commercialApprovalLabel("required", null).label).toBe("Approval not requested");
    expect(commercialApprovalLabel("required", { state: "pending" }).tone).toBe("warning");
    expect(commercialApprovalLabel("required", { state: "approved" })).toEqual({ label: "Approved", tone: "positive" });
    expect(commercialApprovalLabel("not_required", null).label).toMatch(/not required/i);
  });
  it("treats 'commercially won' as Won with evidence only", () => {
    expect(isCommerciallyWon({ stage: "won", evidenceReference: "PO-1" })).toBe(true);
    expect(isCommerciallyWon({ stage: "negotiation", evidenceReference: "PO-1" })).toBe(false);
    expect(isCommerciallyWon({ stage: "won", evidenceReference: null })).toBe(false);
  });
});

describe("response-time KPI", () => {
  const cal = { workdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", holidays: ["2026-10-20"] };
  it("is not configured without a target or a calendar, never a made-up number", () => {
    expect(responseTimeKpi({ responseTargetHours: null, workingCalendar: cal }, [], NOW).status).toBe("not_configured");
    expect(responseTimeKpi({ responseTargetHours: 4, workingCalendar: null }, [], NOW).status).toBe("not_configured");
    expect(responseTimeKpi({ responseTargetHours: 0, workingCalendar: cal }, [], NOW).status).toBe("not_configured");
    expect(responseTimeKpi({ responseTargetHours: 4, workingCalendar: { workdays: [], start: "09:00", end: "18:00" } }, [], NOW).status).toBe("not_configured");
  });
  it("parses and rejects calendars", () => {
    expect(parseWorkingCalendar(cal)).toEqual(cal);
    expect(parseWorkingCalendar({ ...cal, end: "08:00" })).toBeNull();
    expect(parseWorkingCalendar("nope")).toBeNull();
  });
  it("counts only working hours (excludes nights, weekends, holidays)", () => {
    const c = parseWorkingCalendar(cal)!;
    // Fri 16:00 Dubai -> Mon 10:00 Dubai = 2h Friday + 1h Monday
    expect(workingHoursBetween(c, new Date("2026-10-16T12:00:00Z"), new Date("2026-10-19T06:00:00Z"))).toBeCloseTo(3, 5);
    // Mon 17:00 -> Wed 10:00, Tuesday is a holiday: 1h Monday + 1h Wednesday
    expect(workingHoursBetween(c, new Date("2026-10-19T13:00:00Z"), new Date("2026-10-21T06:00:00Z"))).toBeCloseTo(2, 5);
  });
  it("measures the share answered within target once configured", () => {
    const opps = [
      { createdAt: "2026-10-19T05:00:00Z", firstResponseAt: "2026-10-19T06:00:00Z" }, // 09:00 -> 10:00: 1h
      { createdAt: "2026-10-19T05:00:00Z", firstResponseAt: "2026-10-19T12:00:00Z" }, // 09:00 -> 16:00: 7h
      { createdAt: "2026-10-19T05:20:00Z", firstResponseAt: null }, // waiting, 10 minutes old at 'now'
    ];
    const k = responseTimeKpi({ responseTargetHours: 4, workingCalendar: cal }, opps, NOW);
    expect(k).toMatchObject({ status: "ok", measured: 2, withinTarget: 1, waiting: 1 });
  });
});

describe("currency totals", () => {
  it("never mixes currencies", () => {
    expect(totalsByCurrency([{ currency: "AED", value: 100 }, { currency: "SAR", value: 50 }, { currency: "AED", value: 25 }, { currency: "EUR", value: null }]))
      .toEqual({ AED: 125, SAR: 50 });
  });
});
