import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeHistory, ScheduledChanges } from "./career-history-section";
import type { CareerEventRow } from "@/lib/hr/changes";

const ev = (id: string, date: string, applied: string | null, over: Partial<CareerEventRow> = {}): CareerEventRow => ({
  id, effective_date: date, event_type: "promotion", previous_job_title: "Technician", new_job_title: "Lead Technician", previous_base_salary: 5000, new_base_salary: 6500, currency: "AED", note: "Annual review", applied_at: applied, ...over,
});

describe("scheduled changes and history", () => {
  it("a scheduled change says when it takes effect and that it is not in force yet; nothing scheduled says so", () => {
    const html = renderToStaticMarkup(<ScheduledChanges events={[ev("s1", "2027-02-01", null)]} />);
    expect(html).toContain("Takes effect on 1 Feb 2027");
    expect(html).toContain("Not in force yet");
    expect(html).toContain("Job title: Technician → Lead Technician");
    expect(html).toContain("Basic salary: 5000 → 6500 AED");
    expect(renderToStaticMarkup(<ScheduledChanges events={[]} />)).toContain("No changes are scheduled.");
  });
  it("history lists applied changes with before and after, and an empty history says so", () => {
    const html = renderToStaticMarkup(<ChangeHistory events={[ev("h1", "2026-01-01", "2026-01-01T00:00:00Z")]} />);
    expect(html).toContain("Promotion");
    expect(html).toContain("Lead Technician");
    expect(html).toContain("6500");
    expect(renderToStaticMarkup(<ChangeHistory events={[]} />)).toContain("No promotions, title changes, or salary changes recorded yet.");
  });
  it("a job-only change shows no salary line", () => {
    const html = renderToStaticMarkup(<ScheduledChanges events={[ev("s2", "2027-02-01", null, { new_base_salary: null, previous_base_salary: null })]} />);
    expect(html).not.toContain("Basic salary");
  });
});
