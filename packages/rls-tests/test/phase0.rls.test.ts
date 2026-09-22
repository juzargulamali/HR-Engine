import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Fixture ids — fixed, readable UUIDs rather than generated ones so a failing
// assertion's output is easy to trace back to "who" without cross-referencing.
const COMPANY_HQ = "00000000-0000-0000-0000-0000000000a1"; // Enginious LLC FZ (UAE)
const COMPANY_KSA = "00000000-0000-0000-0000-0000000000a2"; // Enginious KSA branch

const USER_MANAGER = "00000000-0000-0000-0000-0000000000b1";
const USER_REPORT = "00000000-0000-0000-0000-0000000000b2";
const USER_HR_ADMIN = "00000000-0000-0000-0000-0000000000b3";
const USER_FINANCE = "00000000-0000-0000-0000-0000000000b4";
const USER_CEO = "00000000-0000-0000-0000-0000000000b5";
const USER_SYS_ADMIN = "00000000-0000-0000-0000-0000000000b6";
const USER_STRANGER = "00000000-0000-0000-0000-0000000000b7"; // logged in, no employee record, no roles
const USER_KSA_EMPLOYEE = "00000000-0000-0000-0000-0000000000b8";

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000000c1";
const EMPLOYEE_REPORT = "00000000-0000-0000-0000-0000000000c2";
const EMPLOYEE_KSA = "00000000-0000-0000-0000-0000000000c3";

