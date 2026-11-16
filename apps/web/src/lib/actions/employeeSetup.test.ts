import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = { userId: "u-hr", grants: [{ role: "hr_admin", companyId: "c1", countryCode: null }] as unknown[] };
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => session }));

type Resp = { count?: number | null; error?: { code?: string; message: string } | null; data?: unknown };
const state: { employee: Resp; leaveCount: Resp; compCount: Resp; leaveInsert: Resp; compInsert: Resp; inserts: { table: string; row: Record<string, unknown> }[] } = {
  employee: {}, leaveCount: {}, compCount: {}, leaveInsert: {}, compInsert: {}, inserts: [],
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      return {
        select(_c: string, o?: { head?: boolean }) {
          const q = { eq: () => q, maybeSingle: async () => state.employee, then: (ok: (v: unknown) => unknown) => ok(o?.head ? (table === "leave_ledger" ? state.leaveCount : state.compCount) : {}) };
          return q;
        },
        insert: async (row: Record<string, unknown>) => { state.inserts.push({ table, row }); return table === "leave_ledger" ? state.leaveInsert : state.compInsert; },
      };
    },
  }),
}));

import { recordOpeningBalances } from "./employeeSetup";

const E = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => { const f = new FormData(); f.append("employeeId", E); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeEach(() => {
  session.grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
  state.employee = { data: { id: E, company_id: "c1", hire_date: "2026-05-01", deleted_at: null }, error: null };
  state.leaveCount = { count: 0, error: null }; state.compCount = { count: 0, error: null };
  state.leaveInsert = { error: null }; state.compInsert = { error: null }; state.inserts = [];
});

describe("recordOpeningBalances", () => {
  it("records annual leave and comp days once, tagged as opening balances and dated the hire date", async () => {
    const r = await recordOpeningBalances({ error: null }, fd({ openingAnnualLeaveDays: "12", openingCompDays: "2" }));
    expect(r).toEqual({ error: null, warning: null });
    expect(state.inserts).toEqual([
      { table: "leave_ledger", row: expect.objectContaining({ employee_id: E, leave_type_code: "annual", txn_date: "2026-05-01", entry_type: "adjustment", amount_days: 12, reference_type: "opening_balance", created_by: "u-hr" }) },
      { table: "comp_day_ledger", row: expect.objectContaining({ employee_id: E, txn_date: "2026-05-01", entry_type: "earned", days: 2, source: "opening_balance" }) },
    ]);
  });
  it("refuses a repeat: opening balances already on the ledger are never added again", async () => {
    state.leaveCount = { count: 1, error: null }; state.compCount = { count: 1, error: null };
    const r = await recordOpeningBalances({ error: null }, fd({ openingAnnualLeaveDays: "12", openingCompDays: "2" }));
    expect(r.error).toBe("Opening balances were already recorded for this employee.");
    expect(state.inserts).toEqual([]);
  });
  it("adds only the kind that is missing and says what was not repeated", async () => {
    state.leaveCount = { count: 1, error: null };
    const r = await recordOpeningBalances({ error: null }, fd({ openingAnnualLeaveDays: "12", openingCompDays: "2" }));
    expect(r.error).toBeNull();
    expect(r.warning).toMatch(/annual leave was already recorded and not added again/);
    expect(state.inserts.map((i) => i.table)).toEqual(["comp_day_ledger"]);
  });
  it("treats the database's duplicate refusal (a concurrent second click) as already recorded", async () => {
    state.leaveInsert = { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    const r = await recordOpeningBalances({ error: null }, fd({ openingAnnualLeaveDays: "12" }));
    expect(r.error).toBe("Opening balances were already recorded for this employee.");
  });
  it("says exactly what saved when the second write fails", async () => {
    state.compInsert = { error: { message: "permission denied" } };
    const r = await recordOpeningBalances({ error: null }, fd({ openingAnnualLeaveDays: "12", openingCompDays: "2" }));
    expect(r.error).toBeNull();
    expect(r.warning).toMatch(/Annual leave was saved, but the comp days were not \(permission denied\)/);
  });
  it("writes nothing when the first write fails", async () => {
    state.leaveInsert = { error: { message: "denied" } };
    const r = await recordOpeningBalances({ error: null }, fd({ openingAnnualLeaveDays: "12", openingCompDays: "2" }));
    expect(r.error).toMatch(/Nothing was saved/);
    expect(state.inserts.map((i) => i.table)).toEqual(["leave_ledger"]);
  });
  it("needs a balance, a signed-in HR Admin of the employee's company, and a readable check", async () => {
    expect((await recordOpeningBalances({ error: null }, fd({}))).error).toMatch(/Enter annual leave days/);
    session.grants = [{ role: "hr_admin", companyId: "other", countryCode: null }];
    expect((await recordOpeningBalances({ error: null }, fd({ openingCompDays: "1" }))).error).toMatch(/Only an HR Admin/);
    session.grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
    state.leaveCount = { count: null, error: { message: "boom" } };
    expect((await recordOpeningBalances({ error: null }, fd({ openingCompDays: "1" }))).error).toMatch(/Nothing was saved/);
    expect(state.inserts).toEqual([]);
  });
});
