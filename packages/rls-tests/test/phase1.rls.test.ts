import { randomUUID } from "node:crypto";
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

      insert into employee_loans (employee_id, loan_type, amount, currency, issued_date, created_by)
        values ('${EMPLOYEE_REPORT}', 'loan', 5000, 'AED', '2026-01-01', '${USER_HR_ADMIN}');

      insert into employee_insurance_policies (employee_id, insurance_name, policy_number, created_by)
        values ('${EMPLOYEE_REPORT}', 'Daman', 'POL-001', '${USER_HR_ADMIN}');

      insert into employee_career_events (employee_id, event_type, effective_date, previous_job_title, new_job_title, previous_base_salary, new_base_salary, currency, created_by)
        values ('${EMPLOYEE_REPORT}', 'promotion', '2026-01-01', 'Engineer', 'Senior Engineer', 8000, 9500, 'AED', '${USER_HR_ADMIN}');
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

  describe("employee_loans", () => {
    it("mirrors compensation_details' visibility: self, HR Admin, and Finance; never a manager, CEO, or a peer", async () => {
      const own = await db.asUser(USER_REPORT, (query) => query("select amount from employee_loans"));
      expect(own.rows).toEqual([{ amount: "5000.00" }]);

      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select amount from employee_loans"));
      const finance = await db.asUser(USER_FINANCE, (query) => query("select amount from employee_loans"));
      expect(hr.rows.length).toBe(1);
      expect(finance.rows.length).toBe(1);

      for (const user of [USER_MANAGER, USER_CEO, USER_OTHER_EMPLOYEE]) {
        const { rows } = await db.asUser(user, (query) => query("select amount from employee_loans"));
        expect(rows, `expected ${user} to see no loans`).toEqual([]);
      }
    });

    it("blocks an ordinary employee from inserting their own loan record", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            "insert into employee_loans (employee_id, loan_type, amount, currency, issued_date, created_by) values ($1, 'cash_advance', 100, 'AED', '2026-01-01', $2)",
            [EMPLOYEE_REPORT, USER_REPORT],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("blocks the employee from deleting their own loan record, but lets Finance delete it", async () => {
      const blocked = await db.asUser(USER_REPORT, (query) => query("delete from employee_loans where employee_id = $1", [EMPLOYEE_REPORT]));
      expect(blocked.rowCount).toBe(0);

      const allowed = await db.asUser(USER_FINANCE, (query) => query("delete from employee_loans where employee_id = $1", [EMPLOYEE_REPORT]));
      expect(allowed.rowCount).toBe(1);
    });
  });

  describe("employee_insurance_policies", () => {
    it("mirrors identity_documents' visibility: self and HR Admin only — never Finance, CEO, or a manager", async () => {
      const own = await db.asUser(USER_REPORT, (query) => query("select policy_number from employee_insurance_policies"));
      expect(own.rows).toEqual([{ policy_number: "POL-001" }]);

      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select policy_number from employee_insurance_policies"));
      expect(hr.rows.length).toBe(1);

      for (const user of [USER_FINANCE, USER_CEO, USER_MANAGER, USER_OTHER_EMPLOYEE]) {
        const { rows } = await db.asUser(user, (query) => query("select policy_number from employee_insurance_policies"));
        expect(rows, `expected ${user} to see no insurance policies`).toEqual([]);
      }
    });

    it("only lets HR Admin insert or delete an insurance policy", async () => {
      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query(
            "insert into employee_insurance_policies (employee_id, insurance_name, policy_number, created_by) values ($1, 'X', 'Y', $2)",
            [EMPLOYEE_REPORT, USER_FINANCE],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const blockedDelete = await db.asUser(USER_REPORT, (query) =>
        query("delete from employee_insurance_policies where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(blockedDelete.rowCount).toBe(0);

      const allowedDelete = await db.asUser(USER_HR_ADMIN, (query) =>
        query("delete from employee_insurance_policies where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(allowedDelete.rowCount).toBe(1);
    });
  });

  describe("employee_career_events", () => {
    it("mirrors compensation_details' visibility: self, HR Admin, and Finance; never a manager, CEO, or a peer", async () => {
      const own = await db.asUser(USER_REPORT, (query) => query("select new_job_title, new_base_salary from employee_career_events"));
      expect(own.rows).toEqual([{ new_job_title: "Senior Engineer", new_base_salary: "9500.00" }]);

      const hr = await db.asUser(USER_HR_ADMIN, (query) => query("select id from employee_career_events"));
      const finance = await db.asUser(USER_FINANCE, (query) => query("select id from employee_career_events"));
      expect(hr.rows.length).toBe(1);
      expect(finance.rows.length).toBe(1);

      for (const user of [USER_MANAGER, USER_CEO, USER_OTHER_EMPLOYEE]) {
        const { rows } = await db.asUser(user, (query) => query("select id from employee_career_events"));
        expect(rows, `expected ${user} to see no career events`).toEqual([]);
      }
    });

    it("only lets HR Admin record a career event — never Finance, even though Finance can edit plain compensation", async () => {
      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query(
            "insert into employee_career_events (employee_id, event_type, effective_date, new_base_salary, created_by) values ($1, 'salary_change', '2026-02-01', 10000, $2)",
            [EMPLOYEE_REPORT, USER_FINANCE],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const { rows } = await db.asUser(USER_HR_ADMIN, (query) =>
        query(
          "insert into employee_career_events (employee_id, event_type, effective_date, new_job_title, created_by) values ($1, 'title_change', '2026-02-01', 'Staff Engineer', $2) returning id",
          [EMPLOYEE_REPORT, USER_HR_ADMIN],
        ),
      );
      expect(rows.length).toBe(1);
    });

    it("never lets anyone update or delete a career event — permanent history", async () => {
      const { rows } = await db.asUser(USER_HR_ADMIN, (query) => query("select id from employee_career_events limit 1"));
      const eventId = rows[0].id as string;

      const update = await db.asUser(USER_HR_ADMIN, (query) => query("update employee_career_events set note = 'edited' where id = $1", [eventId]));
      expect(update.rowCount).toBe(0);

      const del = await db.asUser(USER_HR_ADMIN, (query) => query("delete from employee_career_events where id = $1", [eventId]));
      expect(del.rowCount).toBe(0);
    });
  });

  describe("get_career_summary_for_appraisal()", () => {
    it("gives the manager dates only, matching what HR Admin/self sees, but never the salary figures", async () => {
      const summarySql =
        "select last_promotion_date::text, last_title_change_date::text, last_salary_change_date::text from get_career_summary_for_appraisal($1)";
      const forManager = await db.asUser(USER_MANAGER, (query) => query(summarySql, [EMPLOYEE_REPORT]));
      expect(forManager.rows).toEqual([
        { last_promotion_date: "2026-01-01", last_title_change_date: null, last_salary_change_date: "2026-01-01" },
      ]);
      // The row shape itself proves it: no base_salary/allowances columns exist to leak in the first place.
      expect(Object.keys(forManager.rows[0])).toEqual(["last_promotion_date", "last_title_change_date", "last_salary_change_date"]);

      const forSelf = await db.asUser(USER_REPORT, (query) => query(summarySql, [EMPLOYEE_REPORT]));
      expect(forSelf.rows).toEqual(forManager.rows);
    });

    it("returns all-null for a peer who is neither the employee, their manager, nor HR/Finance/CEO", async () => {
      const { rows } = await db.asUser(USER_OTHER_EMPLOYEE, (query) =>
        query(
          "select last_promotion_date::text, last_title_change_date::text, last_salary_change_date::text from get_career_summary_for_appraisal($1)",
          [EMPLOYEE_REPORT],
        ),
      );
      expect(rows).toEqual([{ last_promotion_date: null, last_title_change_date: null, last_salary_change_date: null }]);
    });
  });

  // Regression tests for the fourth audit pass: employment_contracts_update/
  // compensation_update/identity_docs_update all resolve has_role(...) from
  // employee_id — USING against the OLD row, WITH CHECK against the NEW row
  // — so nothing stopped employee_id itself changing in the same UPDATE (the
  // same shape already fixed for goals/appraisals in phase 5, just never
  // patched on these three sensitive-tier tables). An HR Admin/Finance user
  // with write access to both the source and destination employee's company
  // could retarget a row of confidential salary/IBAN or passport/Iqama/PESEL
  // data onto a different employee. guard_employee_id_immutable() now blocks
  // this while leaving every other column freely editable.
  describe("employee_id immutability guard (guard_employee_id_immutable)", () => {
    it("blocks HR Admin from reassigning an employment_contracts row to a different employee, while an ordinary column update still succeeds", async () => {
      const contractId = randomUUID();
      await db.seed(`
        insert into employment_contracts (id, employee_id, contract_type, start_date, version_no, is_current, created_by)
        values ('${contractId}', '${EMPLOYEE_OTHER}', 'permanent', '2024-01-01', 1, true, '${USER_HR_ADMIN}');
      `);

      await expect(
        db.asUser(USER_HR_ADMIN, (query) =>
          query("update employment_contracts set employee_id = $1 where id = $2", [EMPLOYEE_MANAGER, contractId]),
        ),
      ).rejects.toThrow(/cannot be reassigned to a different employee/);

      await db.asUser(USER_HR_ADMIN, async (query) => {
        const { rows } = await query(
          "update employment_contracts set notice_period_days = 45 where id = $1 returning notice_period_days, employee_id",
          [contractId],
        );
        expect(rows).toEqual([{ notice_period_days: 45, employee_id: EMPLOYEE_OTHER }]);
      });
    });

    it("blocks Finance from reassigning a compensation_details row to a different employee, while an ordinary column update still succeeds", async () => {
      const compId = randomUUID();
      await db.seed(`
        insert into compensation_details (id, employee_id, effective_from, base_salary, currency, created_by)
        values ('${compId}', '${EMPLOYEE_OTHER}', '2024-01-01', 5000, 'AED', '${USER_HR_ADMIN}');
      `);

      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query("update compensation_details set employee_id = $1 where id = $2", [EMPLOYEE_MANAGER, compId]),
        ),
      ).rejects.toThrow(/cannot be reassigned to a different employee/);

      await db.asUser(USER_FINANCE, async (query) => {
        const { rows } = await query(
          "update compensation_details set base_salary = 5500 where id = $1 returning base_salary, employee_id",
          [compId],
        );
        expect(rows).toEqual([{ base_salary: "5500.00", employee_id: EMPLOYEE_OTHER }]);
      });
    });

    it("blocks HR Admin from reassigning an identity_documents row to a different employee, while an ordinary column update still succeeds", async () => {
      const docId = randomUUID();
      await db.seed(`
        insert into identity_documents (id, employee_id, document_type, document_number, created_by)
        values ('${docId}', '${EMPLOYEE_OTHER}', 'passport', 'X9999999', '${USER_HR_ADMIN}');
      `);

      await expect(
        db.asUser(USER_HR_ADMIN, (query) =>
          query("update identity_documents set employee_id = $1 where id = $2", [EMPLOYEE_MANAGER, docId]),
        ),
      ).rejects.toThrow(/cannot be reassigned to a different employee/);

      await db.asUser(USER_HR_ADMIN, async (query) => {
        const { rows } = await query(
          "update identity_documents set expiry_date = '2030-01-01' where id = $1 returning expiry_date::text as expiry_date, employee_id",
          [docId],
        );
        expect(rows).toEqual([{ expiry_date: "2030-01-01", employee_id: EMPLOYEE_OTHER }]);
      });
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

  describe("employee_number reuse after soft-delete", () => {
    it("blocks a duplicate number while both rows are live, but frees it as soon as the original is soft-deleted", async () => {
      const scratchId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${scratchId}', 'REUSE-01', '${COMPANY_HQ}', 'AE', 'To', 'Delete', '2024-01-01');
      `);

      // Blocked while both rows would be live.
      await expect(
        db.asUser(USER_HR_ADMIN, (query) =>
          query(
            "insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values ('REUSE-01', $1, 'AE', 'Still', 'Blocked', '2024-01-01')",
            [COMPANY_HQ],
          ),
        ),
      ).rejects.toThrow(/duplicate key value violates unique constraint/);

      // A soft-delete (not a permanent one) already frees the number up.
      await db.seed(`update employees set deleted_at = now() where id = '${scratchId}';`);

      const { rows } = await db.asUser(USER_HR_ADMIN, (query) =>
        query(
          "insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values ('REUSE-01', $1, 'AE', 'New', 'Hire', '2024-01-01') returning id",
          [COMPANY_HQ],
        ),
      );
      expect(rows.length).toBe(1);
    });
  });

  describe("permanently_delete_employee()", () => {
    async function seedScratchEmployee(numberSuffix: string) {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${employeeId}', 'PD-${numberSuffix}', '${COMPANY_HQ}', 'AE', 'Purge', 'Me-${numberSuffix}', '2024-01-01');
        insert into employment_contracts (employee_id, contract_type, start_date, version_no, is_current, created_by)
          values ('${employeeId}', 'permanent', '2024-01-01', 1, true, '${USER_HR_ADMIN}');
        insert into compensation_details (employee_id, effective_from, base_salary, currency, created_by)
          values ('${employeeId}', '2024-01-01', 5000, 'AED', '${USER_HR_ADMIN}');
        insert into identity_documents (employee_id, document_type, document_number, created_by)
          values ('${employeeId}', 'passport', 'PD-PASSPORT-${numberSuffix}', '${USER_HR_ADMIN}');
        insert into employee_loans (employee_id, loan_type, amount, currency, issued_date, created_by)
          values ('${employeeId}', 'loan', 1000, 'AED', '2026-01-01', '${USER_HR_ADMIN}');
        insert into employee_insurance_policies (employee_id, insurance_name, policy_number, created_by)
          values ('${employeeId}', 'Daman', 'PD-POL-${numberSuffix}', '${USER_HR_ADMIN}');
        insert into employee_career_events (employee_id, event_type, effective_date, new_job_title, new_base_salary, currency, created_by)
          values ('${employeeId}', 'promotion', '2026-01-01', 'Engineer', 5500, 'AED', '${USER_HR_ADMIN}');
      `);
      return employeeId;
    }

    it("blocks permanent delete of an employee who hasn't been removed first", async () => {
      const employeeId = await seedScratchEmployee("1");
      await expect(db.asUser(USER_HR_ADMIN, (query) => query("select permanently_delete_employee($1)", [employeeId]))).rejects.toThrow(
        /Remove the employee first/,
      );
    });

    it("blocks anyone other than HR Admin from calling it", async () => {
      const employeeId = await seedScratchEmployee("2");
      await db.seed(`update employees set deleted_at = now() where id = '${employeeId}';`);

      await expect(
        db.asUser(USER_MANAGER, (query) => query("select permanently_delete_employee($1)", [employeeId])),
      ).rejects.toThrow(/Only HR Admin may permanently delete/);
      await expect(
        db.asUser(USER_SYS_ADMIN, (query) => query("select permanently_delete_employee($1)", [employeeId])),
      ).rejects.toThrow(/Only HR Admin may permanently delete/);

      const stillThere = await db.asUser(USER_HR_ADMIN, (query) => query("select id from employees where id = $1", [employeeId]));
      expect(stillThere.rows.length).toBe(1);
    });

    it("blocks an HR Admin of a different company", async () => {
      const otherCompany = "00000000-0000-0000-0000-0000000001d3";
      const otherHrUser = "00000000-0000-0000-0000-0000000001b9";
      await db.seed(`
        insert into auth.users (id, email) values ('${otherHrUser}', 'other-hr@enginious.ae');
        insert into companies (id, legal_name, country_code, default_currency) values ('${otherCompany}', 'Other Co', 'AE', 'AED');
        insert into user_roles (user_id, role, company_id) values ('${otherHrUser}', 'hr_admin', '${otherCompany}');
      `);
      const employeeId = await seedScratchEmployee("3");
      await db.seed(`update employees set deleted_at = now() where id = '${employeeId}';`);

      await expect(
        db.asUser(otherHrUser, (query) => query("select permanently_delete_employee($1)", [employeeId])),
      ).rejects.toThrow(/Only HR Admin may permanently delete/);
    });

    it("cascades the delete across every related table, and nulls out a report's manager_id instead of blocking", async () => {
      const employeeId = await seedScratchEmployee("4");
      const reportId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${reportId}', 'PD-4-REPORT', '${COMPANY_HQ}', 'AE', 'Reports', 'ToDeleted', '2024-01-01', '${employeeId}');
        update employees set deleted_at = now(), deleted_by = '${USER_HR_ADMIN}' where id = '${employeeId}';
      `);

      // All in one transaction — asUser() rolls back at the end of each
      // call, so a separate later call would never see this delete at all
      // (same reason the payroll-rejection regression test above stays in
      // one asUser block).
      await db.asUser(USER_HR_ADMIN, async (query) => {
        await query("select permanently_delete_employee($1)", [employeeId]);

        const employeeRow = await query("select id from employees where id = $1", [employeeId]);
        expect(employeeRow.rows).toEqual([]);

        for (const table of [
          "employment_contracts",
          "compensation_details",
          "identity_documents",
          "employee_loans",
          "employee_insurance_policies",
          "employee_career_events",
        ]) {
          const remaining = await query(`select 1 from ${table} where employee_id = $1`, [employeeId]);
          expect(remaining.rows).toEqual([]);
        }

        const reportRow = await query("select manager_id from employees where id = $1", [reportId]);
        expect(reportRow.rows[0]?.manager_id).toBeNull();
      });
    });

    it("frees the employee number immediately upon permanent delete, in the same transaction", async () => {
      const employeeId = await seedScratchEmployee("5");
      await db.seed(`update employees set deleted_at = now() where id = '${employeeId}';`);

      await db.asUser(USER_HR_ADMIN, async (query) => {
        await query("select permanently_delete_employee($1)", [employeeId]);

        const employeeRow = await query("select id from employees where id = $1", [employeeId]);
        expect(employeeRow.rows).toEqual([]);

        const { rows } = await query(
          "insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values ('PD-5', $1, 'AE', 'Reused', 'Number', '2024-01-01') returning id",
          [COMPANY_HQ],
        );
        expect(rows.length).toBe(1);
      });
    });
  });
});
