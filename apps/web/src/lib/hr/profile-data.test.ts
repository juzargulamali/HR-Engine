import { describe, expect, it } from "vitest";
import { countOrNull, documentExpiryCounts, loadProfileSetup, type HrReadClient, type ProfileEmployee, type ProfileViewer } from "./profile-data";

type Result = { count?: number | null; data?: Record<string, unknown>[] | null; error?: unknown };

/** A query builder that records its table and filters and answers from `answers[table]`; any filter or terminal call returns the same thenable. */
function client(answers: Record<string, Result>, calls: { table: string; filters: string[] }[] = []): HrReadClient {
  return {
    from(table: string) {
      const rec = { table, filters: [] as string[] };
      calls.push(rec);
      const q: Record<string, unknown> = {
        eq: (c: string, v: unknown) => { rec.filters.push(`${c}=${String(v)}`); return q; },
        is: (c: string) => { rec.filters.push(`${c} is null`); return q; },
        then: (ok: (v: unknown) => unknown) => ok({ count: null, data: null, error: null, ...(answers[table] ?? {}) }),
      };
      return { select: () => q as never };
    },
  };
}

const employee: ProfileEmployee = { id: "e1", country_code: "AE", employment_status: "active", deleted_at: null, user_id: null, job_title: "Technician", manager_id: "m1" };
const hr: ProfileViewer = { canEditCore: true, canSeeContracts: true, canSeeComp: true, canSeeIdentity: true, canSeeDocuments: true, canSeeCareerEvents: true, canInvite: false, canOpenAccess: true };
const none: Result = { count: 0, data: [] };

describe("countOrNull / documentExpiryCounts", () => {
  it("a failed read is null, never zero", () => {
    expect(countOrNull({ count: 3, error: null })).toBe(3);
    expect(countOrNull({ count: null, error: null })).toBeNull();
    expect(countOrNull({ count: 0, error: { message: "denied" } })).toBeNull();
  });
  it("counts expired and expiring from dates; a document with no date or a valid one is not flagged; the job's status counts too", () => {
    const c = documentExpiryCounts([{ expiry_date: "2026-01-01" }, { expiry_date: "2026-12-01" }, { expiry_date: "2028-01-01" }, { expiry_date: null }, { expiry_date: "2028-01-01", status: "expired" }], "2026-11-16");
    expect(c).toEqual({ expired: 2, expiring: 1 });
  });
});

describe("loadProfileSetup", () => {
  it("reads employee-scoped records only and derives every step as to do for a fresh employee", async () => {
    const calls: { table: string; filters: string[] }[] = [];
    const r = await loadProfileSetup(client({ employment_contracts: none, compensation_details: none, identity_documents: none, employee_documents: none, leave_ledger: none, comp_day_ledger: none, employee_career_events: none }, calls), employee, hr, { managerNotExpected: false });
    expect(r.steps.map((s) => [s.key, s.status])).toEqual([["contract", "todo"], ["compensation", "todo"], ["documents", "todo"], ["opening_balances", "optional"], ["account", "todo"]]);
    expect(calls.every((c) => c.filters.includes("employee_id=e1"))).toBe(true);
    expect(calls.find((c) => c.table === "leave_ledger")!.filters).toContain("reference_type=opening_balance");
    expect(calls.find((c) => c.table === "comp_day_ledger")!.filters).toContain("source=opening_balance");
    expect(calls.find((c) => c.table === "employee_documents")!.filters).toContain("deleted_at is null");
    expect(r.exceptions.map((x) => x.key)).toEqual(["setup"]);
  });
  it("turns steps Done from existing records and flags expired documents and scheduled changes", async () => {
    const r = await loadProfileSetup(
      client({
        employment_contracts: { count: 1 }, compensation_details: { count: 2 },
        identity_documents: { count: 1, data: [{ expiry_date: "2001-01-01" }] }, employee_documents: { count: 0, data: [] },
        leave_ledger: { count: 1 }, comp_day_ledger: { count: 0 }, employee_career_events: { count: 1 },
      }),
      { ...employee, user_id: "u1" }, hr, { managerNotExpected: false },
    );
    expect(r.steps.every((s) => s.status === "done")).toBe(true);
    expect(r.exceptions.map((x) => x.key)).toEqual(["expired", "scheduled"]);
  });
  it("hides what the viewer cannot see: a manager gets no setup list and no 'fill in' prompts", async () => {
    const manager: ProfileViewer = { canEditCore: false, canSeeContracts: true, canSeeComp: false, canSeeIdentity: false, canSeeDocuments: false, canSeeCareerEvents: false, canInvite: false, canOpenAccess: false };
    const r = await loadProfileSetup(client({}), { ...employee, manager_id: null, job_title: null }, manager, { managerNotExpected: false });
    expect(r.steps).toEqual([]);
    expect(r.exceptions).toEqual([]);
  });
  it("a read that fails hides its step instead of calling it to do; before the migration the scheduled-change flag is simply absent", async () => {
    const r = await loadProfileSetup(client({ employment_contracts: { count: null, error: "boom" }, compensation_details: none, identity_documents: none, employee_documents: none, leave_ledger: none, comp_day_ledger: none, employee_career_events: { count: null, error: { message: "column applied_at does not exist" } } }), employee, hr, { managerNotExpected: false });
    expect(r.steps.map((s) => s.key)).not.toContain("contract");
    expect(r.steps.map((s) => s.key)).toContain("compensation");
    expect(r.exceptions.some((x) => x.key === "scheduled")).toBe(false);
  });
  it("is Not applicable for someone who has left or was removed, and raises no flags", async () => {
    const r = await loadProfileSetup(client({ employment_contracts: none, compensation_details: none, identity_documents: none, employee_documents: none, leave_ledger: none, comp_day_ledger: none, employee_career_events: none }), { ...employee, employment_status: "terminated" }, hr, { managerNotExpected: false });
    expect(r.steps.every((s) => s.status === "not_applicable")).toBe(true);
    expect(r.exceptions).toEqual([]);
  });
});