describe("Phase 0 row-level security", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    // handle_new_auth_user() should fire on every one of these inserts and
    // create a matching `profiles` row with no extra step — exercised for
    // real by the "profiles are auto-provisioned" test below.
    await db.seed(`
      insert into auth.users (id, email, raw_user_meta_data) values
        ('${USER_MANAGER}', 'manager@enginious.ae', '{"full_name":"Maya Manager"}'),
        ('${USER_REPORT}', 'report@enginious.ae', '{"full_name":"Ravi Report"}'),
        ('${USER_HR_ADMIN}', 'hr@enginious.ae', '{"full_name":"Hana HR"}'),
        ('${USER_FINANCE}', 'finance@enginious.ae', '{"full_name":"Faisal Finance"}'),
        ('${USER_CEO}', 'ceo@enginious.ae', '{"full_name":"Cyrus CEO"}'),
        ('${USER_SYS_ADMIN}', 'admin@enginious.ae', '{"full_name":"Sam SysAdmin"}'),
        ('${USER_STRANGER}', 'stranger@example.com', '{"full_name":"Sam Stranger"}'),
        ('${USER_KSA_EMPLOYEE}', 'ksa@enginious.sa', '{"full_name":"Khalid KSA"}');

      insert into countries (code, name, default_currency, week_start_day) values
        ('AE', 'United Arab Emirates', 'AED', 0),
        ('SA', 'Saudi Arabia', 'SAR', 0),
        ('PL', 'Poland', 'PLN', 1)
      on conflict do nothing;

      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_HQ}', 'Enginious LLC FZ', 'AE', 'AED'),
        ('${COMPANY_KSA}', 'Enginious KSA', 'SA', 'SAR');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'E001', '${COMPANY_HQ}', 'AE', 'Maya', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'E002', '${COMPANY_HQ}', 'AE', 'Ravi', 'Report', '2024-02-01'),
        ('${EMPLOYEE_KSA}', '${USER_KSA_EMPLOYEE}', 'E900', '${COMPANY_KSA}', 'SA', 'Khalid', 'KSA', '2024-03-01');

      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_REPORT}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_HQ}'),
        ('${USER_HR_ADMIN}', 'hr_admin', '${COMPANY_HQ}'),
        ('${USER_FINANCE}', 'finance', '${COMPANY_HQ}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_HQ}');
      insert into user_roles (user_id, role) values
        ('${USER_SYS_ADMIN}', 'sys_admin');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("profiles auto-provisioning", () => {
    it("creates a profile row automatically when an auth.users row is created", async () => {
      const rows = await db.asUser(USER_SYS_ADMIN, (query) =>
        query("select email, full_name from profiles where id = $1", [USER_MANAGER]),
      );
      expect(rows.rows).toEqual([{ email: "manager@enginious.ae", full_name: "Maya Manager" }]);
    });
  });

  describe("employees", () => {
    it("lets an employee see only their own row", async () => {
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query("select first_name from employees order by first_name"),
      );
      expect(rows.map((r) => r.first_name)).toEqual(["Ravi"]);
    });

    it("lets a manager see themselves and their direct reports, nobody else", async () => {
      const { rows } = await db.asUser(USER_MANAGER, (query) =>
        query("select first_name from employees order by first_name"),
      );
      expect(rows.map((r) => r.first_name)).toEqual(["Maya", "Ravi"]);
    });

    it("lets HR Admin see every employee in their company, not another company's", async () => {
      const { rows } = await db.asUser(USER_HR_ADMIN, (query) =>
        query("select first_name from employees order by first_name"),
      );
      expect(rows.map((r) => r.first_name)).toEqual(["Maya", "Ravi"]);
      expect(rows.map((r) => r.first_name)).not.toContain("Khalid");
    });

    it("lets Finance and CEO read employees in their company (no write)", async () => {
      const financeView = await db.asUser(USER_FINANCE, (query) => query("select first_name from employees"));
      const ceoView = await db.asUser(USER_CEO, (query) => query("select first_name from employees"));
      expect(financeView.rows.map((r) => r.first_name).sort()).toEqual(["Maya", "Ravi"]);
      expect(ceoView.rows.map((r) => r.first_name).sort()).toEqual(["Maya", "Ravi"]);
    });

    it("lets Sys Admin see every employee across every company", async () => {
      const { rows } = await db.asUser(USER_SYS_ADMIN, (query) => query("select first_name from employees"));
      expect(rows.map((r) => r.first_name).sort()).toEqual(["Khalid", "Maya", "Ravi"]);
    });

    it("shows a logged-in stranger with no employee record and no roles nothing at all", async () => {
      const { rows } = await db.asUser(USER_STRANGER, (query) => query("select first_name from employees"));
      expect(rows).toEqual([]);
    });

    it("lets HR Admin insert a new employee in their own company", async () => {
      const { rows } = await db.asUser(USER_HR_ADMIN, (query) =>
        query(
          `insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date)
           values ('E999', $1, 'AE', 'New', 'Hire', '2026-01-01') returning first_name`,
          [COMPANY_HQ],
        ),
      );
      expect(rows).toEqual([{ first_name: "New" }]);
    });

    it("blocks HR Admin from inserting an employee into a company they don't administer", async () => {
      await expect(
        db.asUser(USER_HR_ADMIN, (query) =>
          query(
            `insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date)
             values ('E998', $1, 'SA', 'Should', 'Fail', '2026-01-01')`,
            [COMPANY_KSA],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("blocks a plain employee from inserting or updating any employee row", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date)
             values ('E997', $1, 'AE', 'Should', 'Fail', '2026-01-01')`,
            [COMPANY_HQ],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const { rowCount } = await db.asUser(USER_REPORT, (query) =>
        query("update employees set job_title = 'Should not stick' where id = $1", [EMPLOYEE_MANAGER]),
      );
      expect(rowCount).toBe(0); // RLS filters the row out of the UPDATE's view, not a thrown error
    });

    it("blocks a manager from updating their report's record (that's HR's job, not the manager's)", async () => {
      const { rowCount } = await db.asUser(USER_MANAGER, (query) =>
        query("update employees set job_title = 'Should not stick' where id = $1", [EMPLOYEE_REPORT]),
      );
      expect(rowCount).toBe(0);
    });

    it("lets HR Admin update an employee in their company", async () => {
      const { rows } = await db.asUser(USER_HR_ADMIN, (query) =>
        query("update employees set job_title = $1 where id = $2 returning job_title", [
          "Senior Engineer",
          EMPLOYEE_REPORT,
        ]),
      );
      expect(rows).toEqual([{ job_title: "Senior Engineer" }]);
    });
  });

  describe("reference data: countries, companies, departments", () => {
    it("lets any signed-in user read the country/company directory", async () => {
      const countries = await db.asUser(USER_STRANGER, (query) => query("select code from countries order by code"));
      expect(countries.rows.map((r) => r.code)).toEqual(["AE", "PL", "SA"]);

      const companies = await db.asUser(USER_STRANGER, (query) => query("select legal_name from companies"));
      expect(companies.rows.length).toBe(2);
    });

    it("blocks anonymous (signed-out) access to the same reference data", async () => {
      const { rows } = await db.asUser(null, (query) => query("select code from countries"));
      expect(rows).toEqual([]);
    });

    it("blocks HR Admin from creating a new company (that's Sys Admin's job)", async () => {
      await expect(
        db.asUser(USER_HR_ADMIN, (query) =>
          query("insert into companies (legal_name, country_code, default_currency) values ('Rogue Co', 'AE', 'AED')"),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("lets Sys Admin create a company", async () => {
      const { rows } = await db.asUser(USER_SYS_ADMIN, (query) =>
        query(
          "insert into companies (legal_name, country_code, default_currency) values ('Enginious Poland', 'PL', 'PLN') returning legal_name",
        ),
      );
      expect(rows).toEqual([{ legal_name: "Enginious Poland" }]);
    });

    it("lets HR Admin create a department in their own company but not another", async () => {
      const ok = await db.asUser(USER_HR_ADMIN, (query) =>
        query("insert into departments (company_id, name) values ($1, 'Engineering') returning name", [COMPANY_HQ]),
      );
      expect(ok.rows).toEqual([{ name: "Engineering" }]);

      await expect(
        db.asUser(USER_HR_ADMIN, (query) =>
          query("insert into departments (company_id, name) values ($1, 'Should Fail')", [COMPANY_KSA]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("user_roles", () => {
    it("lets a user see only their own role grants", async () => {
      const { rows } = await db.asUser(USER_MANAGER, (query) => query("select role from user_roles"));
      expect(rows).toEqual([{ role: "line_manager" }]);
    });

    it("lets Sys Admin see every role grant", async () => {
      const { rows } = await db.asUser(USER_SYS_ADMIN, (query) => query("select role from user_roles"));
      expect(rows.length).toBeGreaterThanOrEqual(5);
    });

    it("blocks a user from granting themselves a role", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) => query("insert into user_roles (user_id, role) values ($1, 'sys_admin')", [USER_REPORT])),
      ).rejects.toThrow(/row-level security/);
    });

    it("lets Sys Admin grant a role", async () => {
      const { rows } = await db.asUser(USER_SYS_ADMIN, (query) =>
        query(
          "insert into user_roles (user_id, role, company_id) values ($1, 'employee', $2) returning role",
          [USER_STRANGER, COMPANY_HQ],
        ),
      );
      expect(rows).toEqual([{ role: "employee" }]);
    });
  });

  describe("profiles", () => {
    it("lets any signed-in user read the directory but only edit their own row", async () => {
      const directory = await db.asUser(USER_REPORT, (query) => query("select email from profiles"));
      expect(directory.rows.length).toBeGreaterThanOrEqual(8);

      const ownEdit = await db.asUser(USER_REPORT, (query) =>
        query("update profiles set full_name = 'Ravi R.' where id = $1 returning full_name", [USER_REPORT]),
      );
      expect(ownEdit.rows).toEqual([{ full_name: "Ravi R." }]);

      const otherEdit = await db.asUser(USER_REPORT, (query) =>
        query("update profiles set full_name = 'Hacked' where id = $1", [USER_MANAGER]),
      );
      expect(otherEdit.rowCount).toBe(0);
    });
  });
});
