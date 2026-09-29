import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Stage 1 of the Recovery Leave routing change (see supabase/migrations/
// 20261106000000_recovery_leave_pm_hr_owner_stage1.sql): the new
// project_manager/hr_owner plumbing, PLUS the live, required project
// selection on every recovery-day request (record_attendance_and_recovery()/
// record_overnight_recovery_credit()). Stage 2 (versioning each company's
// recovery_credit workflow onto the new approver types) is a separate,
// manually-applied file (supabase/manual-sql/
// recovery_leave_pm_hr_owner_stage2_cutover.sql) that this repo's
// migration-driven test harness never auto-applies — see phase4.rls.test.ts's
// own recovery_credit approval-chain tests, which keep passing unmodified
// against the OLD direct_manager/role:hr_admin routing (now updated there to
// also pass a project, since THAT part is live regardless of routing).
async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY = "00000000-0000-0000-0000-0000000005a1";
const OTHER_COMPANY = "00000000-0000-0000-0000-0000000005a2";

const USER_HR = "00000000-0000-0000-0000-0000000005b1";
const USER_HR2 = "00000000-0000-0000-0000-0000000005b2";
const USER_PM = "00000000-0000-0000-0000-0000000005b3";
const USER_PM2 = "00000000-0000-0000-0000-0000000005b4";
const USER_WORKER = "00000000-0000-0000-0000-0000000005b5";
const USER_LINEMGR = "00000000-0000-0000-0000-0000000005b6";
const USER_HR_OTHER = "00000000-0000-0000-0000-0000000005b7";

const EMPLOYEE_HR = "00000000-0000-0000-0000-0000000005c1";
const EMPLOYEE_HR2 = "00000000-0000-0000-0000-0000000005c2";
const EMPLOYEE_PM = "00000000-0000-0000-0000-0000000005c3";
const EMPLOYEE_PM2 = "00000000-0000-0000-0000-0000000005c4";
const EMPLOYEE_WORKER = "00000000-0000-0000-0000-0000000005c5";
const EMPLOYEE_LINEMGR = "00000000-0000-0000-0000-0000000005c6";
const EMPLOYEE_HR_OTHER = "00000000-0000-0000-0000-0000000005c7";

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
        ('${USER_LINEMGR}', 'p5-linemgr@enginious.ae'),
        ('${USER_HR_OTHER}', 'p5-hr-other@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY}', 'Phase 5 Co', 'ZZ', 'ZZD'),
        ('${OTHER_COMPANY}', 'Phase 5 Other Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_HR}', '${USER_HR}', 'P5-01', '${COMPANY}', 'ZZ', 'Hana', 'HrOwner', '2024-01-01'),
        ('${EMPLOYEE_HR2}', '${USER_HR2}', 'P5-02', '${COMPANY}', 'ZZ', 'Hugo', 'HrOwnerTwo', '2024-01-01'),
        ('${EMPLOYEE_PM}', '${USER_PM}', 'P5-03', '${COMPANY}', 'ZZ', 'Priya', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_PM2}', '${USER_PM2}', 'P5-04', '${COMPANY}', 'ZZ', 'Paul', 'ManagerTwo', '2024-01-01'),
        ('${EMPLOYEE_WORKER}', '${USER_WORKER}', 'P5-05', '${COMPANY}', 'ZZ', 'Wren', 'Worker', '2024-02-01'),
        ('${EMPLOYEE_LINEMGR}', '${USER_LINEMGR}', 'P5-06', '${COMPANY}', 'ZZ', 'Lena', 'LineManager', '2024-01-01'),
        ('${EMPLOYEE_HR_OTHER}', '${USER_HR_OTHER}', 'OC-01', '${OTHER_COMPANY}', 'ZZ', 'Odette', 'OtherCoHr', '2024-01-01');

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR}', 'hr_admin', '${COMPANY}'),
        ('${USER_HR2}', 'hr_admin', '${COMPANY}'),
        ('${USER_LINEMGR}', 'line_manager', '${COMPANY}'),
        ('${USER_HR_OTHER}', 'hr_admin', '${OTHER_COMPANY}');
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

    it("rejects hr_owner_id pointing at an hr_admin employed by a DIFFERENT company", async () => {
      await expect(
        db.asUser(USER_HR, (query) =>
          query("update employees set hr_owner_id = $1 where id = $2", [EMPLOYEE_HR_OTHER, EMPLOYEE_WORKER]),
        ),
      ).rejects.toThrow(/must belong to the same company as the employee being assigned an HR owner/);
    });

    it("rejects hr_owner_id once that employee's hr_admin grant is scoped to a DIFFERENT company only", async () => {
      const employeeId = randomUUID();
      const scopedUserId = randomUUID();
      const scopedEmployeeId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values ('${scopedUserId}', 'p5-scoped-hr@enginious.ae');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${scopedEmployeeId}', '${scopedUserId}', 'P5-18', '${COMPANY}', 'ZZ', 'Scoped', 'Hr', '2024-01-01');
        -- Same-company EMPLOYEE row, but the hr_admin GRANT itself only applies to OTHER_COMPANY.
        insert into user_roles (user_id, role, company_id) values ('${scopedUserId}', 'hr_admin', '${OTHER_COMPANY}');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-19', '${COMPANY}', 'ZZ', 'Needs', 'Owner', '2024-01-01');
      `);
      await expect(
        db.asUser(USER_HR, (query) => query("update employees set hr_owner_id = $1 where id = $2", [scopedEmployeeId, employeeId])),
      ).rejects.toThrow(/must reference an employee whose user currently holds an active hr_admin role for this company/);
    });

    it("accepts hr_owner_id pointing at a currently-active, same-company hr_admin", async () => {
      // db.asUser() always rolls back at the end (see harness.ts) — this
      // write must actually PERSIST, since later describe blocks in this
      // file depend on EMPLOYEE_WORKER already having this hr_owner_id set.
      // The trigger under test (employees_validate_hr_owner) fires on any
      // write regardless of role, so seeding it via the admin connection
      // still exercises — and proves — the same validation an HR Admin's
      // own RLS-checked update would.
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

  describe("projects_validate_manager trigger", () => {
    it("rejects manager_id pointing at a terminated employee", async () => {
      const terminatedId = randomUUID();
      await db.seed(`insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
        values ('${terminatedId}', 'P5-20', '${COMPANY}', 'ZZ', 'Gone', 'AtHire', '2020-01-01', 'terminated');`);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("insert into projects (company_id, code, name, manager_id) values ($1, 'PRJ-BAD1', 'Bad', $2)", [COMPANY, terminatedId]),
        ),
      ).rejects.toThrow(/must reference a currently active employee/);
    });

    it("rejects manager_id pointing at an employee in a DIFFERENT company", async () => {
      await expect(
        db.asUser(USER_HR, (query) =>
          query("insert into projects (company_id, code, name, manager_id) values ($1, 'PRJ-BAD2', 'Bad', $2)", [COMPANY, EMPLOYEE_HR_OTHER]),
        ),
      ).rejects.toThrow(/must belong to the same company as the project/);
    });

    it("accepts manager_id pointing at a currently active, same-company employee", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("insert into projects (company_id, code, name, manager_id) values ($1, 'PRJ-OK', 'Ok', $2) returning manager_id", [
          COMPANY,
          EMPLOYEE_PM,
        ]),
      );
      expect(rows[0]?.manager_id).toBe(EMPLOYEE_PM);
    });
  });

  describe("validate_recovery_credit_project() via record_attendance_and_recovery()", () => {
    it("hard-stops when no project is selected for a present day on a recovery day", async () => {
      const employeeId = randomUUID();
      await db.seed(`insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('${employeeId}', 'P5-21', '${COMPANY}', 'ZZ', 'No', 'Project', '2024-01-01');`);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-09-05",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8 }]),
          ]),
        ),
      ).rejects.toThrow(/A project must be selected for this recovery-day request/);
    });

    it("hard-stops when the selected project belongs to a different company", async () => {
      const employeeId = randomUUID();
      const otherProjectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-22', '${COMPANY}', 'ZZ', 'Cross', 'Company', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${otherProjectId}', '${OTHER_COMPANY}', 'OC-PRJ', 'Other Co Project', '${EMPLOYEE_HR_OTHER}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${otherProjectId}', 100, '2026-01-01');
      `);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-09-05",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: otherProjectId }]),
          ]),
        ),
      ).rejects.toThrow(/belongs to a different company than this employee/);
    });

    it("hard-stops when the employee has no active allocation to the selected project covering the work date", async () => {
      const employeeId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-23', '${COMPANY}', 'ZZ', 'Wrong', 'Date', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-DATE', 'Date project', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date, end_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01', '2026-06-30');
      `);
      // 2026-09-12 is a Saturday, outside the allocation's 2026-01-01..2026-06-30 window.
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-09-12",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectId }]),
          ]),
        ),
      ).rejects.toThrow(/has no active allocation to the selected project covering/);
    });

    it("requires the SPECIFIC project covering the work date when the employee is allocated to more than one", async () => {
      const employeeId = randomUUID();
      const projectA = randomUUID();
      const projectB = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', 'P5-24', '${COMPANY}', 'ZZ', 'Multi', 'Project', '2024-01-01', '${EMPLOYEE_LINEMGR}');
        insert into projects (id, company_id, code, name, manager_id) values
          ('${projectA}', '${COMPANY}', 'PRJ-MA', 'Project A', '${EMPLOYEE_PM}'),
          ('${projectB}', '${COMPANY}', 'PRJ-MB', 'Project B', '${EMPLOYEE_PM2}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date, end_date) values
          ('${employeeId}', '${projectA}', 100, '2026-01-01', '2026-06-30'),
          ('${employeeId}', '${projectB}', 100, '2026-07-01', null);
      `);
      // 2026-09-19 is a Saturday — only covered by Project B's allocation.
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-09-19",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectA }]),
          ]),
        ),
      ).rejects.toThrow(/has no active allocation to the selected project covering/);

      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-09-19",
          JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectB }]),
        ]);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2026-09-19'", [employeeId]);
        const request = await query("select project_id from recovery_credit_requests where attendance_record_id = $1", [record.rows[0]?.id]);
        expect(request.rows[0]?.project_id).toBe(projectB);
      });
    });

    it("hard-stops when the selected project has no assigned Project Manager", async () => {
      const employeeId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-25', '${COMPANY}', 'ZZ', 'No', 'Pm', '2024-01-01');
        insert into projects (id, company_id, code, name) values ('${projectId}', '${COMPANY}', 'PRJ-NOPM', 'No PM project');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01');
      `);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-09-26",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectId }]),
          ]),
        ),
      ).rejects.toThrow(/has no assigned Project Manager/);
    });

    it("hard-stops when the selected project's Project Manager has since been terminated", async () => {
      const employeeId = randomUUID();
      const managerId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${managerId}', 'P5-26', '${COMPANY}', 'ZZ', 'Soon', 'Terminated', '2020-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-TERM', 'Term project', '${managerId}');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-27', '${COMPANY}', 'ZZ', 'Orphaned', 'Worker', '2024-01-01');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01');
        update employees set employment_status = 'terminated' where id = '${managerId}';
      `);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
            "2026-10-03",
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectId }]),
          ]),
        ),
      ).rejects.toThrow(/Project Manager is not currently active/);
    });

    it("stores the selected project_id on a successful request, for a work date in the FUTURE (matching this suite's own synthetic E2E dates)", async () => {
      const employeeId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', 'P5-28', '${COMPANY}', 'ZZ', 'Future', 'Dated', '2024-01-01', '${EMPLOYEE_LINEMGR}');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-FUT', 'Future project', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01');
      `);
      // 2099-01-03 is a Saturday, far in the future — this suite's own
      // synthetic dates routinely land there, which is exactly why
      // validate_recovery_credit_project() checks the allocation against
      // p_work_date, never current_date.
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2099-01-03",
          JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectId }]),
        ]);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2099-01-03'", [employeeId]);
        const request = await query("select project_id from recovery_credit_requests where attendance_record_id = $1", [record.rows[0]?.id]);
        expect(request.rows[0]?.project_id).toBe(projectId);
      });
    });
  });

  describe("validate_recovery_credit_project() via record_overnight_recovery_credit()", () => {
    it("hard-stops when no project is selected", async () => {
      const employeeId = randomUUID();
      await db.seed(`insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('${employeeId}', 'P5-29', '${COMPANY}', 'ZZ', 'Overnight', 'NoProject', '2024-01-01');`);
      await db.asUser(USER_HR, async (query) => {
        await query("insert into attendance_records (employee_id, work_date, status) values ($1, '2026-10-10', 'present')", [employeeId]);
        await expect(
          query("select * from record_overnight_recovery_credit($1, $2, $3, $4, $5)", [employeeId, "2026-10-10", true, 5, null]),
        ).rejects.toThrow(/A project must be selected for this recovery-day request/);
      });
    });

    it("requires the allocation to cover the ACTUAL work date entered, not current_date", async () => {
      const employeeId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', 'P5-30', '${COMPANY}', 'ZZ', 'Overnight', 'FutureDate', '2024-01-01', '${EMPLOYEE_LINEMGR}');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-OVN', 'Overnight project', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2099-01-01');
      `);

      // Two SEPARATE asUser() calls — a raised exception aborts the whole
      // calling transaction (Postgres has no implicit per-statement
      // savepoint), so the failing case below can't share a transaction
      // with the successful one that follows.
      await db.asUser(USER_HR, async (query) => {
        // current_date is nowhere near 2099, so if the check used
        // current_date instead of p_work_date this would wrongly pass.
        await query("insert into attendance_records (employee_id, work_date, status) values ($1, '2026-10-17', 'present')", [employeeId]);
        await expect(
          query("select * from record_overnight_recovery_credit($1, $2, $3, $4, $5)", [employeeId, "2026-10-17", true, 5, projectId]),
        ).rejects.toThrow(/has no active allocation to the selected project covering/);
      });

      await db.asUser(USER_HR, async (query) => {
        await query("insert into attendance_records (employee_id, work_date, status) values ($1, '2099-01-05', 'present')", [employeeId]);
        const { rows } = await query("select * from record_overnight_recovery_credit($1, $2, $3, $4, $5)", [
          employeeId,
          "2099-01-05",
          true,
          5,
          projectId,
        ]);
        expect(rows[0]?.credited).toBe(true);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2099-01-05'", [employeeId]);
        const request = await query("select project_id, event_type from recovery_credit_requests where attendance_record_id = $1", [
          record.rows[0]?.id,
        ]);
        expect(request.rows[0]?.project_id).toBe(projectId);
        expect(request.rows[0]?.event_type).toBe("overnight");
      });
    });
  });

  describe("resolve_approver('project_manager', ...)", () => {
    it("resolves via the entity's own SNAPSHOTTED project_id, not the employee's current allocations", async () => {
      const employeeId = randomUUID();
      const projectA = randomUUID();
      const projectB = randomUUID();
      const requestId = randomUUID();
      // No project_allocations rows at all for this employee — proving
      // resolve_approver('project_manager', ...) never re-derives from
      // allocations itself, only from the already-snapshotted request.
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-31', '${COMPANY}', 'ZZ', 'Snapshot', 'Only', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values
          ('${projectA}', '${COMPANY}', 'PRJ-SNA', 'Snap A', '${EMPLOYEE_PM}'),
          ('${projectB}', '${COMPANY}', 'PRJ-SNB', 'Snap B', '${EMPLOYEE_PM2}');
        insert into attendance_records (employee_id, work_date, status) values ('${employeeId}', '2026-11-01', 'present');
        insert into recovery_credit_requests (id, employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by, project_id)
          values ('${requestId}', '${employeeId}',
            (select id from attendance_records where employee_id = '${employeeId}' and work_date = '2026-11-01'),
            '2026-11-01', 'standard', 1, '${USER_HR}', '${projectA}');
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1, $2) as approver", [employeeId, requestId]),
      );
      expect(rows[0]?.approver).toBe(USER_PM);
    });

    it("two requests for the SAME employee against DIFFERENT projects resolve to each project's own manager", async () => {
      const employeeId = randomUUID();
      const projectA = randomUUID();
      const projectB = randomUUID();
      const requestA = randomUUID();
      const requestB = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-32', '${COMPANY}', 'ZZ', 'Two', 'Requests', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values
          ('${projectA}', '${COMPANY}', 'PRJ-TRA', 'Two-req A', '${EMPLOYEE_PM}'),
          ('${projectB}', '${COMPANY}', 'PRJ-TRB', 'Two-req B', '${EMPLOYEE_PM2}');
        insert into attendance_records (employee_id, work_date, status) values
          ('${employeeId}', '2026-11-07', 'present'),
          ('${employeeId}', '2026-11-08', 'present');
        insert into recovery_credit_requests (id, employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by, project_id) values
          ('${requestA}', '${employeeId}', (select id from attendance_records where employee_id = '${employeeId}' and work_date = '2026-11-07'), '2026-11-07', 'standard', 1, '${USER_HR}', '${projectA}'),
          ('${requestB}', '${employeeId}', (select id from attendance_records where employee_id = '${employeeId}' and work_date = '2026-11-08'), '2026-11-08', 'standard', 1, '${USER_HR}', '${projectB}');
      `);
      const resultA = await db.asUser(USER_HR, (query) => query("select resolve_approver('project_manager', $1, $2) as approver", [employeeId, requestA]));
      const resultB = await db.asUser(USER_HR, (query) => query("select resolve_approver('project_manager', $1, $2) as approver", [employeeId, requestB]));
      expect(resultA.rows[0]?.approver).toBe(USER_PM);
      expect(resultB.rows[0]?.approver).toBe(USER_PM2);
    });

    it("returns null when the snapshotted project has since been deleted", async () => {
      const employeeId = randomUUID();
      const projectId = randomUUID();
      const requestId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-33', '${COMPANY}', 'ZZ', 'Deleted', 'Project', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id, deleted_at) values ('${projectId}', '${COMPANY}', 'PRJ-DEL', 'Deleted', '${EMPLOYEE_PM}', now());
        insert into attendance_records (employee_id, work_date, status) values ('${employeeId}', '2026-11-14', 'present');
        insert into recovery_credit_requests (id, employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by, project_id)
          values ('${requestId}', '${employeeId}',
            (select id from attendance_records where employee_id = '${employeeId}' and work_date = '2026-11-14'),
            '2026-11-14', 'standard', 1, '${USER_HR}', '${projectId}');
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1, $2) as approver", [employeeId, requestId]),
      );
      expect(rows[0]?.approver).toBeNull();
    });

    it("returns null once the snapshotted project's manager has since been terminated (defense-in-depth on top of the write-time trigger)", async () => {
      const employeeId = randomUUID();
      const managerId = randomUUID();
      const projectId = randomUUID();
      const requestId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${managerId}', 'P5-34', '${COMPANY}', 'ZZ', 'Later', 'Terminated', '2020-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-LT', 'Later term', '${managerId}');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-35', '${COMPANY}', 'ZZ', 'Stale', 'Resolve', '2024-01-01');
        insert into attendance_records (employee_id, work_date, status) values ('${employeeId}', '2026-11-21', 'present');
        insert into recovery_credit_requests (id, employee_id, attendance_record_id, work_date, event_type, proposed_days, created_by, project_id)
          values ('${requestId}', '${employeeId}',
            (select id from attendance_records where employee_id = '${employeeId}' and work_date = '2026-11-21'),
            '2026-11-21', 'standard', 1, '${USER_HR}', '${projectId}');
        update employees set employment_status = 'terminated' where id = '${managerId}';
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('project_manager', $1, $2) as approver", [employeeId, requestId]),
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

    // No equivalent "grant scoped to a different company" test for
    // resolve_approver() itself: since the write-time trigger
    // (employees_validate_hr_owner) now runs SECURITY DEFINER and checks the
    // exact same role-company-scope condition, that state can never exist in
    // the first place — not even via db.seed()'s admin connection, since
    // Postgres triggers fire regardless of role unless triggers are
    // explicitly disabled (session_replication_role), which this suite
    // never does. The trigger test above (under "employees_validate_hr_owner
    // trigger") already covers this exact condition at the only point it can
    // actually occur: the write.
  });

  describe("list_active_hr_admins() RPC", () => {
    it("blocks a non-hr_admin caller", async () => {
      await expect(
        db.asUser(USER_LINEMGR, (query) => query("select * from list_active_hr_admins($1)", [COMPANY])),
      ).rejects.toThrow(/Only HR Admin can list HR owner candidates/);
    });

    it("lists only currently-active hr_admin holders whose GRANT applies to the given company, excluding anyone revoked, terminated, in another company, or scoped elsewhere", async () => {
      const otherCompanyHrUserId = randomUUID();
      const otherCompanyHrEmployeeId = randomUUID();
      const scopedElsewhereUserId = randomUUID();
      const scopedElsewhereEmployeeId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${otherCompanyHrUserId}', 'p5-other-hr@enginious.ae'),
          ('${scopedElsewhereUserId}', 'p5-scoped-elsewhere@enginious.ae');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
          ('${otherCompanyHrEmployeeId}', '${otherCompanyHrUserId}', 'OC-02', '${OTHER_COMPANY}', 'ZZ', 'Other', 'CoHr', '2024-01-01'),
          ('${scopedElsewhereEmployeeId}', '${scopedElsewhereUserId}', 'P5-38', '${COMPANY}', 'ZZ', 'Scoped', 'Elsewhere', '2024-01-01');
        insert into user_roles (user_id, role, company_id) values
          ('${otherCompanyHrUserId}', 'hr_admin', '${OTHER_COMPANY}'),
          ('${scopedElsewhereUserId}', 'hr_admin', '${OTHER_COMPANY}');
      `);

      const { rows } = await db.asUser(USER_HR, (query) => query("select employee_id from list_active_hr_admins($1)", [COMPANY]));
      const ids = rows.map((r) => r.employee_id);
      expect(ids).toEqual(expect.arrayContaining([EMPLOYEE_HR, EMPLOYEE_HR2]));
      expect(ids).not.toContain(otherCompanyHrEmployeeId);
      expect(ids).not.toContain(scopedElsewhereEmployeeId);
      expect(ids).not.toContain(EMPLOYEE_LINEMGR);
    });
  });

  describe("snapshot immutability: project_id and the resolved step-1 approver survive a later reassignment", () => {
    it("keeps an already-created request's project_id, and its already-created approval's approver_id, unchanged after the project's manager_id is reassigned", async () => {
      const employeeId = randomUUID();
      const projectId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'P5-39', '${COMPANY}', 'ZZ', 'Immutable', 'Snapshot', '2024-01-01');
        insert into projects (id, company_id, code, name, manager_id) values ('${projectId}', '${COMPANY}', 'PRJ-IMM', 'Immutable project', '${EMPLOYEE_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${employeeId}', '${projectId}', 100, '2026-01-01');
      `);

      // Everything below runs inside ONE asUser() call — db.asUser() always
      // rolls back its whole transaction at the end (see harness.ts), so a
      // SECOND, separate asUser() call would find none of this data; the
      // "reassign the manager" step is itself just another RLS-checked
      // write (projects_write already covers HR Admin), so it fits in the
      // same transaction as everything else here.
      await db.asUser(USER_HR, async (query) => {
        // Manually give this one company's recovery_credit workflow the
        // NEW routing (see the "end-to-end" describe block below for the
        // same setup, applied per-test here since this test needs to
        // inspect approvals.approver_id directly).
        await query(
          `update approval_workflow_steps set approver_type = 'project_manager' where step_order = 1
             and workflow_id in (select id from approval_workflows where company_id = $1 and entity_type = 'recovery_credit')`,
          [COMPANY],
        );
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-12-05",
          JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectId }]),
        ]);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2026-12-05'", [employeeId]);
        const request = await query("select id, project_id from recovery_credit_requests where attendance_record_id = $1", [record.rows[0]?.id]);
        const requestId = request.rows[0]?.id;
        expect(request.rows[0]?.project_id).toBe(projectId);

        const step1 = await query(
          "select id, approver_id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1",
          [requestId],
        );
        const step1ApprovalId = step1.rows[0]?.id;
        expect(step1.rows[0]?.approver_id).toBe(USER_PM);

        // Reassign the project's manager AFTER the request/approval already exist.
        await query("update projects set manager_id = $1 where id = $2", [EMPLOYEE_PM2, projectId]);

        const requestAfter = await query("select project_id from recovery_credit_requests where id = $1", [requestId]);
        expect(requestAfter.rows[0]?.project_id).toBe(projectId);
        const step1After = await query("select approver_id from approvals where id = $1", [step1ApprovalId]);
        expect(step1After.rows[0]?.approver_id).toBe(USER_PM);

        // A NEW resolve_approver() call against this SAME entity now
        // reflects the reassignment (it re-reads the project's CURRENT
        // manager live) — this is the defense-in-depth re-check, not a
        // second snapshot; the approvals row already written above is what
        // actually stays frozen, per approver_id's own established
        // never-recomputed semantics.
        const reResolved = await query("select resolve_approver('project_manager', $1, $2) as approver", [employeeId, requestId]);
        expect(reResolved.rows[0]?.approver).toBe(USER_PM2);
      });
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

    it("routes step 1 to the project manager and step 2 to the hr_owner, and posts the credit only once both approve", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-08-08",
          JSON.stringify([{ employee_id: EMPLOYEE_WORKER, status: "present", hours_worked: 8, project_id: projectId }]),
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
            JSON.stringify([{ employee_id: unassignedEmployeeId, status: "present", hours_worked: 8, project_id: projectId }]),
          ]),
        ),
      ).rejects.toThrow(/has no active allocation to the selected project covering/);
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
            JSON.stringify([{ employee_id: employeeId, status: "present", hours_worked: 8, project_id: projectId }]),
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

  // The core requirement behind versioning instead of an in-place UPDATE:
  // a request already pending at step 1 the moment Stage 2 cuts over must
  // keep advancing through its ORIGINAL workflow's step 2 rule, never the
  // new one — proven here by actually performing a Stage-2-shaped cutover
  // (a NEW approval_workflows row, the old one retired via is_active =
  // false) against a SEPARATE company, so it doesn't disturb the company
  // this file's other describe blocks already configured.
  describe("Stage 2 versioning: a request pending at cutover keeps its ORIGINAL workflow's rules", () => {
    const CUTOVER_COMPANY = "00000000-0000-0000-0000-0000000005a3";
    const USER_CUTOVER_HR = "00000000-0000-0000-0000-0000000005b8";
    const USER_CUTOVER_PM = "00000000-0000-0000-0000-0000000005b9";
    const USER_CUTOVER_LINEMGR = "00000000-0000-0000-0000-0000000005ba";
    const USER_CUTOVER_WORKER = "00000000-0000-0000-0000-0000000005bb";
    const EMPLOYEE_CUTOVER_HR = "00000000-0000-0000-0000-0000000005c8";
    const EMPLOYEE_CUTOVER_PM = "00000000-0000-0000-0000-0000000005c9";
    const EMPLOYEE_CUTOVER_LINEMGR = "00000000-0000-0000-0000-0000000005ca";
    const EMPLOYEE_CUTOVER_WORKER = "00000000-0000-0000-0000-0000000005cb";
    let cutoverProjectId: string;
    let oldWorkflowId: string;
    let pendingRequestId: string;
    let pendingStep1ApprovalId: string;

    beforeAll(async () => {
      cutoverProjectId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_CUTOVER_HR}', 'p5-cutover-hr@enginious.ae'),
          ('${USER_CUTOVER_PM}', 'p5-cutover-pm@enginious.ae'),
          ('${USER_CUTOVER_LINEMGR}', 'p5-cutover-linemgr@enginious.ae'),
          ('${USER_CUTOVER_WORKER}', 'p5-cutover-worker@enginious.ae');
        insert into companies (id, legal_name, country_code, default_currency) values ('${CUTOVER_COMPANY}', 'Cutover Co', 'ZZ', 'ZZD');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
          ('${EMPLOYEE_CUTOVER_HR}', '${USER_CUTOVER_HR}', 'CO-01', '${CUTOVER_COMPANY}', 'ZZ', 'Cut', 'Hr', '2024-01-01'),
          ('${EMPLOYEE_CUTOVER_PM}', '${USER_CUTOVER_PM}', 'CO-02', '${CUTOVER_COMPANY}', 'ZZ', 'Cut', 'Pm', '2024-01-01'),
          ('${EMPLOYEE_CUTOVER_LINEMGR}', '${USER_CUTOVER_LINEMGR}', 'CO-03', '${CUTOVER_COMPANY}', 'ZZ', 'Cut', 'LineMgr', '2024-01-01'),
          ('${EMPLOYEE_CUTOVER_WORKER}', '${USER_CUTOVER_WORKER}', 'CO-04', '${CUTOVER_COMPANY}', 'ZZ', 'Cut', 'Worker', '2024-01-01');
        update employees set manager_id = '${EMPLOYEE_CUTOVER_LINEMGR}' where id = '${EMPLOYEE_CUTOVER_WORKER}';
        insert into user_roles (user_id, role, company_id) values
          ('${USER_CUTOVER_HR}', 'hr_admin', '${CUTOVER_COMPANY}'),
          ('${USER_CUTOVER_LINEMGR}', 'line_manager', '${CUTOVER_COMPANY}');
        insert into projects (id, company_id, code, name, manager_id)
          values ('${cutoverProjectId}', '${CUTOVER_COMPANY}', 'PRJ-CUT', 'Cutover project', '${EMPLOYEE_CUTOVER_PM}');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
          values ('${EMPLOYEE_CUTOVER_WORKER}', '${cutoverProjectId}', 100, '2026-01-01');
        update employees set hr_owner_id = '${EMPLOYEE_CUTOVER_HR}' where id = '${EMPLOYEE_CUTOVER_WORKER}';
      `);

      const { rows } = await db.seed(
        `select id from approval_workflows where company_id = '${CUTOVER_COMPANY}' and entity_type = 'recovery_credit'`,
      );
      oldWorkflowId = rows[0]?.id;

      // Create a request UNDER THE OLD ROUTING (direct_manager -> role:hr_admin,
      // exactly as seed_default_approval_workflows() ships it today) and
      // approve only its step 1 — leaving it pending at step 2, the exact
      // "pending at the moment of cutover" case. Must COMMIT (not the usual
      // asUser(), which always rolls back — see harness.ts) since the
      // later it() blocks in this describe each open their OWN asUser()
      // call and need this row to still exist.
      await db.asUserCommit(USER_CUTOVER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-12-12",
          JSON.stringify([{ employee_id: EMPLOYEE_CUTOVER_WORKER, status: "present", hours_worked: 8, project_id: cutoverProjectId }]),
        ]);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2026-12-12'", [
          EMPLOYEE_CUTOVER_WORKER,
        ]);
        const request = await query("select id from recovery_credit_requests where attendance_record_id = $1", [record.rows[0]?.id]);
        pendingRequestId = request.rows[0]?.id;
        const step1 = await query(
          "select id, workflow_id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1",
          [pendingRequestId],
        );
        pendingStep1ApprovalId = step1.rows[0]?.id;
        expect(step1.rows[0]?.workflow_id).toBe(oldWorkflowId);

        await actAs(query, USER_CUTOVER_LINEMGR);
        await query("select decide_leave_approval($1, 'approved', null)", [pendingStep1ApprovalId]);
      });

      // Now perform the Stage 2 cutover for THIS company: version the
      // workflow (a NEW row, is_active = true) instead of mutating
      // approval_workflow_steps rows in place, and retire the old one.
      const newWorkflowId = randomUUID();
      await db.seed(`
        insert into approval_workflows (id, company_id, entity_type, name, is_active)
          values ('${newWorkflowId}', '${CUTOVER_COMPANY}', 'recovery_credit', 'Recovery Leave earning approval (Project Manager, then HR Owner)', true);
        insert into approval_workflow_steps (workflow_id, step_order, approver_type) values
          ('${newWorkflowId}', 1, 'project_manager'),
          ('${newWorkflowId}', 2, 'hr_owner');
        update approval_workflows set is_active = false where id = '${oldWorkflowId}';
      `);
    }, 30_000);

    it("never touched the pending approval's original workflow_id, or that workflow's own steps", async () => {
      const { rows } = await db.seed(`select workflow_id from approvals where id = '${pendingStep1ApprovalId}'`);
      expect(rows[0]?.workflow_id).toBe(oldWorkflowId);
      const steps = await db.seed(
        `select step_order, approver_type from approval_workflow_steps where workflow_id = '${oldWorkflowId}' order by step_order`,
      );
      expect(steps.rows).toEqual([
        { step_order: 1, approver_type: "direct_manager" },
        { step_order: 2, approver_type: "role:hr_admin" },
      ]);
    });

    it("advances the request pending at cutover through its ORIGINAL (role:hr_admin) step 2, not the new hr_owner rule", async () => {
      await db.asUser(USER_CUTOVER_HR, async (query) => {
        const step2 = await query(
          "select id, approver_id, workflow_id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 2",
          [pendingRequestId],
        );
        expect(step2.rows[0]?.workflow_id).toBe(oldWorkflowId);
        // role:hr_admin resolves company-wide — USER_CUTOVER_HR is the only
        // active hr_admin in this company, so it must be them, exactly as
        // the OLD routing would have picked before any cutover happened.
        expect(step2.rows[0]?.approver_id).toBe(USER_CUTOVER_HR);

        await query("select decide_leave_approval($1, 'approved', null)", [step2.rows[0]?.id]);
        const finalRequest = await query("select status, comp_day_ledger_id from recovery_credit_requests where id = $1", [pendingRequestId]);
        expect(finalRequest.rows[0]?.status).toBe("approved");
        expect(finalRequest.rows[0]?.comp_day_ledger_id).toBeTruthy();
      });
    });

    it("routes a NEW request, created AFTER the cutover, through project_manager -> hr_owner instead", async () => {
      await db.asUser(USER_CUTOVER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-12-19",
          JSON.stringify([{ employee_id: EMPLOYEE_CUTOVER_WORKER, status: "present", hours_worked: 8, project_id: cutoverProjectId }]),
        ]);
        const record = await query("select id from attendance_records where employee_id = $1 and work_date = '2026-12-19'", [
          EMPLOYEE_CUTOVER_WORKER,
        ]);
        const request = await query("select id from recovery_credit_requests where attendance_record_id = $1", [record.rows[0]?.id]);
        const step1 = await query(
          "select approver_id, workflow_id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1",
          [request.rows[0]?.id],
        );
        expect(step1.rows[0]?.workflow_id).not.toBe(oldWorkflowId);
        expect(step1.rows[0]?.approver_id).toBe(USER_CUTOVER_PM);
      });
    });
  });
});
