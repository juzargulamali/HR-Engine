import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

const COMPANY_HQ = "00000000-0000-0000-0000-0000000001a1";

const USER_MANAGER = "00000000-0000-0000-0000-0000000001b1";
const USER_REPORT = "00000000-0000-0000-0000-0000000001b2";
const USER_HR_ADMIN = "00000000-0000-0000-0000-0000000001b3";
const USER_FINANCE = "00000000-0000-0000-0000-0000000001b4";
const USER_CEO = "00000000-0000-0000-0000-0000000001b5";
const USER_SYS_ADMIN = "00000000-0000-0000-0000-0000000001b6";
const USER_OTHER_EMPLOYEE = "00000000-0000-0000-0000-0000000001b7"; // peer, not Ravi's manager

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000001c1";
const EMPLOYEE_REPORT = "00000000-0000-0000-0000-0000000001c2";
const EMPLOYEE_OTHER = "00000000-0000-0000-0000-0000000001c3";

describe("Phase 1 row-level security: contracts, compensation, identity documents", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_MANAGER}', 'manager@enginious.ae'),
        ('${USER_REPORT}', 'report@enginious.ae'),
        ('${USER_HR_ADMIN}', 'hr@enginious.ae'),
        ('${USER_FINANCE}', 'finance@enginious.ae'),
        ('${USER_CEO}', 'ceo@enginious.ae'),
        ('${USER_SYS_ADMIN}', 'admin@enginious.ae'),
        ('${USER_OTHER_EMPLOYEE}', 'peer@enginious.ae');

      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_HQ}', 'Enginious LLC FZ', 'AE', 'AED');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'E001', '${COMPANY_HQ}', 'AE', 'Maya', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'E002', '${COMPANY_HQ}', 'AE', 'Ravi', 'Report', '2024-02-01'),
        ('${EMPLOYEE_OTHER}', '${USER_OTHER_EMPLOYEE}', 'E003', '${COMPANY_HQ}', 'AE', 'Priya', 'Peer', '2024-02-01');
      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_REPORT}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_HQ}'),
        ('${USER_HR_ADMIN}', 'hr_admin', '${COMPANY_HQ}'),
        ('${USER_FINANCE}', 'finance', '${COMPANY_HQ}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_HQ}');
      insert into user_roles (user_id, role) values ('${USER_SYS_ADMIN}', 'sys_admin');

      -- two contract versions for Ravi: a closed probation period, then permanent
      insert into employment_contracts (employee_id, contract_type, start_date, end_date, version_no, is_current, created_by)
        values ('${EMPLOYEE_REPORT}', 'probation', '2024-02-01', '2024-07-31', 1, false, '${USER_HR_ADMIN}');
      insert into employment_contracts (employee_id, contract_type, start_date, end_date, version_no, is_current, created_by)
        values ('${EMPLOYEE_REPORT}', 'permanent', '2024-08-01', null, 2, true, '${USER_HR_ADMIN}');

      insert into compensation_details (employee_id, effective_from, base_salary, currency, bank_iban, created_by)
        values ('${EMPLOYEE_REPORT}', '2024-02-01', 8000, 'AED', 'AE0700000000000000001', '${USER_HR_ADMIN}');

      insert into identity_documents (employee_id, document_type, document_number, created_by)
        values ('${EMPLOYEE_REPORT}', 'passport', 'P1234567', '${USER_HR_ADMIN}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("get_contract_as_of()", () => {
    it("resolves the version covering a date, across the version boundary", async () => {
      const duringProbation = await db.asUser(USER_HR_ADMIN, (query) =>
        query("select contract_type from get_contract_as_of($1, $2)", [EMPLOYEE_REPORT, "2024-05-01"]),
      );
      expect(duringProbation.rows).toEqual([{ contract_type: "probation" }]);

      const afterConversion = await db.asUser(USER_HR_ADMIN, (query) =>
        query("select contract_type from get_contract_as_of($1, $2)", [EMPLOYEE_REPORT, "2025-01-01"]),
      );
      expect(afterConversion.rows).toEqual([{ contract_type: "permanent" }]);
    });
  });

  describe("employment_contracts", () => {
    it("lets the employee see every version of their own contract", async () => {
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query("select contract_type from employment_contracts order by version_no"),
      );
      expect(rows.map((r) => r.contract_type)).toEqual(["probation", "permanent"]);
    });

    it("lets the manager see only the current version, not the full history", async () => {
      const { rows } = await db.asUser(USER_MANAGER, (query) =>
        query("select contract_type, version_no from employment_contracts"),
      );
      expect(rows).toEqual([{ contract_type: "permanent", version_no: 2 }]);
    });

    it("lets HR Admin, Finance, and CEO read the full history", async () => {
      for (const user of [USER_HR_ADMIN, USER_FINANCE, USER_CEO]) {
        const { rows } = await db.asUser(user, (query) => query("select contract_type from employment_contracts"));
        expect(rows.length, `expected ${user} to see both versions`).toBe(2);
      }
    });

    it("gives Sys Admin no access at all", async () => {
      const { rows } = await db.asUser(USER_SYS_ADMIN, (query) => query("select contract_type from employment_contracts"));
      expect(rows).toEqual([]);
    });

    it("excludes an unrelated peer employee entirely", async () => {
      const { rows } = await db.asUser(USER_OTHER_EMPLOYEE, (query) => query("select contract_type from employment_contracts"));
      expect(rows).toEqual([]);
    });

    it("only lets HR Admin insert or update a contract version", async () => {
      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query(
            `insert into employment_contracts (employee_id, contract_type, start_date, version_no, created_by)
             values ($1, 'permanent', '2026-01-01', 3, $2)`,
            [EMPLOYEE_REPORT, USER_MANAGER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const { rowCount } = await db.asUser(USER_REPORT, (query) =>
        query("update employment_contracts set notice_period_days = 90 where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(rowCount).toBe(0);
    });
  });

  describe("compensation_details", () => {
    it("lets the employee see their own compensation, and no one else's", async () => {
      const own = await db.asUser(USER_REPORT, (query) => query("select base_salary from compensation_details"));
      expect(own.rows).toEqual([{ base_salary: "8000.00" }]);

      const peer = await db.asUser(USER_OTHER_EMPLOYEE, (query) => query("select base_salary from compensation_details"));
      expect(peer.rows).toEqual([]);
    });

    it("blocks the manager from seeing their report's compensation — team profile access does not extend to pay", async () => {
      const { rows } = await db.asUser(USER_MANAGER, (query) => query("select base_salary from compensation_details"));
      expect(rows).toEqual([]);
    });

    it("lets HR Admin and Finance see and edit it; blocks CEO", async () => {
      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select base_salary from compensation_details"));
      const finance = await db.asUser(USER_FINANCE, (query) => query("select base_salary from compensation_details"));
      const ceo = await db.asUser(USER_CEO, (query) => query("select base_salary from compensation_details"));
      expect(hr.rows.length).toBe(1);
      expect(finance.rows.length).toBe(1);
      expect(ceo.rows).toEqual([]);

      const update = await db.asUser(USER_FINANCE, (query) =>
        query("update compensation_details set bank_iban = $1 where employee_id = $2 returning bank_iban", [
          "AE0700000000000000099",
          EMPLOYEE_REPORT,
        ]),
      );
      expect(update.rows).toEqual([{ bank_iban: "AE0700000000000000099" }]);
    });

    it("never lets the employee edit their own bank details, read-only per decisions log #1", async () => {
      const { rowCount } = await db.asUser(USER_REPORT, (query) =>
        query("update compensation_details set bank_iban = 'HACKED' where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(rowCount).toBe(0);
    });
  });

  describe("identity_documents", () => {
    it("is visible to the employee themselves and HR Admin only", async () => {
      const own = await db.asUser(USER_REPORT, (query) => query("select document_number from identity_documents"));
      expect(own.rows).toEqual([{ document_number: "P1234567" }]);

      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select document_number from identity_documents"));
      expect(hr.rows.length).toBe(1);
    });

    it("is invisible to Finance, CEO, the manager, and an unrelated peer", async () => {
      for (const user of [USER_FINANCE, USER_CEO, USER_MANAGER, USER_OTHER_EMPLOYEE]) {
        const { rows } = await db.asUser(user, (query) => query("select document_number from identity_documents"));
        expect(rows, `expected ${user} to see no identity documents`).toEqual([]);
      }
    });

    it("only lets HR Admin insert or update an identity document", async () => {
      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query("insert into identity_documents (employee_id, document_type, document_number, created_by) values ($1, 'passport', 'X', $2)", [
            EMPLOYEE_REPORT,
            USER_FINANCE,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("storage: employee-documents and identity-documents buckets", () => {
    const CONTRACT_FILE = `${COMPANY_HQ}/${EMPLOYEE_REPORT}/contract/v2.pdf`;
    const PASSPORT_FILE = `${COMPANY_HQ}/${EMPLOYEE_REPORT}/passport/scan.pdf`;

    beforeAll(async () => {
      await db.seed(`
        insert into storage.buckets (id, name, public) values ('employee-documents','employee-documents',false), ('identity-documents','identity-documents',false)
        on conflict (id) do nothing;
        insert into storage.objects (bucket_id, name) values
          ('employee-documents', '${CONTRACT_FILE}'),
          ('identity-documents', '${PASSPORT_FILE}');
      `);
    });

    it("lets the owning employee and HR Admin read employee-documents, nobody else", async () => {
      const owner = await db.asUser(USER_REPORT, (query) => query("select name from storage.objects where bucket_id = 'employee-documents'"));
      expect(owner.rows.length).toBe(1);

      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select name from storage.objects where bucket_id = 'employee-documents'"));
      expect(hr.rows.length).toBe(1);

      const manager = await db.asUser(USER_MANAGER, (query) => query("select name from storage.objects where bucket_id = 'employee-documents'"));
      expect(manager.rows).toEqual([]);
    });

    it("keeps identity-documents restricted to the owner and HR Admin only — never Finance", async () => {
      const owner = await db.asUser(USER_REPORT, (query) => query("select name from storage.objects where bucket_id = 'identity-documents'"));
      expect(owner.rows.length).toBe(1);

      const finance = await db.asUser(USER_FINANCE, (query) => query("select name from storage.objects where bucket_id = 'identity-documents'"));
      expect(finance.rows).toEqual([]);
    });

    it("blocks anyone but HR Admin from uploading into either bucket", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query("insert into storage.objects (bucket_id, name) values ('identity-documents', $1)", [
            `${COMPANY_HQ}/${EMPLOYEE_REPORT}/passport/self-upload.pdf`,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("soft-delete recovery visibility", () => {
    it("lets HR Admin and Sys Admin see a soft-deleted employee; everyone else loses visibility", async () => {
      await db.seed(`update employees set deleted_at = now(), deleted_by = '${USER_HR_ADMIN}' where id = '${EMPLOYEE_OTHER}'`);

      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select first_name from employees where id = $1", [EMPLOYEE_OTHER]));
      expect(hr.rows).toEqual([{ first_name: "Priya" }]);

      const sysAdmin = await db.asUser(USER_SYS_ADMIN, (query) => query("select first_name from employees where id = $1", [EMPLOYEE_OTHER]));
      expect(sysAdmin.rows).toEqual([{ first_name: "Priya" }]);

      const finance = await db.asUser(USER_FINANCE, (query) => query("select first_name from employees where id = $1", [EMPLOYEE_OTHER]));
      expect(finance.rows).toEqual([]);

      // Restoring is HR Admin's alone — Sys Admin can see the deleted row but can't undelete it.
      const sysAdminRestore = await db.asUser(USER_SYS_ADMIN, (query) =>
        query("update employees set deleted_at = null where id = $1", [EMPLOYEE_OTHER]),
      );
      expect(sysAdminRestore.rowCount).toBe(0);

      const hrRestore = await db.asUser(USER_HR_ADMIN, (query) =>
        query("update employees set deleted_at = null, deleted_by = null where id = $1 returning first_name", [EMPLOYEE_OTHER]),
      );
      expect(hrRestore.rows).toEqual([{ first_name: "Priya" }]);
    });
  });

  describe("employee self-service contact info edit", () => {
    it("lets an employee update their own personal_email and phone", async () => {
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query(
          "update employees set personal_email = $1, phone = $2 where id = $3 returning personal_email, phone",
          ["ravi.personal@example.com", "+971500000000", EMPLOYEE_REPORT],
        ),
      );
      expect(rows).toEqual([{ personal_email: "ravi.personal@example.com", phone: "+971500000000" }]);
    });

    it("blocks an employee from changing anything else on their own row, even in the same statement", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query("update employees set personal_email = $1, job_title = 'Self-Promoted' where id = $2", [
            "ravi@example.com",
            EMPLOYEE_REPORT,
          ]),
        ),
      ).rejects.toThrow(/Only personal_email and phone can be self-updated/);
    });

    it("blocks an employee from editing someone else's contact info", async () => {
      const { rowCount } = await db.asUser(USER_REPORT, (query) =>
        query("update employees set personal_email = 'hacked@example.com' where id = $1", [EMPLOYEE_MANAGER]),
      );
      expect(rowCount).toBe(0);
    });

    it("still lets HR Admin edit any field, unaffected by the self-update guard", async () => {
      const { rows } = await db.asUser(USER_HR_ADMIN, (query) =>
        query("update employees set job_title = $1 where id = $2 returning job_title", ["Staff Engineer", EMPLOYEE_REPORT]),
      );
      expect(rows).toEqual([{ job_title: "Staff Engineer" }]);
    });

    it("blocks a dual-role user from escalating by setting company_id to a company they administer elsewhere (regression: guard checked NEW.company_id instead of OLD.company_id)", async () => {
      // Ravi-of-another-company: has an ordinary employees row in Company B,
      // but is ALSO hr_admin of Company C — a legitimate, unrelated grant.
      // The bug: guard_employee_self_update() checked has_role('hr_admin',
      // new.company_id) — the attacker-supplied value — so setting
      // company_id to Company C (which they genuinely administer) made the
      // trigger treat the whole payload as an HR Admin write and let every
      // other column through unchecked, including job_title/
      // employment_status/manager_id in the SAME statement.
      const companyB = "00000000-0000-0000-0000-0000000001d1";
      const companyC = "00000000-0000-0000-0000-0000000001d2";
      const dualRoleUser = "00000000-0000-0000-0000-0000000001b8";
      const dualRoleEmployee = "00000000-0000-0000-0000-0000000001c4";
      await db.seed(`
        insert into auth.users (id, email) values ('${dualRoleUser}', 'dual-role@enginious.ae');
        insert into companies (id, legal_name, country_code, default_currency) values
          ('${companyB}', 'Company B', 'AE', 'AED'),
          ('${companyC}', 'Company C', 'AE', 'AED');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${dualRoleEmployee}', '${dualRoleUser}', 'DUAL-01', '${companyB}', 'AE', 'Dana', 'Dual', '2024-01-01');
        insert into user_roles (user_id, role, company_id) values ('${dualRoleUser}', 'hr_admin', '${companyC}');
      `);

      await expect(
        db.asUser(dualRoleUser, (query) =>
          query("update employees set company_id = $1, job_title = 'Self-Promoted CEO' where id = $2", [companyC, dualRoleEmployee]),
        ),
      ).rejects.toThrow(/Only personal_email and phone can be self-updated/);

      const check = await db.asUser(USER_SYS_ADMIN, (query) =>
        query("select company_id, job_title from employees where id = $1", [dualRoleEmployee]),
      );
      expect(check.rows).toEqual([{ company_id: companyB, job_title: null }]);
    });
  });
});
