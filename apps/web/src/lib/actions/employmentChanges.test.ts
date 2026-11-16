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

import { cancelScheduledChange, recordEmploymentChange } from "./employmentChanges";

const EMP = "11111111-1111-4111-8111-111111111111";
const CO = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hr = [{ role: "hr_admin", companyId: CO, countryCode: null }];
const finance = [{ role: "finance", companyId: CO, countryCode: null }];

const changeCalls = () => rpc.mock.calls.filter((c) => c[0] === "record_employment_change");
const DB_TODAY = day(0);   // the database's answer for the employee's own calendar day (a fixed stand-in: the real function reads the employee's country clock)
/** Answers by function name: the date helper says the employee's own day; the change says what it did. */
const answer = (change: unknown = { status: "applied", business_date: DB_TODAY }, error: { code?: string; message: string } | null = null) => (name: string) =>
  Promise.resolve(name === "hr_business_today" ? { data: DB_TODAY, error: null } : { data: error ? null : change, error });

beforeEach(() => {
  rpc.mockReset().mockImplementation(answer());
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
    const [name, args] = rpc.mock.calls.find((c) => c[0] === "record_employment_change")!;
    expect(name).toBe("record_employment_change");
    expect(args).toMatchObject({ p_employee_id: EMP, p_job_title: "Lead", p_basic: 6000, p_other: null, p_note: "Review" });
    // The caller sends no "today": the database decides the cutoff from the employee's own country.
    expect(Object.keys(args).sort()).toEqual(["p_basic", "p_effective_date", "p_employee_id", "p_job_title", "p_note", "p_other"]);
  });

  it("asks the database for today in the employee's own country, and words the answer from what the database says it did, not from the browser's or server's clock", async () => {
    // Dated the database's today: said to be in force from today, whatever this machine's UTC day is.
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: DB_TODAY, newBasicSalary: "5200" }));
    expect(rpc).toHaveBeenCalledWith("hr_business_today", { p_country_code: "AE" });
    expect(r.saved).toMatchObject({ status: "applied" });
    expect(r.saved!.message).toMatch(/from today/);
    // If the database scheduled it, it is scheduled, even where the app's own pre-check had expected it to apply.
    rpc.mockImplementation(answer({ status: "scheduled", business_date: DB_TODAY }));
    const s = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: DB_TODAY, newBasicSalary: "5300" }));
    expect(s.saved).toMatchObject({ status: "scheduled" });
    expect(s.saved!.message).toMatch(/Scheduled/);
  });

  it("does not guess today when the database cannot say: nothing is saved", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve(name === "hr_business_today" ? { data: null, error: { message: "down" } } : { data: { status: "applied" }, error: null }));
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }));
    expect(r.error).toMatch(/Nothing was saved/);
    expect(rpc.mock.calls.some((c) => c[0] === "record_employment_change")).toBe(false);
  });

  it("a later date is reported as scheduled: nothing changes until it", async () => {
    rpc.mockImplementation(answer({ status: "scheduled", business_date: DB_TODAY }));
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(40), newBasicSalary: "6500" }));
    expect(r.saved).toMatchObject({ status: "scheduled" });
    expect(r.saved!.message).toMatch(/Scheduled.*nothing changes until then/);
  });

  it("says in words, without calling the database, that nothing changed or the date is missing", async () => {
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Technician" }))).error).toMatch(/Nothing changed/);
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: "", newJobTitle: "Lead" }))).error).toMatch(/date/);
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: "nope", effectiveDate: day(0), newJobTitle: "Lead" }))).error).toBeTruthy();
    expect(rpc.mock.calls.some((c) => c[0] === "record_employment_change")).toBe(false);
  });

  it("Finance may change pay dated today, but not the title and not a later date", async () => {
    grants = finance;
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newBasicSalary: "5200" }))).error).toBeNull();
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Boss" }))).error).toMatch(/Only an HR Admin can change the job title/);
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(9), newBasicSalary: "5300" }))).error).toMatch(/Only an HR Admin can schedule/);
    expect(changeCalls()).toHaveLength(1);
  });

  it("refuses someone with no role for this company before asking the database", async () => {
    grants = [{ role: "hr_admin", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }];
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/not allowed/);
    expect(changeCalls()).toHaveLength(0);
  });

  it("an employee that cannot be read says nothing was saved and does not write; a failed pay read withholds the change", async () => {
    employeeRow = null;
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/cannot see/);
    employeeRow = { id: EMP, company_id: CO, country_code: "AE", job_title: "Technician", deleted_at: null };
    compError = { message: "down" };
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/Nothing was saved/);
    expect(changeCalls()).toHaveLength(0);
  });

  it("shows the database's own sentence for a refusal, never a raw error, and says all-or-nothing on an unexpected failure", async () => {
    rpc.mockImplementation(answer(null, { code: "22023", message: "The change cannot take effect before the hire date (2024-01-01)." }));
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(-5), newJobTitle: "Lead" }))).error).toMatch(/hire date/);
    rpc.mockImplementation(answer(null, { code: "XX000", message: "relation \"compensation_details\" blew up" }));
    const r = await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }));
    expect(r.error).toMatch(/saved together or not at all/);
    expect(r.error).not.toMatch(/blew up/);
    expect(r.saved).toBeUndefined();
    rpc.mockImplementation(answer(null, { code: "PGRST202", message: "no function" }));
    expect((await recordEmploymentChange({ error: null }, fd({ employeeId: EMP, effectiveDate: day(0), newJobTitle: "Lead" }))).error).toMatch(/not installed/);
  });
});

describe("cancelScheduledChange", () => {
  const EVENT = "44444444-4444-4444-8444-444444444444";
  it("sends only the event to the database function, whose own check is the boundary, and shows its sentence for a refusal", async () => {
    const ok = await cancelScheduledChange({ error: null }, fd({ eventId: EVENT, employeeId: EMP }));
    expect(ok.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("dismiss_employment_change", { p_event_id: EVENT });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "You are not allowed to cancel this change." } });
    expect((await cancelScheduledChange({ error: null }, fd({ eventId: EVENT, employeeId: EMP }))).error).toMatch(/not allowed to cancel/);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "This change is already in force, so it cannot be cancelled. Record a new change instead." } });
    expect((await cancelScheduledChange({ error: null }, fd({ eventId: EVENT, employeeId: EMP }))).error).toMatch(/already in force/);
  });
  it("never shows a raw error, says nothing was changed, and refuses a malformed id without calling the database", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom internal" } });
    const r = await cancelScheduledChange({ error: null }, fd({ eventId: EVENT, employeeId: EMP }));
    expect(r.error).toMatch(/Nothing was changed/);
    expect(r.error).not.toMatch(/boom/);
    rpc.mockClear();
    expect((await cancelScheduledChange({ error: null }, fd({ eventId: "nope", employeeId: EMP }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});
