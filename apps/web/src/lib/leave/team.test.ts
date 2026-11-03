import { describe, expect, it } from "vitest";
import { balancesText, buildTeamRows, teamScope, type TeamEmployee } from "./team";

const emp = (id: string, first: string, over: Partial<TeamEmployee> = {}): TeamEmployee => ({ id, first_name: first, last_name: "X", job_title: null, employment_status: "active", ...over });
const TODAY = "2026-11-03";

describe("the team leave rows", () => {
  const employees = [emp("a", "Amal"), emp("b", "Bilal"), emp("c", "Carla"), emp("t", "Gone", { employment_status: "terminated" })];
  const balances = [{ employee_id: "a", leave_type_code: "annual", balance_days: "12.5" }, { employee_id: "a", leave_type_code: "sick", balance_days: 4 }, { employee_id: "b", leave_type_code: "annual", balance_days: 3 }];
  const comp = [{ employee_id: "a", balance_days: 1 }];
  const requests = [
    { employee_id: "b", status: "pending_approval", start_date: "2026-11-20", end_date: "2026-11-22" },
    { employee_id: "b", status: "submitted", start_date: "2026-09-01", end_date: "2026-09-02" }, // old but still waiting
    { employee_id: "a", status: "approved", start_date: "2026-11-10", end_date: "2026-11-12" },
    { employee_id: "a", status: "approved", start_date: "2026-11-01", end_date: "2026-11-05" }, // away now
    { employee_id: "c", status: "approved", start_date: "2026-10-01", end_date: "2026-10-03" }, // already over
  ];
  const rows = buildTeamRows({ employees, balances, comp, requests }, TODAY);

  it("leaves out people who have left, and puts people with waiting requests first", () => {
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rows[0]!.pending).toEqual({ status: "ok", value: 2 });
  });
  it("shows the database's own balances, the Recovery Leave balance, and 'no figure' as nothing rather than zero", () => {
    const a = rows.find((r) => r.id === "a")!;
    expect(a.balances).toEqual({ status: "ok", value: [{ code: "annual", days: 12.5 }, { code: "sick", days: 4 }] });
    expect(a.recovery).toEqual({ status: "ok", value: 1 });
    expect(rows.find((r) => r.id === "b")!.recovery).toEqual({ status: "ok", value: null });
    expect(balancesText([{ code: "annual", days: 12.5 }, { code: "sick_leave", days: 4 }])).toBe("Annual 12.5 · Sick leave 4");
    expect(balancesText([])).toBe("—");
  });
  it("finds the next approved leave: today when away now, never a leave that is over", () => {
    expect(rows.find((r) => r.id === "a")!.nextLeave).toEqual({ status: "ok", value: TODAY });
    expect(rows.find((r) => r.id === "c")!.nextLeave).toEqual({ status: "ok", value: null });
    const later = buildTeamRows({ employees: [emp("a", "Amal")], balances: [], comp: [], requests: [requests[2]!] }, TODAY);
    expect(later[0]!.nextLeave).toEqual({ status: "ok", value: "2026-11-10" });
  });
  it("a source that could not be read is failed in its own column, not zero, and the others still show", () => {
    const r = buildTeamRows({ employees, balances: null, comp, requests: null }, TODAY);
    const a = r.find((x) => x.id === "a")!;
    expect(a.balances).toEqual({ status: "failed" });
    expect(a.pending).toEqual({ status: "failed" });
    expect(a.nextLeave).toEqual({ status: "failed" });
    expect(a.recovery).toEqual({ status: "ok", value: 1 });
  });
});

describe("whose leave the table asks for", () => {
  it("is whoever the database lets the viewer read, for everyone but a System Administrator", () => {
    expect(teamScope([])).toEqual({ mode: "rls" });
    expect(teamScope([{ role: "hr_admin", companyId: "c1" }, { role: "employee", companyId: null }])).toEqual({ mode: "rls" });
  });
  it("is the direct reports, and the companies where HR/Finance/CEO/CTO is also held, for a System Administrator (whose employee read is wider than their leave read)", () => {
    expect(teamScope([{ role: "sys_admin", companyId: null }])).toEqual({ mode: "reports" });
    expect(teamScope([{ role: "sys_admin", companyId: null }, { role: "finance", companyId: "c2" }, { role: "hr_admin", companyId: "c2" }])).toEqual({ mode: "companies", companyIds: ["c2"] });
    expect(teamScope([{ role: "sys_admin", companyId: null }, { role: "ceo", companyId: null }])).toEqual({ mode: "rls" });
  });
});
