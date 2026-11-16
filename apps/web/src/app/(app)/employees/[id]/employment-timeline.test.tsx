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
  it("a change the daily job held back says so with its reason and nothing was changed; an HR Admin gets a cancel control, anyone else does not", () => {
    const held = ev("s3", "2027-02-01", null, { conflict_reason: "Pay changed after this change was scheduled (the current pay has been in force since 2026-11-10). It was not applied." });
    const hr = renderToStaticMarkup(<ScheduledChanges events={[held]} employeeId="11111111-1111-4111-8111-111111111111" />);
    expect(hr).toContain("Held for review");
    expect(hr).toContain("Pay changed after this change was scheduled");
    expect(hr).toContain("Nothing was changed");
    expect(hr).toContain("Cancel this held change");
    const other = renderToStaticMarkup(<ScheduledChanges events={[held]} />);
    expect(other).toContain("Held for review");
    expect(other).not.toContain("Cancel this");
    const plain = renderToStaticMarkup(<ScheduledChanges events={[ev("s4", "2027-02-01", null)]} employeeId="11111111-1111-4111-8111-111111111111" />);
    expect(plain).not.toContain("Held for review");
    expect(plain).toContain("Cancel this change");
  });
  it("history marks a cancelled change as never applied", () => {
    const html = renderToStaticMarkup(<ChangeHistory events={[ev("h2", "2027-02-01", null, { dismissed_at: "2026-11-16T09:00:00Z" })]} />);
    expect(html).toContain("Cancelled, never applied");
  });
});
