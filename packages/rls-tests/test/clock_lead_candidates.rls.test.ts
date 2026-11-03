import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A14 / D-13. "Site work" on the attendance clock needs a project lead, but the picker was filled by reading `employees` through the person's own session, and
// employees_select lets an ordinary employee read only their own row (plus reports, for a manager): their list held only themselves. attendance_lead_candidates()
// returns just an id and a display name for the active people of the caller's own company. It adds no read of employees: attendance rules, the database's own
// check of the lead (same company, active), and calculations are untouched.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { emp: id(), peer: id(), lead: id(), terminated: id(), other: id(), noRecord: id(), mgr: id() };
const E = { emp: id(), peer: id(), lead: id(), terminated: id(), other: id(), mgr: id() };
const SITE_LOCATION = JSON.stringify({ permission_status: "denied" });

describe("Attendance clock: project-lead picker (A14)", () => {
  const db = new RlsTestDatabase();
  const as = <T = Record<string, any>>(user: string, sql: string, params: unknown[] = []) => db.asUser(user, async (q) => (await q(sql, params)).rows as T[]); // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Enginious UAE', 'AE', 'AED'), ('${CO.b}', 'Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@lead.ae')`).join(", ")};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.emp}', '${U.emp}', 'C-1', '${CO.a}', 'AE', 'Erin', 'Employee', '2024-01-01'),
        ('${E.peer}', '${U.peer}', 'C-2', '${CO.a}', 'AE', 'Pia', 'Peer', '2024-01-01'),
        ('${E.lead}', '${U.lead}', 'C-3', '${CO.a}', 'AE', 'Leo', 'Lead', '2024-01-01'),
        ('${E.terminated}', null, 'C-4', '${CO.a}', 'AE', 'Tara', 'Terminated', '2024-01-01'),
        ('${E.other}', '${U.other}', 'C-5', '${CO.b}', 'AE', 'Olga', 'Other', '2024-01-01'),
        ('${E.mgr}', '${U.mgr}', 'C-6', '${CO.a}', 'AE', 'Mona', 'Manager', '2024-01-01');
      update employees set employment_status = 'terminated' where id = '${E.terminated}';
    `);
  }, 60_000);
  afterAll(async () => db.teardown());

  const old = (user: string) => as<{ id: string }>(user, `select id from employees where company_id = '${CO.a}' and employment_status = 'active' and deleted_at is null`);

  it("REPRODUCED: the old picker source (employees read through the person's own session) holds only the person themself", async () => {
    expect((await old(U.emp)).map((r) => r.id)).toEqual([E.emp]);
  });

  it("a plain employee sees the active people of their own company by display name, and nobody else", async () => {
    const rows = await as<{ employee_id: string; display_name: string }>(U.emp, "select * from attendance_lead_candidates()");
    expect(rows.map((r) => r.employee_id).sort()).toEqual([E.emp, E.peer, E.lead, E.mgr].sort());
    expect(rows.find((r) => r.employee_id === E.lead)!.display_name).toBe("Leo Lead");
    expect(rows.map((r) => r.employee_id)).not.toContain(E.terminated); // not active
    expect(rows.map((r) => r.employee_id)).not.toContain(E.other); // another company
  });

  it("returns only an id and a display name: no other column leaves the function", async () => {
    const rows = await as(U.emp, "select * from attendance_lead_candidates()");
    expect(Object.keys(rows[0]!).sort()).toEqual(["display_name", "employee_id"]);
  });

  it("a person of another company sees their own company only; a person with no employee record gets nothing", async () => {
    expect((await as<{ employee_id: string }>(U.other, "select employee_id from attendance_lead_candidates()")).map((r) => r.employee_id)).toEqual([E.other]);
    expect(await as(U.noRecord, "select * from attendance_lead_candidates()")).toEqual([]);
  });

  it("an anonymous caller is refused", async () => {
    await expect(db.asUser(null, async (q) => q("select * from attendance_lead_candidates()"))).rejects.toThrow(/permission denied/);
  });

  it("the employee STILL cannot read any other employee row or column (nothing was widened)", async () => {
    expect((await as(U.emp, "select id from employees")).map((r) => r.id)).toEqual([E.emp]);
    expect(await as(U.emp, `select id from employees where id = '${E.lead}'`)).toEqual([]);
  });

  it("the database still rejects an ineligible lead on clock-in (other company, not active) and accepts a listed colleague", async () => {
    await expect(db.asUserCommit(U.emp, async (q) => q("select clock_in('site_work', 'Project X', $1, $2::jsonb)", [E.other, SITE_LOCATION]))).rejects.toThrow(/must be an employee of your own company/);
    await expect(db.asUserCommit(U.emp, async (q) => q("select clock_in('site_work', 'Project X', $1, $2::jsonb)", [E.terminated, SITE_LOCATION]))).rejects.toThrow(/currently active employee/);
    const session = await db.asUserCommit(U.emp, async (q) => (await q("select clock_in('site_work', 'Project X', $1, $2::jsonb) as id", [E.lead, SITE_LOCATION])).rows[0].id as string);
    expect(session).toBeTruthy();
    const seg = await db.seed(`select project_lead_employee_id from attendance_segments where session_id = '${session}'`);
    expect(seg.rows).toEqual([{ project_lead_employee_id: E.lead }]);
  });
});
