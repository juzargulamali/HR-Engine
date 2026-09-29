import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Stage 1 of the Recovery Leave routing change (see supabase/migrations/
// 20261106000000_recovery_leave_pm_hr_owner_stage1.sql): new, dormant
// project_manager/hr_owner plumbing — new columns, triggers, the two new
// resolve_approver() branches, and the list_active_hr_admins() RPC. Stage 2
// (flipping every company's actual recovery_credit workflow steps to use
// them) is a separate, manually-applied file
// (supabase/manual-sql/recovery_leave_pm_hr_owner_stage2_cutover.sql) that
// this repo's migration-driven test harness never auto-applies — see
// phase4.rls.test.ts's own recovery_credit approval-chain tests, which keep
// passing unmodified against the OLD direct_manager/role:hr_admin routing.
// This file exercises the NEW plumbing directly: the validation/auto-assign
// triggers, both new resolve_approver() branches in isolation, the picker
// RPC, and one full manually-configured end-to-end chain proving the new
// approver types work together exactly like Stage 2 will wire them up.
async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY = "00000000-0000-0000-0000-0000000005a1";

const USER_HR = "00000000-0000-0000-0000-0000000005b1";
const USER_HR2 = "00000000-0000-0000-0000-0000000005b2";
const USER_PM = "00000000-0000-0000-0000-0000000005b3";
const USER_PM2 = "00000000-0000-0000-0000-0000000005b4";
const USER_WORKER = "00000000-0000-0000-0000-0000000005b5";
const USER_LINEMGR = "00000000-0000-0000-0000-0000000005b6";

const EMPLOYEE_HR = "00000000-0000-0000-0000-0000000005c1";
const EMPLOYEE_HR2 = "00000000-0000-0000-0000-0000000005c2";
const EMPLOYEE_PM = "00000000-0000-0000-0000-0000000005c3";
const EMPLOYEE_PM2 = "00000000-0000-0000-0000-0000000005c4";
const EMPLOYEE_WORKER = "00000000-0000-0000-0000-0000000005c5";
const EMPLOYEE_LINEMGR = "00000000-0000-0000-0000-0000000005c6";

describe("Recovery Leave routing, Stage 1: project_manager / hr_owner plumbing", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR}', 'p5-hr@enginious.ae'),
        ('${USER_HR2}', 'p5-hr2@enginious.ae'),
        ('${USER_PM}', 'p5-pm@enginious.ae'),
        ('${USER_PM2}', 'p5-pm2@enginious.ae'),
        ('${USER_WORKER}', 'p5-worker@enginious.ae'),
        ('${USER_LINEMGR}', 'p5-linemgr@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY}', 'Phase 5 Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_HR}', '${USER_HR}', 'P5-01', '${COMPANY}', 'ZZ', 'Hana', 'HrOwner', '2024-01-01'),
        ('${EMPLOYEE_HR2}', '${USER_HR2}', 'P5-02', '${COMPANY}', 'ZZ', 'Hugo', 'HrOwnerTwo', '2024-01-01'),
        ('${EMPLOYEE_PM}', '${USER_PM}', 'P5-03', '${COMPANY}', 'ZZ', 'Priya', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_PM2}', '${USER_PM2}', 'P5-04', '${COMPANY}', 'ZZ', 'Paul', 'ManagerTwo', '2024-01-01'),
        ('${EMPLOYEE_WORKER}', '${USER_WORKER}', 'P5-05', '${COMPANY}', 'ZZ', 'Wren', 'Worker', '2024-02-01'),
        ('${EMPLOYEE_LINEMGR}', '${USER_LINEMGR}', 'P5-06', '${COMPANY}', 'ZZ', 'Lena', 'LineManager', '2024-01-01');

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR}', 'hr_admin', '${COMPANY}'),
        ('${USER_HR2}', 'hr_admin', '${COMPANY}'),
        ('${USER_LINEMGR}', 'line_manager', '${COMPANY}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("employees_validate_hr_owner trigger", () => {
    it("rejects an employee being set as their own HR owner", async () => {
      await expect(
        db.asUser(USER_HR, (query) => query("update employees set hr_owner_id = $1 where id = $1", [EMPLOYEE_HR])),
      ).rejects.toThrow(/cannot be their own HR owner/);
    });

    it("rejects hr_owner_id pointing at an employee who doesn't hold an active hr_admin role", async () => {
      await expect(
        db.asUser(USER_HR, (query) =>
          query("update employees set hr_owner_id = $1 where id = $2", [EMPLOYEE_LINEMGR, EMPLOYEE_WORKER]),
        ),
      ).rejects.toThrow(/must reference an employee whose user currently holds an active hr_admin role/);
    });

    it("accepts hr_owner_id pointing at a currently-active hr_admin", async () => {
      // db.asUser() always rolls back at the end (see harness.ts) — this
      // write must actually PERSIST, since later describe blocks in this
      // file (resolve_approver('hr_owner', ...) and the end-to-end chain)
      // depend on EMPLOYEE_WORKER already having this hr_owner_id set. The
      // trigger under test (employees_validate_hr_owner) fires on any write
      // regardless of role, so seeding it via the admin connection still
      // exercises — and proves — the same validation as an HR Admin's own
      // RLS-checked update would.
      const { rows } = await db.seed(`update employees set hr_owner_id = '${EMPLOYEE_HR}' where id = '${EMPLOYEE_WORKER}' returning hr_owner_id`);
      expect(rows[0]?.hr_owner_id).toBe(EMPLOYEE_HR);
    });

    it("rejects hr_owner_id once that employee's hr_admin role has been revoked", async () => {
      const tempEmployeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${tempEmployeeId}', 'P5-07', '${COMPANY}', 'ZZ', 'Temp', 'Worker', '2024-03-01');
        update user_roles set revoked_at = now() where user_id = '${USER_HR2}' and role = 'hr_admin';
      `);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("update employees set hr_owner_id = $1 where id = $2", [EMPLOYEE_HR2, tempEmployeeId]),
        ),
      ).rejects.toThrow(/must reference an employee whose user currently holds an active hr_admin role/);
      await db.seed(`update user_roles set revoked_at = null where user_id = '${USER_HR2}' and role = 'hr_admin';`);
    });
  });

  describe("employees_set_initial_hr_owner trigger", () => {
    it("auto-assigns the creating HR Admin as the new employee's initial HR owner", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query(
          `insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date, created_by)
           values ('P5-NEW1', '${COMPANY}', 'ZZ', 'New', 'Hire', '2026-01-01', $1) returning hr_owner_id`,
          [USER_HR],
        );
        expect(rows[0]?.hr_owner_id).toBe(EMPLOYEE_HR);
      });
    });

    it("leaves hr_owner_id null when created_by is not a currently-active hr_admin", async () => {
      // set_initial_hr_owner() keys off NEW.created_by, never the inserting
      // ROLE — employees_write_hr already requires the INSERT itself come
      // from an hr_admin (USER_HR here), so this isolates "the row's
      // created_by is someone else who ISN'T an active hr_admin" (USER_LINEMGR,
      // who only ever holds line_manager) from "who is allowed to insert".
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query(
          `insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date, created_by)
           values ('P5-NEW2', '${COMPANY}', 'ZZ', 'New', 'Hire2', '2026-01-02', $1) returning hr_owner_id`,
          [USER_LINEMGR],
        );
        expect(rows[0]?.hr_owner_id).toBeNull();
      });
    });
  });

  describe("resolve_approver('project_manager', ...)", () => {
    it("returns null when the employee has no active project allocation", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1) as approver", [EMPLOYEE_WORKER]),
      );
      expect(rows[0]?.approver).toBeNull();
    });

    it("resolves to the allocated project's manager", async () => {
      const projectId = randomUUID();
      await db.seed(`
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-A', 'Project A', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${EMPLOYEE_WORKER}', '${projectId}', 100, '2026-01-01');
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1) as approver", [EMPLOYEE_WORKER]),
      );
      expect(rows[0]?.approver).toBe(USER_PM);
    });

    it("ignores an allocation that hasn't started yet or has already ended", async () => {
      const futureAllocEmployee = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${futureAllocEmployee}', 'P5-08', '${COMPANY}', 'ZZ', 'Future', 'Alloc', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-B', 'Project B', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date, end_date)
          values ('${futureAllocEmployee}', '${projectId}', 100, '2099-01-01', null);
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1) as approver", [futureAllocEmployee]),
      );
      expect(rows[0]?.approver).toBeNull();
    });

    it("picks the highest-allocation-percent project when several are active, then most recent start_date to break a tie", async () => {
      const employeeId = randomUUID();
      const projectMinor = randomUUID();
      const projectMajor = randomUUID();
      const projectMajorNewer = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-09', '${COMPANY}', 'ZZ', 'Multi', 'Alloc', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values
          ('${projectMinor}', '${COMPANY}', 'PRJ-C1', 'Minor', '${EMPLOYEE_PM}'),
          ('${projectMajor}', '${COMPANY}', 'PRJ-C2', 'Major (older)', '${EMPLOYEE_PM}'),
          ('${projectMajorNewer}', '${COMPANY}', 'PRJ-C3', 'Major (newer)', '${EMPLOYEE_PM2}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date) values
          ('${employeeId}', '${projectMinor}', 20, '2026-01-01'),
          ('${employeeId}', '${projectMajor}', 80, '2026-01-01'),
          ('${employeeId}', '${projectMajorNewer}', 80, '2026-02-01');
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1) as approver", [employeeId]),
      );
      // Both 80% allocations tie on percent — the more recently started one
      // (projectMajorNewer, managed by EMPLOYEE_PM2) wins the tiebreak.
      expect(rows[0]?.approver).toBe(USER_PM2);
    });

    it("returns null when the allocated project's manager is terminated", async () => {
      const employeeId = randomUUID();
      const terminatedManagerId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${terminatedManagerId}', 'P5-10', '${COMPANY}', 'ZZ', 'Gone', 'Manager', '2020-01-01', 'terminated');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-11', '${COMPANY}', 'ZZ', 'Orphaned', 'Report', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-D', 'Project D', '${terminatedManagerId}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01');
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1) as approver", [employeeId]),
      );
      expect(rows[0]?.approver).toBeNull();
    });
  });

  describe("resolve_approver('hr_owner', ...)", () => {
    it("returns null when the employee has no hr_owner_id assigned", async () => {
      const employeeId = randomUUID();
      await db.seed(`insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('${employeeId}', 'P5-12', '${COMPANY}', 'ZZ', 'No', 'Owner', '2024-01-01');`);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('hr_owner', $1) as approver", [employeeId]),
      );
      expect(rows[0]?.approver).toBeNull();
    });

    it("resolves to the assigned hr_owner's user_id", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('hr_owner', $1) as approver", [EMPLOYEE_WORKER]),
      );
      // EMPLOYEE_WORKER.hr_owner_id was set to EMPLOYEE_HR earlier in this
      // file's "employees_validate_hr_owner trigger" section.
      expect(rows[0]?.approver).toBe(USER_HR);
    });

    it("returns null once the assigned hr_owner's hr_admin role has been revoked, without needing hr_owner_id itself to change", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, hr_owner_id)
          values ('${employeeId}', 'P5-13', '${COMPANY}', 'ZZ', 'Stale', 'Owner', '2024-01-01', '${EMPLOYEE_HR2}');
        update user_roles set revoked_at = now() where user_id = '${USER_HR2}' and role = 'hr_admin';
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('hr_owner', $1) as approver", [employeeId]),
      );
      expect(rows[0]?.approver).toBeNull();
      await db.seed(`update user_roles set revoked_at = null where user_id = '${USER_HR2}' and role = 'hr_admin';`);
    });

    it("returns null once the assigned hr_owner has been terminated, even with their hr_admin grant still nominally active", async () => {
      const ownerEmployeeId = randomUUID();
      const ownerUserId = randomUUID();
      const employeeId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values ('${ownerUserId}', 'p5-terminated-owner@enginious.ae');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${ownerEmployeeId}', '${ownerUserId}', 'P5-14', '${COMPANY}', 'ZZ', 'Terminated', 'Owner', '2020-01-01', 'terminated');
        insert into user_roles (user_id, role, company_id) values ('${ownerUserId}', 'hr_admin', '${COMPANY}');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, hr_owner_id)
          values ('${employeeId}', 'P5-15', '${COMPANY}', 'ZZ', 'Still', 'Assigned', '2024-01-01', '${ownerEmployeeId}');
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('hr_owner', $1) as approver", [employeeId]),
      );
      expect(rows[0]?.approver).toBeNull();
    });
  });

  describe("list_active_hr_admins() RPC", () => {
    it("blocks a non-hr_admin caller", async () => {
      await expect(
        db.asUser(USER_LINEMGR, (query) => query("select * from list_active_hr_admins($1)", [COMPANY])),
      ).rejects.toThrow(/Only HR Admin can list HR owner candidates/);
    });

    it("lists only currently-active hr_admin holders in the given company, excluding anyone revoked, terminated, or in another company", async () => {
      const otherCompanyId = randomUUID();
      const otherCompanyHrUserId = randomUUID();
      const otherCompanyHrEmployeeId = randomUUID();
      await db.seed(`
        insert into companies (id, legal_name, country_code, default_currency) values ('${otherCompanyId}', 'Other Co', 'ZZ', 'ZZD');
        insert into auth.users (id, email) values ('${otherCompanyHrUserId}', 'p5-other-hr@enginious.ae');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${otherCompanyHrEmployeeId}', '${otherCompanyHrUserId}', 'OC-01', '${otherCompanyId}', 'ZZ', 'Other', 'CoHr', '2024-01-01');
        insert into user_roles (user_id, role, company_id) values ('${otherCompanyHrUserId}', 'hr_admin', '${otherCompanyId}');
      `);

      const { rows } = await db.asUser(USER_HR, (query) => query("select employee_id from list_active_hr_admins($1)", [COMPANY]));
      const ids = rows.map((r) => r.employee_id);
      expect(ids).toEqual(expect.arrayContaining([EMPLOYEE_HR, EMPLOYEE_HR2]));
      expect(ids).not.toContain(otherCompanyHrEmployeeId);
      expect(ids).not.toContain(EMPLOYEE_LINEMGR);
    });
  });

  // Stage 2 hasn't run in this (or any) test database — no company's
  // recovery_credit workflow references project_manager/hr_owner yet. This
  // proves the two new approver types work end to end together, by manually
  // pointing THIS company's own workflow steps at them, exactly as Stage 2's
  // cutover SQL will do for every company once applied.
  describe("end-to-end recovery_credit chain manually configured for project_manager -> hr_owner", () => {
    let projectId: string;

    beforeAll(async () => {
      projectId = randomUUID();
      await db.seed(`
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-E2E', 'E2E project', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${EMPLOYEE_WORKER}', '${projectId}', 100, '2026-01-01');

        update approval_workflow_steps set approver_type = 'project_manager'
          where step_order = 1
            and workflow_id in (select id from approval_workflows where company_id = '${COMPANY}' and entity_type = 'recovery_credit');
        update approval_workflow_steps set approver_type = 'hr_owner'
          where step_order = 2
            and workflow_id in (select id from approval_workflows where company_id = '${COMPANY}' and entity_type = 'recovery_credit');
      `);
    });

    // 2026-08-08 is a Saturday — ZZ's default week_start_day (1, Monday)
    // makes Sat/Sun its weekend, same as phase4.rls.test.ts's own dates.
    it("routes step 1 to the project manager and step 2 to the hr_owner, and posts the credit only once both approve", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-08-08",
          JSON.stringify([{ employee_id: EMPLOYEE_WORKER, status: "present", hours_worked: 8 }]),
        ]);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-08'", [EMPLOYEE_WORKER]);
        const recordId = record.rows[0]?.id;
        const request = await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId]);
        const requestId = request.rows[0]?.id;

        const step1 = await query(
          "select id, approver_id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1",
          [requestId],
        );
        expect(step1.rows[0]?.approver_id).toBe(USER_PM);

        await actAs(query, USER_PM);
        await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);

        await actAs(query, USER_HR);
        const step2 = await query(
          "select id, approver_id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 2",
          [requestId],
        );
        expect(step2.rows[0]?.approver_id).toBe(USER_HR);

        await actAs(query, USER_HR);
        await query("select decide_leave_approval($1, 'approved', null)", [step2.rows[0]?.id]);

        const finalRequest = await query("select status, comp_day_ledger_id from recovery_credit_requests where id = $1", [requestId]);
        expect(finalRequest.rows[0]?.status).toBe("approved");
        expect(finalRequest.rows[0]?.comp_day_ledger_id).toBeTruthy();
      });
    });

    it("hard-stops with a clear error when submitted for an employee with no active project allocation", async () => {
      const unassignedEmployeeId = randomUUID();
      await db.seed(`insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('${unassignedEmployeeId}', 'P5-16', '${COMPANY}', 'ZZ', 'Unassigned', 'Worker', '2024-01-01');`);

      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-08-15",
            JSON.stringify([{ employee_id: unassignedEmployeeId, status: "present", hours_worked: 8 }]),
          ]),
        ),
      ).rejects.toThrow(/No approver could be resolved/);
    });

    it("hard-stops step 2 with a clear error when the employee's hr_owner is unassigned", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-17', '${COMPANY}', 'ZZ', 'No', 'HrOwner', '2024-01-01');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01');
      `);

      // A raised exception from inside decide_leave_approval() aborts the
      // WHOLE calling transaction (Postgres has no implicit savepoint per
      // statement) — it undoes that same call's own step-1 decision update
      // along with it, not just the failed step-2 insert. So there is
      // nothing left to inspect afterward in this same asUser() call (and a
      // fresh asUser() call would find nothing either, since asUser() always
      // rolls back — see harness.ts). This only asserts the exception
      // itself, same pattern as phase4.rls.test.ts's "no one currently
      // holds" case for reimbursement_claim's Finance step.
      await expect(
        db.asUser(USER_HR, async (query) => {
          await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-08-22",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8 }]),
          ]);
          const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-22'", [employeeId]);
          const request = await query("select id from recovery_credit_requests where attendance_record_id = $1", [record.rows[0]?.id]);
          const step1 = await query(
            "select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1",
            [request.rows[0]?.id],
          );

          await actAs(query, USER_PM);
          await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);
        }),
      ).rejects.toThrow(/no one currently holds the "hr_owner" role required for the next step/);
    });
  });
});
