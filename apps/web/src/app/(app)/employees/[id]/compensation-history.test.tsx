import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/payCorrection", () => ({ correctPayRecord: vi.fn() }));

type Result = { data: unknown; error: { message: string } | null };
let tables: Record<string, Result>;
let today: Result;
const chain = (table: string) => {
  const c: Record<string, unknown> = {};
  const self = () => new Proxy(c, {
    get: (_t, prop) => {
      if (prop === "then") return (resolve: (v: Result) => void) => resolve(tables[table]!);
      if (prop === "maybeSingle") return async () => tables[table];
      return () => self();
    },
  });
  return self();
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t), rpc: async () => today }) }));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", email: null, fullName: null, grants, employeeId: null }) }));

import { CompensationHistory } from "./compensation-history";

const CO = "22222222-2222-4222-8222-222222222222";
const hr = [{ role: "hr_admin", companyId: CO, countryCode: null }];
const render = async (isSelf = false) => renderToStaticMarkup(await CompensationHistory({ employeeId: "emp-1", companyName: "Fictional Aurora LLC", countryCode: "AE", hireDate: "2024-01-01", isSelf }));

// Fictional: the opening record was saved with the joining date; HR corrected its date and amount, then a raise followed.
beforeEach(() => {
  grants = hr;
  today = { data: "2026-11-16", error: null };
  tables = {
    employees: { data: { company_id: CO, first_name: "Fictional", last_name: "Technician" }, error: null },
    compensation_details: {
      data: [
        { id: "new", effective_from: "2026-01-01", base_salary: "9000", allowances: { other: 700 }, currency: "AED", is_current: true, created_at: "2026-01-01T08:00:00Z" },
        { id: "open", effective_from: "2025-03-01", base_salary: "8000", allowances: { other: 500 }, currency: "AED", is_current: false, created_at: "2024-01-01T08:00:00Z" },
      ],
      error: null,
    },
    compensation_corrections: {
      data: [{ id: "c1", compensation_id: "open", previous_effective_from: "2024-01-01", previous_base_salary: "8000", previous_allowances: { other: 500 }, new_effective_from: "2025-03-01", new_base_salary: "8000", new_allowances: { other: 500 }, reason: "Entered with the joining date", corrected_by: "u9", corrected_at: "2026-11-10T09:00:00Z" }],
      error: null,
    },
    employee_career_events: { data: [], error: null },
    profiles: { data: [{ id: "u9", full_name: "Fictional Hr Person" }], error: null },
  };
});

describe("CompensationHistory", () => {
  it("lists every pay record, marks the one in force today, and marks a corrected entry with who, when and why and the original values", async () => {
    const html = await render();
    expect(html).toContain("Pay history");
    expect(html.match(/data-in-force="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="pay-record-new"[^>]*data-in-force="true"/);
    expect(html).toContain("In force today");
    expect(html).toContain("Replaced by a later record");
    expect(html).toContain("Corrected on 10 Nov 2026 by Fictional Hr Person: Entered with the joining date");
    expect(html).toContain("Original entry: from 1 Jan 2024, basic 8,000 AED, others 500 AED.");
    expect(html).toContain(">Corrected<");
    // the entry that was never corrected carries no correction note
    expect(html.match(/Original entry/g)).toHaveLength(1);
  });

  it("offers Correct pay record on each entry to HR Admin and Finance of the company", async () => {
    expect((await render()).match(/Correct pay record/g)).toHaveLength(2);
    grants = [{ role: "finance", companyId: CO, countryCode: null }];
    expect((await render()).match(/Correct pay record/g)).toHaveLength(2);
  });

  it("shows the history but no correction button on one's own record, and nothing at all to a plain employee, a manager or another company's HR Admin", async () => {
    const own = await render(true);
    expect(own).toContain("Pay history");
    expect(own).not.toContain("Correct pay record");
    for (const g of [[{ role: "employee", companyId: CO, countryCode: null }], [{ role: "line_manager", companyId: CO, countryCode: null }], [{ role: "hr_admin", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }]]) {
      grants = g;
      expect(await render()).toBe("");
    }
  });

  it("an unreadable correction list or date shows a load error instead of a partial history", async () => {
    tables.compensation_corrections = { data: null, error: { message: "down" } };
    const html = await render();
    expect(html).not.toContain("In force today");
    expect(html).toMatch(/pay history/i);
    expect(html).not.toContain("Correct pay record");
  });
});
