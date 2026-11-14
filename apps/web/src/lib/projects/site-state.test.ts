import { describe, expect, it } from "vitest";
import { describeSitePhase, kindWord, provisionalPassedText, type SitePhaseInfo } from "@/lib/projects/site-state";

const base: SitePhaseInfo = { phase: "scheduled", basis: "activity", first_day: "2026-11-11", last_day: "2026-11-11", started_at: null, kind: "setup", state: "tentative", today: "2026-11-01" };

describe("site activity state wording", () => {
  it("a suggested project date is told as tentative and from the project header", () => {
    const t = describeSitePhase({ ...base, basis: "project_header" });
    expect(t.label).toBe("Tentative Setup on 11 Nov (from the project header)");
    expect(t.fromHeader).toBe(true);
    expect(t.started).toBe(false);
  });
  it("an activity's own date is scheduled; confirmed is told as confirmed", () => {
    expect(describeSitePhase(base).label).toBe("Tentative Setup on 11 Nov");
    expect(describeSitePhase({ ...base, state: "confirmed", last_day: "2026-11-13" }).label).toBe("Confirmed Setup on 11 Nov to 13 Nov");
  });
  it("a passed date is never 'started': it says the date passed and the start is unconfirmed", () => {
    const t = describeSitePhase({ ...base, phase: "date_passed", first_day: "2026-10-20", last_day: "2026-10-20" });
    expect(t.label).toBe("Scheduled installation date passed · start unconfirmed");
    expect(t.started).toBe(false);
    expect(describeSitePhase({ ...base, phase: "date_passed", basis: "project_header" }).detail).toMatch(/project header date/);
    expect(describeSitePhase({ ...base, phase: "date_passed", kind: "show" }).label).toBe("Scheduled show date passed · start unconfirmed");
  });
  it("started is told only for an explicit record, with who recorded it", () => {
    const t = describeSitePhase({ ...base, phase: "started", started_at: "2026-11-11T05:00:00Z", started_by: "Mona Manager" });
    expect(t.label).toBe("Installation started 11 Nov");
    expect(t.started).toBe(true);
    expect(t.detail).toBe("Recorded by Mona Manager");
    expect(describeSitePhase({ ...base, phase: "started", kind: "show", started_at: "2026-11-11T05:00:00Z" }).label).toBe("Show started 11 Nov");
  });
  it("no date, and no date while the run still has to be chosen", () => {
    expect(describeSitePhase({ ...base, phase: "no_date", basis: "none", first_day: null, last_day: null }).label).toBe("No date");
    expect(describeSitePhase({ ...base, phase: "no_date", basis: "none", first_day: null, last_day: null, choice_pending: true }).label).toBe("No date · choose which run");
    expect(describeSitePhase(null).label).toBe("No date");
  });
  it("names the contact for a provisional date that has passed", () => {
    expect(provisionalPassedText("Mona Manager")).toBe("Provisional date passed · contact Mona Manager for updated details");
    expect(kindWord("setup")).toBe("installation");
  });
});
