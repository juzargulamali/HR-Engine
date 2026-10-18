import { describe, expect, it } from "vitest";
import type { PlanTableRow } from "@enginious-hr/domain";
import { groupPlanRows, issuedDateText, planPdfFileName, timeZoneNote } from "./plan-layout";

const row = (section: PlanTableRow["section"], title: string): PlanTableRow => ({ section, title, when: "x", detail: "" });

describe("groupPlanRows", () => {
  it("keeps the fixed section order and drops empty sections", () => {
    const g = groupPlanRows([row("Dependencies on others", "d"), row("Milestones", "m1"), row("Site production timeline", "s"), row("Milestones", "m2")]);
    expect(g.map((s) => s.title)).toEqual(["Milestones", "Site production timeline", "Dependencies on others"]);
    expect(g[0]!.rows.map((r) => r.title)).toEqual(["m1", "m2"]);
  });
  it("returns nothing for no rows", () => {
    expect(groupPlanRows([])).toEqual([]);
  });
});

describe("planPdfFileName", () => {
  it("is header-safe and carries the version", () => {
    expect(planPdfFileName("UAE-P-2026-0001", 2)).toBe("timeline-UAE-P-2026-0001-v2.pdf");
    expect(planPdfFileName('A "quoted"\r\nref/../x', 1)).toBe("timeline-A-quoted-ref-..-x-v1.pdf");
    expect(planPdfFileName("///", 0)).toBe("timeline-project-v1.pdf");
  });
});

describe("issuedDateText", () => {
  it("uses the date in the site's zone, not UTC", () => {
    expect(issuedDateText("2099-03-05T21:30:00Z", "Asia/Dubai")).toBe("6 Mar 2099");
    expect(issuedDateText("2099-03-05T21:30:00Z", "UTC")).toBe("5 Mar 2099");
  });
  it("states the time zone clearly", () => {
    expect(timeZoneNote("Asia/Dubai")).toContain("Asia/Dubai");
  });
});
