import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadLeaveTeam } from "./team-data";

type Res = { data: unknown; error: unknown; count?: number | null };
/** A stand-in client: each table answers with what the test gives it; every filter chained on is recorded. */
function client(tables: Record<string, Res>, log: string[] = []) {
  const chain = (name: string): unknown => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: Res) => unknown) => Promise.resolve(tables[name] ?? { data: [], error: null }).then(resolve);
      return (...args: unknown[]) => { log.push(`${name}.${String(prop)}(${args.map(String).join(",")})`); return chain(name); };
    },
    apply: () => chain(name),
  });
  return { from: (n: string) => chain(n) } as never;
}
const people = [{ id: "a", first_name: "Amal", last_name: "X", job_title: null, employment_status: "active" }];

describe("loading the team leave", () => {
  it("asks only through the viewer's own session, never for themselves, and builds the rows", async () => {
    const log: string[] = [];
    const r = await loadLeaveTeam(client({ employees: { data: people, error: null, count: 1 }, leave_balances: { data: [{ employee_id: "a", leave_type_code: "annual", balance_days: 9 }], error: null }, comp_day_balances: { data: [], error: null }, leave_requests: { data: [], error: null } }, log), { employeeId: "me", grants: [] }, "2026-11-03");
    expect(r.failed).toBe(false);
    expect(r.rows.map((x) => x.name)).toEqual(["Amal X"]);
    expect(log).toContain("employees.neq(id,me)");
    expect(log.some((l) => l.startsWith("employees.eq(manager_id"))).toBe(false); // an ordinary scope: the database's rules decide
  });
  it("limits a System Administrator to their direct reports", async () => {
    const log: string[] = [];
    await loadLeaveTeam(client({ employees: { data: people, error: null, count: 1 } }, log), { employeeId: "me", grants: [{ role: "sys_admin", companyId: null }] }, "2026-11-03");
    expect(log).toContain("employees.eq(manager_id,me)");
  });
  it("a person who can read nobody else gets no rows (so no section)", async () => {
    const r = await loadLeaveTeam(client({ employees: { data: [], error: null, count: 0 } }), { employeeId: "me", grants: [] }, "2026-11-03");
    expect(r).toMatchObject({ failed: false, rows: [], total: 0 });
  });
  it("says the people could not be read, and a failed figure source only fails its own column", async () => {
    const down = await loadLeaveTeam(client({ employees: { data: null, error: { message: "down" } } }), { employeeId: "me", grants: [] }, "2026-11-03");
    expect(down.failed).toBe(true);
    const part = await loadLeaveTeam(client({ employees: { data: people, error: null, count: 1 }, leave_balances: { data: null, error: { message: "down" } }, comp_day_balances: { data: [], error: null }, leave_requests: { data: [], error: null } }), { employeeId: "me", grants: [] }, "2026-11-03");
    expect(part.rows[0]!.balances).toEqual({ status: "failed" });
    expect(part.rows[0]!.pending).toEqual({ status: "ok", value: 0 });
  });
  it("says when only the first part of a long list is shown", async () => {
    const r = await loadLeaveTeam(client({ employees: { data: people, error: null, count: 450 } }), { employeeId: "me", grants: [] }, "2026-11-03");
    expect(r.capped).toBe(true);
    expect(r.total).toBe(450);
  });
});
