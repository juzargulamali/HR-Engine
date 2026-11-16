import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
let employeeRow: Record<string, unknown> | null;
let compRow: Record<string, unknown> | null;
let employeeError: { message: string } | null;
let compError: { message: string } | null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, _v: unknown) => ({
          maybeSingle: async () => (table === "employees" ? { data: employeeRow, error: employeeError } : { data: null, error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: compRow, error: compError }) }),
        }),
      }),
    }),
  }),
}));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", email: null, fullName: null, grants, employeeId: null }) }));

import { recordEmploymentChange } from "./employmentChanges";

const EMP = "11111111-1111-4111-8111-111111111111";
const CO = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hr = [{ role: "hr_admin", companyId: CO, countryCode: null }];
const finance = [{ role: "finance", companyId: CO, countryCode: null }];

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { status: "applied" }, error: null });
  employeeRow = { id: EMP, company_id: CO, country_code: "AE", job_title: "Technician", deleted_at: null };
  compRow = { base_salary: "5000", allowances: { other: 500 } };
  employeeError = null; compError = null; grants = hr;
});

describe("recordEmploymentChange", () => {
  it("a change dated today goes to the one database function, with today in the employee's country, and says it is in force", async () => {
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead", newBasicSalary: "6000", newOtherAllowance: "", note: "Review" }));
    expect(r.error).toBeNull();
    expect(r.saved).toMatchObject({ status: "applied" });
    expect(r.saved!.message).toMatch(/job title and pay are in force from today/);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("record_employment_change");
    expect(args).toMatchObject({ p_employee_id: EMP, p_job_title: "Lead", p_basic: 6000, p_other: null, p_note: "Review" });
    expect(args.p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a later date is reported as scheduled: nothing changes until it", async () => {
    rpc.mockResolvedValue({ data: { status: "scheduled" }, error: null });
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(40), newBasicSalary: "6500" }));
    expect(r.saved).toMatchObject({ status: "scheduled" });
    expect(r.saved!.message).toMatch(/Scheduled.*nothing changes until then/);
  });

  it("says in words, without calling the database, that nothing changed or the date is missing", async () => {
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Technician" }))).error).toMatch(/Nothing changed/);
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: "", newJobTitle: "Lead" }))).error).toMatch(/date/);
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: "nope", effectiveDate: day(0), newJobTitle: "Lead" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Finance may change pay dated today, but not the title and not a later date", async () => {
    grants = finance;
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newBasicSalary: "5200" }))).error).toBeNull();
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Boss" }))).error).toMatch(/Only an HR Admin can change the job title/);
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(9), newBasicSalary: "5300" }))).error).toMatch(/Only an HR Admin can schedule/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses someone with no role for this company before asking the database", async () => {
    grants = [{ role: "hr_admin", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }];
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/not allowed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an employee that cannot be read says nothing was saved and does not write; a failed pay read withholds the change", async () => {
    employeeRow = null;
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/cannot see/);
    employeeRow = { id: EMP, company_id: CO, country_code: "AE", job_title: "Technician", deleted_at: null };
    compError = { message: "down" };
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/Nothing was saved/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's own sentence for a refusal, never a raw error, and says all-or-nothing on an unexpected failure", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "The change cannot take effect before the hire date (2024-01-01)." } });
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(-5), newJobTitle: "Lead" }))).error).toMatch(/hire date/);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "relation \"compensation_details\" blew up" } });
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }));
    expect(r.error).toMatch(/saved together or not at all/);
    expect(r.error).not.toMatch(/blew up/);
    expect(r.saved).toBeUndefined();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "no function" } });
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/not installed/);
  });
});
