import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const rpc = vi.fn();
let recordRow: Record<string, unknown> | null;
let employeeRow: Record<string, unknown> | null;
let recordError: { message: string } | null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () => (table === "compensation_details" ? { data: recordRow, error: recordError } : { data: employeeRow, error: null }),
        };
        return chain;
      },
    }),
  }),
}));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
let signedIn = true;
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => (signedIn ? { userId: "u1", email: null, fullName: null, grants, employeeId: null } : null) }));

import { correctPayRecord } from "./payCorrection";

const EMP = "11111111-1111-4111-8111-111111111111";
const CO = "22222222-2222-4222-8222-222222222222";
const REC = "33333333-3333-4333-8333-333333333333";
const KEY = "request-key-0001";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const hr = [{ role: "hr_admin", companyId: CO, countryCode: null }];
const finance = [{ role: "finance", companyId: CO, countryCode: null }];
const form = (over: Record<string, string> = {}) => fd({ employeeId: EMP, compensationId: REC, requestKey: KEY, effectiveDate: "2025-03-01", basicSalary: "8000", allowances: JSON.stringify({ other: 500 }), reason: "Entered with the joining date", ...over });
const calls = () => rpc.mock.calls.filter((c) => c[0] === "correct_pay_record");
const applied = { status: "applied", impact: { payroll_runs: [], final_settlement: null, pending_changes: [] } };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: applied, error: null });
  revalidatePath.mockReset();
  recordRow = { id: REC, employee_id: EMP, effective_from: "2024-01-01", base_salary: "8000", allowances: { other: 500 } };
  employeeRow = { id: EMP, company_id: CO };
  recordError = null; grants = hr; signedIn = true;
});

describe("correctPayRecord", () => {
  it("sends only what changed, with the request key and the reason, to the one database function, and says the original is kept", async () => {
    const r = await correctPayRecord({ error: null }, form());
    expect(r.error).toBeNull();
    expect(r.saved).toMatchObject({ repeat: false, affects: [] });
    expect(r.saved!.message).toMatch(/original figures and dates stay/);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]![1]).toEqual({ p_compensation_id: REC, p_effective_from: "2025-03-01", p_basic: null, p_allowances: null, p_reason: "Entered with the joining date", p_request_key: KEY });
    expect(revalidatePath).toHaveBeenCalledWith(`/employees/${EMP}`);
  });

  it("sends the changed amount and allowances as they are", async () => {
    await correctPayRecord({ error: null }, form({ effectiveDate: "2024-01-01", basicSalary: "9000", allowances: JSON.stringify({ other: 700 }) }));
    expect(calls()[0]![1]).toMatchObject({ p_effective_from: null, p_basic: 9000, p_allowances: { other: 700 } });
  });

  it("Finance of the company may correct, the same permission as changing pay", async () => {
    grants = finance;
    expect((await correctPayRecord({ error: null }, form())).error).toBeNull();
    expect(calls()).toHaveLength(1);
  });

  it("refuses another company's HR Admin, a line manager and a signed-out visitor before asking the database", async () => {
    grants = [{ role: "hr_admin", companyId: "44444444-4444-4444-8444-444444444444", countryCode: null }];
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/not allowed to correct/);
    grants = [{ role: "line_manager", companyId: CO, countryCode: null }];
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/not allowed to correct/);
    signedIn = false;
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/Sign in/);
    expect(calls()).toHaveLength(0);
  });

  it("says in words, without calling the database, that nothing changed, the reason is too short or a field is missing", async () => {
    expect((await correctPayRecord({ error: null }, form({ effectiveDate: "2024-01-01" }))).error).toMatch(/Nothing changed/);
    expect((await correctPayRecord({ error: null }, form({ reason: "abc" }))).error).toMatch(/at least 5 characters/);
    expect((await correctPayRecord({ error: null }, form({ basicSalary: "0" }))).error).toMatch(/more than zero/);
    expect((await correctPayRecord({ error: null }, form({ allowances: "{not json" }))).error).toMatch(/allowances are not valid/);
    expect((await correctPayRecord({ error: null }, form({ allowances: JSON.stringify({ other: -1 }) }))).error).toMatch(/zero or more/);
    expect((await correctPayRecord({ error: null }, form({ compensationId: "nope" }))).error).toBeTruthy();
    expect((await correctPayRecord({ error: null }, form({ requestKey: "short" }))).error).toBeTruthy();
    expect(calls()).toHaveLength(0);
  });

  it("a record or employee that cannot be read is not corrected", async () => {
    recordRow = null;
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/cannot see/);
    recordRow = { id: REC, employee_id: EMP, effective_from: "2024-01-01", base_salary: "8000", allowances: { other: 500 } };
    recordError = { message: "down" };
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/Nothing was changed/);
    recordError = null; employeeRow = null;
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/cannot see/);
    expect(calls()).toHaveLength(0);
  });

  it("shows the database's own sentence for a refusal, never a raw error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "That date is before the pay record that starts on 2024-01-01, which would put the records out of order." } });
    expect((await correctPayRecord({ error: null }, form())).error).toMatch(/out of order/);
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: 'duplicate key value violates unique constraint "compensation_corrections_employee_id_request_key_key"' } });
    const r = await correctPayRecord({ error: null }, form());
    expect(r.error).toMatch(/Nothing was changed/);
    expect(r.error).not.toMatch(/duplicate key|constraint/);
    expect(r.saved).toBeUndefined();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for table compensation_corrections" } });
    expect((await correctPayRecord({ error: null }, form())).error).toBe("You are not allowed to correct this pay record.");
  });

  it("puts the payroll runs, final settlement and held change the database found into 'this correction affects' sentences", async () => {
    rpc.mockResolvedValue({
      data: {
        status: "applied",
        impact: {
          payroll_runs: [{ run_id: "r", period_month: 3, period_year: 2024, status: "approved", sent_at: "2024-04-02T09:00:00Z" }],
          final_settlement: { termination_date: "2025-06-30", reads_current_pay: true, statutory_rate_recorded: false },
          pending_changes: [],
        },
      },
      error: null,
    });
    const r = await correctPayRecord({ error: null }, form());
    expect(r.saved!.affects).toHaveLength(2);
    expect(r.saved!.affects[0]).toMatch(/March 2024/);
    expect(r.saved!.affects[1]).toMatch(/final settlement/);
  });

  it("a repeat of the same request is reported as already saved, not as a new correction", async () => {
    rpc.mockResolvedValue({ data: { ...applied, status: "already_applied" }, error: null });
    const r = await correctPayRecord({ error: null }, form());
    expect(r.saved).toMatchObject({ repeat: true });
    expect(r.saved!.message).toMatch(/already saved/);
  });
});
