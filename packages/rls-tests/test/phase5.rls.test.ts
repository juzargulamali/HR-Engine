import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

const COMPANY_A = "00000000-0000-0000-0000-0000000005a1";

const USER_MANAGER = "00000000-0000-0000-0000-0000000005b1";
const USER_REPORT = "00000000-0000-0000-0000-0000000005b2";
const USER_HR = "00000000-0000-0000-0000-0000000005b3";
const USER_FINANCE = "00000000-0000-0000-0000-0000000005b4";
const USER_PEER = "00000000-0000-0000-0000-0000000005b5";
const USER_SYSADMIN = "00000000-0000-0000-0000-0000000005b6";

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000005c1";
const EMPLOYEE_REPORT = "00000000-0000-0000-0000-0000000005c2";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-0000000005c3";

/** date/timestamp columns come back from `pg` as JS Date objects, not strings. */
function toIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

describe("Phase 5 row-level security: performance, checklists, documents, assets", () => {
  const db = new RlsTestDatabase();
  const cycleId = randomUUID();

  beforeAll(async () => {
    await db.setup();

    // Every row here is seeded via db.seed() (the admin pool, which
    // persists) rather than db.asUser() (which always rolls back) — this
    // is all "arrange" state later tests depend on, not the specific
    // access-control behavior under test.
    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_MANAGER}', 'p5-manager@enginious.ae'),
        ('${USER_REPORT}', 'p5-report@enginious.ae'),
        ('${USER_HR}', 'p5-hr@enginious.ae'),
        ('${USER_FINANCE}', 'p5-finance@enginious.ae'),
        ('${USER_PEER}', 'p5-peer@enginious.ae'),
        ('${USER_SYSADMIN}', 'p5-sysadmin@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Phase 5 Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'P5-01', '${COMPANY_A}', 'ZZ', 'Mira', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'P5-02', '${COMPANY_A}', 'ZZ', 'Remo', 'Report', '2024-02-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'P5-03', '${COMPANY_A}', 'ZZ', 'Pat', 'Peer', '2024-02-01');
      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_REPORT}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_FINANCE}', 'finance', '${COMPANY_A}');
      insert into user_roles (user_id, role) values ('${USER_SYSADMIN}', 'sys_admin');

      insert into performance_cycles (id, company_id, name, period_start, period_end)
        values ('${cycleId}', '${COMPANY_A}', '2026 H1', '2026-01-01', '2026-06-30');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("goals", () => {
    it("lets an employee insert their own goal", async () => {
      await db.asUser(USER_REPORT, async (query) => {
        const { rows } = await query(
          "insert into goals (employee_id, cycle_id, title, self_rating) values ($1, $2, 'Ship the thing', 4) returning id",
          [EMPLOYEE_REPORT, cycleId],
        );
        expect(rows.length).toBe(1);
      });
    });

    it("lets the manager and HR Admin read a report's goal; blocks an unrelated peer", async () => {
      const goalId = randomUUID();
      await db.seed(`insert into goals (id, employee_id, cycle_id, title) values ('${goalId}', '${EMPLOYEE_REPORT}', '${cycleId}', 'Ship the thing');`);

      const managerView = await db.asUser(USER_MANAGER, (query) => query("select id from goals where id = $1", [goalId]));
      expect(managerView.rows.length).toBe(1);

      const hrView = await db.asUser(USER_HR, (query) => query("select id from goals where id = $1", [goalId]));
      expect(hrView.rows.length).toBe(1);

      const peerView = await db.asUser(USER_PEER, (query) => query("select id from goals where id = $1", [goalId]));
      expect(peerView.rows).toEqual([]);
    });

    it("lets the manager set manager_rating on a report's goal", async () => {
      const goalId = randomUUID();
      await db.seed(`insert into goals (id, employee_id, cycle_id, title) values ('${goalId}', '${EMPLOYEE_REPORT}', '${cycleId}', 'Another goal');`);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("update goals set manager_rating = 5 where id = $1", [goalId]);
        const check = await query("select manager_rating from goals where id = $1", [goalId]);
        expect(check.rows[0]?.manager_rating).toBe(5);
      });
    });
  });

  describe("appraisals: separate RLS tier, Finance excluded entirely", () => {
    it("blocks Finance from seeing appraisal content, even as a general read", async () => {
      const appraisalId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, overall_rating, strengths, status)
        values ('${appraisalId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 4, 'Great work', 'submitted');
      `);
      const financeView = await db.asUser(USER_FINANCE, (query) => query("select id from appraisals where id = $1", [appraisalId]));
      expect(financeView.rows).toEqual([]);
    });

    it("hides a draft appraisal from the employee until it's submitted", async () => {
      const appraisalId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, status)
        values ('${appraisalId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 'draft');
      `);
      const employeeView = await db.asUser(USER_REPORT, (query) => query("select id from appraisals where id = $1", [appraisalId]));
      expect(employeeView.rows).toEqual([]);

      const appraiserView = await db.asUser(USER_MANAGER, (query) => query("select id from appraisals where id = $1", [appraisalId]));
      expect(appraiserView.rows.length).toBe(1);
    });

    it("lets the employee acknowledge a submitted appraisal but never edit its content", async () => {
      const appraisalId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, overall_rating, strengths, status)
        values ('${appraisalId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 3, 'Solid quarter', 'submitted');
      `);

      await expect(
        db.asUser(USER_REPORT, (query) =>
          query("update appraisals set status = 'acknowledged', overall_rating = 5 where id = $1", [appraisalId]),
        ),
      ).rejects.toThrow(/only acknowledge/);

      await db.asUser(USER_REPORT, async (query) => {
        await query("update appraisals set status = 'acknowledged' where id = $1", [appraisalId]);
        const after = await query("select status, overall_rating from appraisals where id = $1", [appraisalId]);
        expect(after.rows[0]?.status).toBe("acknowledged");
        expect(after.rows[0]?.overall_rating).toBe(3);
      });
    });

    it("lets HR Admin write/calibrate any appraisal regardless of who the appraiser is", async () => {
      const appraisalId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, overall_rating, status)
        values ('${appraisalId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 3, 'submitted');
      `);
      await db.asUser(USER_HR, async (query) => {
        await query("update appraisals set overall_rating = 4 where id = $1", [appraisalId]);
        const check = await query("select overall_rating from appraisals where id = $1", [appraisalId]);
        expect(check.rows[0]?.overall_rating).toBe(4);
      });
    });

    it("lets the appraiser delete their own draft, but never a submitted appraisal", async () => {
      const draftId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, status)
        values ('${draftId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 'draft');
      `);
      await db.asUser(USER_MANAGER, async (query) => {
        const { rowCount } = await query("delete from appraisals where id = $1", [draftId]);
        expect(rowCount).toBe(1);
      });

      const submittedId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, status)
        values ('${submittedId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 'submitted');
      `);
      await db.asUser(USER_MANAGER, async (query) => {
        const { rowCount } = await query("delete from appraisals where id = $1", [submittedId]);
        expect(rowCount).toBe(0); // RLS silently filters rather than throwing on a no-match delete
        const stillThere = await query("select id from appraisals where id = $1", [submittedId]);
        expect(stillThere.rows.length).toBe(1);
      });
    });

    it("blocks a peer from deleting someone else's draft appraisal", async () => {
      const draftId = randomUUID();
      await db.seed(`
        insert into appraisals (id, employee_id, cycle_id, appraiser_id, status)
        values ('${draftId}', '${EMPLOYEE_REPORT}', '${cycleId}', '${USER_MANAGER}', 'draft');
      `);
      await db.asUser(USER_PEER, async (query) => {
        const { rowCount } = await query("delete from appraisals where id = $1", [draftId]);
        expect(rowCount).toBe(0);
      });
    });
  });

  describe("onboarding checklist generation and assignee-scoped access", () => {
    const templateId = randomUUID();

    beforeAll(async () => {
      await db.seed(`
        insert into checklist_templates (id, company_id, kind, name) values ('${templateId}', '${COMPANY_A}', 'onboarding', 'Standard onboarding');
        insert into checklist_template_items (template_id, step_order, task_name, assignee_role, due_offset_days) values
          ('${templateId}', 1, 'Sign contract', 'hr_admin', 0),
          ('${templateId}', 2, 'Assign workstation', 'line_manager', 1),
          ('${templateId}', 3, 'Provision IT access', 'sys_admin', 2);
      `);
    });

    it("generates one employee_checklist_items row per template item with due dates offset from the anchor date", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from generate_checklist_items($1, $2, '2026-03-01')", [EMPLOYEE_PEER, templateId]);
        expect(rows.length).toBe(3);
        const dueDates = rows.map((r) => toIsoDate(r.due_date)).sort();
        expect(dueDates).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
      });
    });

    /** Looks up a generated item for `employeeId` by its template step's assignee_role, not row position. */
    async function itemAssignedTo(employeeId: string, assigneeRole: string) {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query(
          `select eci.id from employee_checklist_items eci
           join checklist_template_items cti on cti.id = eci.template_item_id
           where eci.employee_id = $1 and cti.assignee_role = $2`,
          [employeeId, assigneeRole],
        ),
      );
      return rows[0]?.id as string;
    }

    it("lets the assigned manager see and complete the line_manager-assigned item, but not the sys_admin one", async () => {
      // Remo's (EMPLOYEE_REPORT's) manager is Mira (EMPLOYEE_MANAGER) — Pat
      // (EMPLOYEE_PEER, used above) has no manager set, so this scenario
      // needs Remo. Seeded directly (bypasses RLS) since this is arrange,
      // not the behavior under test — generate_checklist_items() calling
      // itself correctly under a real HR Admin's RLS is already proven by
      // the test above.
      await db.seed(`select * from generate_checklist_items('${EMPLOYEE_REPORT}', '${templateId}', '2026-03-01');`);

      const managerItemId = await itemAssignedTo(EMPLOYEE_REPORT, "line_manager");
      const sysAdminItemId = await itemAssignedTo(EMPLOYEE_REPORT, "sys_admin");

      const managerView = await db.asUser(USER_MANAGER, (query) => query("select id from employee_checklist_items where id = $1", [managerItemId]));
      expect(managerView.rows.length).toBe(1);

      const managerViewOfSysAdminItem = await db.asUser(USER_MANAGER, (query) =>
        query("select id from employee_checklist_items where id = $1", [sysAdminItemId]),
      );
      expect(managerViewOfSysAdminItem.rows).toEqual([]);

      const sysAdminView = await db.asUser(USER_SYSADMIN, (query) => query("select id from employee_checklist_items where id = $1", [sysAdminItemId]));
      expect(sysAdminView.rows.length).toBe(1);
    });

    it("lets the assigned manager mark their item done", async () => {
      // Insert one item directly against the line_manager template step,
      // rather than via generate_checklist_items() (which would create a
      // whole second set of 3 items for the same employee).
      const { rows: templateItemRows } = await db.asUser(USER_HR, (query) =>
        query("select id from checklist_template_items where template_id = $1 and assignee_role = 'line_manager'", [templateId]),
      );
      const templateItemId = templateItemRows[0]?.id as string;

      const managerItemId = randomUUID();
      await db.seed(`
        insert into employee_checklist_items (id, employee_id, template_item_id, kind, due_date)
        values ('${managerItemId}', '${EMPLOYEE_REPORT}', '${templateItemId}', 'onboarding', '2026-04-02');
      `);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("update employee_checklist_items set status = 'done', completed_at = now() where id = $1", [managerItemId]);
        const after = await query("select status from employee_checklist_items where id = $1", [managerItemId]);
        expect(after.rows[0]?.status).toBe("done");
      });
    });
  });

  describe("employee_documents", () => {
    it("lets HR Admin insert a document row for an employee", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query(
          "insert into employee_documents (employee_id, document_type, file_path, expiry_date) values ($1, 'visa', 'x/y/z.pdf', '2026-12-31') returning id",
          [EMPLOYEE_REPORT],
        );
        expect(rows.length).toBe(1);
      });
    });

    it("lets the owner read their own document; blocks a peer", async () => {
      const docId = randomUUID();
      await db.seed(`
        insert into employee_documents (id, employee_id, document_type, file_path, expiry_date)
        values ('${docId}', '${EMPLOYEE_REPORT}', 'visa', 'x/y/z.pdf', '2026-12-31');
      `);

      const ownerView = await db.asUser(USER_REPORT, (query) => query("select id from employee_documents where id = $1", [docId]));
      expect(ownerView.rows.length).toBe(1);

      const peerView = await db.asUser(USER_PEER, (query) => query("select id from employee_documents where id = $1", [docId]));
      expect(peerView.rows).toEqual([]);
    });

    it("blocks the employee themselves from uploading their own document row (HR Admin only)", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query("insert into employee_documents (employee_id, document_type, file_path) values ($1, 'certificate', 'a/b/c.pdf')", [
            EMPLOYEE_REPORT,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("document expiry reminder de-duplication", () => {
    it("rejects a second reminders-sent row for the same document and lead_days pair", async () => {
      const docId = randomUUID();
      await db.seed(`
        insert into employee_documents (id, employee_id, document_type, file_path, expiry_date)
          values ('${docId}', '${EMPLOYEE_REPORT}', 'visa', 'x/y/z.pdf', '2026-12-31');
        insert into document_expiry_reminders_sent (employee_document_id, lead_days) values ('${docId}', 30);
      `);
      await expect(
        db.seed(`insert into document_expiry_reminders_sent (employee_document_id, lead_days) values ('${docId}', 30);`),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  describe("document_expiry_reminder_rules: HR Admin only, not even a plain employee", () => {
    it("blocks a non-HR-Admin from reading the reminder configuration", async () => {
      await db.seed(`insert into document_expiry_reminder_rules (company_id, document_type, lead_days) values ('${COMPANY_A}', 'visa', 30);`);
      const employeeView = await db.asUser(USER_REPORT, (query) => query("select id from document_expiry_reminder_rules"));
      expect(employeeView.rows).toEqual([]);

      const sysAdminView = await db.asUser(USER_SYSADMIN, (query) => query("select id from document_expiry_reminder_rules"));
      expect(sysAdminView.rows.length).toBeGreaterThan(0);

      const hrView = await db.asUser(USER_HR, (query) => query("select id from document_expiry_reminder_rules"));
      expect(hrView.rows.length).toBeGreaterThan(0);
    });
  });

  describe("notifications: strictly own, not even HR Admin reads someone else's", () => {
    it("blocks HR Admin from reading another user's notification", async () => {
      const notifId = randomUUID();
      await db.seed(`insert into notifications (id, user_id, type, payload) values ('${notifId}', '${USER_REPORT}', 'document_expiring', '{}'::jsonb);`);

      const ownerView = await db.asUser(USER_REPORT, (query) => query("select id from notifications where id = $1", [notifId]));
      expect(ownerView.rows.length).toBe(1);

      const hrView = await db.asUser(USER_HR, (query) => query("select id from notifications where id = $1", [notifId]));
      expect(hrView.rows).toEqual([]);
    });

    it("lets the owner mark their own notification read", async () => {
      const notifId = randomUUID();
      await db.seed(`insert into notifications (id, user_id, type, payload) values ('${notifId}', '${USER_REPORT}', 'document_expiring', '{}'::jsonb);`);

      await db.asUser(USER_REPORT, async (query) => {
        await query("update notifications set read_at = now() where id = $1", [notifId]);
        const after = await query("select read_at from notifications where id = $1", [notifId]);
        expect(after.rows[0]?.read_at).not.toBeNull();
      });
    });
  });

  describe("assets", () => {
    it("keeps the general asset register HR Admin/Finance only — a plain employee can't browse it", async () => {
      await db.seed(`insert into assets (company_id, asset_tag, category) values ('${COMPANY_A}', 'LAP-001', 'laptop');`);
      const employeeView = await db.asUser(USER_REPORT, (query) => query("select id from assets where company_id = $1", [COMPANY_A]));
      expect(employeeView.rows).toEqual([]);

      const financeView = await db.asUser(USER_FINANCE, (query) => query("select id from assets where company_id = $1", [COMPANY_A]));
      expect(financeView.rows.length).toBeGreaterThan(0);
    });

    it("lets an employee see the specific asset issued to them once assigned", async () => {
      const assetId = randomUUID();
      await db.seed(`
        insert into assets (id, company_id, asset_tag, category) values ('${assetId}', '${COMPANY_A}', 'LAP-002', 'laptop');
        insert into asset_assignments (asset_id, employee_id, issued_by) values ('${assetId}', '${EMPLOYEE_REPORT}', '${USER_HR}');
      `);

      const ownerView = await db.asUser(USER_REPORT, (query) => query("select id from assets where id = $1", [assetId]));
      expect(ownerView.rows.length).toBe(1);

      const peerView = await db.asUser(USER_PEER, (query) => query("select id from assets where id = $1", [assetId]));
      expect(peerView.rows).toEqual([]);
    });
  });
});
