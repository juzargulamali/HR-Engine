import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/employmentChanges", () => ({ recordEmploymentChange: vi.fn() }));

import { ChangeEmploymentForm } from "./change-employment-form";

const base = {
  employeeId: "e1", employeeName: "Fictional Technician", companyName: "Fictional Enginious LLC FZ", today: "2026-11-16", hireDate: "2024-01-01",
  currentJobTitle: "Technician", currentBasic: 5000, currentOther: 500, currency: "AED",
  canChangeTitle: true, canSchedule: true, leadWith: "job" as const, firstSalary: false, startOpen: false,
};

describe("ChangeEmploymentForm", () => {
  it("keeps the employee and company in view and says, before saving, that nothing is to save yet", () => {
    const html = renderToStaticMarkup(<ChangeEmploymentForm {...base} />);
    expect(html).toContain("Fictional Technician");
    expect(html).toContain("Fictional Enginious LLC FZ");
    expect(html).toContain("Nothing to save yet");
    expect(html).toContain('name="newJobTitle"');
    expect(html).toContain('name="note"');
    expect(html).toContain('value="2026-11-16"'); // the date defaults to today
    expect(html.indexOf("newJobTitle")).toBeLessThan(html.indexOf("newBasicSalary"));
  });
  it("leads with pay when asked and shows current values as placeholders", () => {
    const html = renderToStaticMarkup(<ChangeEmploymentForm {...base} leadWith="pay" />);
    expect(html.indexOf("newBasicSalary")).toBeLessThan(html.indexOf("newJobTitle"));
    expect(html).toContain('placeholder="5000"');
    expect(html).toContain('placeholder="500"');
  });
  it("the first salary is 'Add salary', dated from the hire date, with the salary required", () => {
    const html = renderToStaticMarkup(<ChangeEmploymentForm {...base} firstSalary currentBasic={null} currentOther={0} currency="AED" leadWith="pay" />);
    expect(html).toContain("Add salary");
    expect(html).toContain('value="2024-01-01"');
    expect(html).toMatch(/id="newBasicSalary"[^>]*required/);
  });
  it("Finance sees pay only: no title field, no note, and no date after today", () => {
    const html = renderToStaticMarkup(<ChangeEmploymentForm {...base} canChangeTitle={false} canSchedule={false} leadWith="pay" />);
    expect(html).not.toContain('name="newJobTitle"');
    expect(html).not.toContain('name="note"');
    expect(html).toContain('max="2026-11-16"');
  });
});
