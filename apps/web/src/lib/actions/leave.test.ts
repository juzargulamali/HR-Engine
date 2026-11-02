import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/email/leave-notifications", () => ({ notifyLeaveSubmitted: vi.fn() }));
vi.mock("./approvals", () => ({ resolveInitialApprover: vi.fn(async () => ({})) }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));

import { submitLeaveRequest } from "./leave";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const form = { leaveTypeCode: "annual", startDate: "2026-12-01", endDate: "2026-12-02" };

beforeEach(() => {
  tables = {
    employees: row({ id: "e1", company_id: "c1", country_code: "AE", manager_id: null, first_name: "A", last_name: "K" }),
    countries: row({ week_start_day: 1, working_weekdays: [1, 2, 3, 4, 5] }),
    policy_versions: rows([{ id: "v1", status: "active", effective_from: "2020-01-01", effective_to: null, version_no: 1, payload: null }]),
    policy_leave_types: rows([{ leave_type_code: "annual" }]),
    leave_requests: rows([]),
    public_holidays: rows([]),
  };
});

describe("submitLeaveRequest reads", () => {
  it("a failed policy read says it could not be checked, not that HR has not activated a policy", async () => {
    tables = { ...tables, policy_versions: failing() };
    const r = await submitLeaveRequest({ error: null }, fd(form));
    expect(r.error).toBe("Could not check your leave policy, try again.");
    expect(r.error).not.toMatch(/HR Admin/);
  });
  it("a successful read with no active policy still names HR", async () => {
    tables = { ...tables, policy_versions: rows([]) };
    expect((await submitLeaveRequest({ error: null }, fd(form))).error).toMatch(/ask HR Admin to activate one/);
  });
  it("a failed leave-type, overlap or holiday read stops the submit with a plain reason", async () => {
    tables = { ...tables, policy_leave_types: failing() };
    expect((await submitLeaveRequest({ error: null }, fd(form))).error).toMatch(/Could not check your leave policy/);
    tables = { ...tables, policy_leave_types: rows([{ leave_type_code: "annual" }]), leave_requests: failing() };
    expect((await submitLeaveRequest({ error: null }, fd(form))).error).toMatch(/Could not check your existing leave requests/);
    tables = { ...tables, leave_requests: rows([]), public_holidays: failing() };
    expect((await submitLeaveRequest({ error: null }, fd(form))).error).toMatch(/Could not check the public holidays/);
  });
  it("a failed employee read is not 'no employee record'", async () => {
    tables = { ...tables, employees: failing() };
    expect((await submitLeaveRequest({ error: null }, fd(form))).error).toMatch(/Could not check your employee record/);
  });
});
