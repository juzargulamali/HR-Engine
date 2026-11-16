import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/actions/employees", () => ({}));

import { SetupChecklist } from "./setup-checklist";
import { NextActions } from "./next-actions";
import { policyReview } from "./insurance-section";
import { performanceNextSteps } from "./performance-section";
import { computeSetup } from "@/lib/hr/setup";

const base = { employeeId: "e1", employmentStatus: "active" as const, removed: false, linkedUserId: null, viewerCanInvite: false, viewerCanOpenAccess: false };

describe("SetupChecklist", () => {
  it("keeps the employee and company in view, says each status in words and gives one action per step to do", () => {
    const steps = computeSetup({ ...base, counts: { contracts: 1, compensation: 0, identityDocuments: 0, employeeDocuments: 0, openingBalances: 0 } });
    const html = renderToStaticMarkup(<SetupChecklist steps={steps} employeeName="Cara Assignee" companyName="Enginious Local AE" focusStep="pay" />);
    expect(html).toContain("Cara Assignee");
    expect(html).toContain("Enginious Local AE");
    expect(html).toContain("3 of 4 setup steps to do");
    for (const w of ["Done", "To do", "Optional"]) expect(html).toContain(w);
    expect(html).toContain('href="/employees/e1?tab=employment&amp;step=pay"');
    expect(html).toContain('href="/employees/e1?tab=documents&amp;step=documents"');
    expect(html).toContain('href="/employees/e1?tab=leave&amp;step=opening-balances"');
    // the step the person came from is the highlighted one
    expect(html.match(/[" ]ring-2 ring-ring/g)?.length).toBe(1);
    expect(html).toMatch(/id="step-compensation"[^>]*[" ]ring-2 ring-ring|[" ]ring-2 ring-ring[^>]*id="step-compensation"/);
  });
  it("shows a compact 'Setup complete' when nothing is left, and Not applicable for someone who has left", () => {
    const done = computeSetup({ ...base, counts: { contracts: 1, compensation: 1, identityDocuments: 1, employeeDocuments: 0, openingBalances: 1 }, linkedUserId: "u1" });
    expect(renderToStaticMarkup(<SetupChecklist steps={done} employeeName="A B" companyName="C" />)).toContain("Setup complete");
    const left = computeSetup({ ...base, employmentStatus: "terminated", counts: { contracts: 0, compensation: 0, identityDocuments: 0, employeeDocuments: 0, openingBalances: 0 } });
    const html = renderToStaticMarkup(<SetupChecklist steps={left} employeeName="A B" companyName="C" />);
    expect(html).toContain("Not applicable");
    expect(html).not.toContain("To do");
  });
  it("renders nothing for a viewer with no steps", () => {
    expect(renderToStaticMarkup(<SetupChecklist steps={[]} employeeName="A" companyName="C" />)).toBe("");
  });
});

describe("NextActions", () => {
  it("lists each flag with a link to the exact place, and nothing when there are none", () => {
    expect(renderToStaticMarkup(<NextActions exceptions={[]} />)).toBe("");
    const html = renderToStaticMarkup(<NextActions exceptions={[{ key: "expired", label: "1 document expired", tone: "attention", href: "/employees/e1?tab=documents" }]} />);
    expect(html).toContain("1 document expired");
    expect(html).toContain('href="/employees/e1?tab=documents"');
  });
});

describe("policyReview", () => {
  it("says what the expiry means and who acts next, from the date alone", () => {
    expect(policyReview(null, "2026-11-16")).toEqual({ text: "No expiry date recorded", attention: false });
    expect(policyReview("2026-10-01", "2026-11-16")).toMatchObject({ text: "Expired. An HR Admin renews it", attention: true });
    expect(policyReview("2026-12-06", "2026-11-16").text).toBe("Expires in 20 days. An HR Admin renews it");
    expect(policyReview("2027-06-01", "2026-11-16")).toEqual({ text: "Active", attention: false });
  });
});

describe("performanceNextSteps", () => {
  it("counts open goals, names who rates next and who acts on appraisals", () => {
    const t = performanceNextSteps(
      [{ status: "in_progress", manager_rating: null }, { status: "in_progress", manager_rating: 4 }, { status: "achieved", manager_rating: 5 }],
      [{ status: "draft" }, { status: "submitted" }, { status: "acknowledged" }],
      "Mona Manager",
    );
    expect(t).toEqual([
      "2 open goals. 1 still need Mona Manager's rating.",
      "1 appraisal is in draft: Mona Manager or an HR Admin submits it.",
      "1 appraisal is waiting for the employee to acknowledge.",
    ]);
    expect(performanceNextSteps([], [], "x")).toEqual([]);
  });
});
