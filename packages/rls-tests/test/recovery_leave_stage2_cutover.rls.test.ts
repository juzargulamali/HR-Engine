import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Executes the REAL, unmodified
// supabase/manual-sql/recovery_leave_hr_queue_stage2_cutover.sql file — not
// a paraphrase of it — against a database built to look exactly like an
// existing Production company: seeded under the OLD (pre-this-PR)
// seed_default_approval_workflows(), a 2-step 'direct_manager' ->
// 'role:hr_admin' recovery_credit chain, with a real request already
// pending at step 1 the moment the cutover runs. This is the one scenario
// the cutover script's own header exists to protect (see its own "This
// matters for one specific case" comment) — this test proves it actually
// holds against the real file, not just its doc comment.
//
// Also proves the "single-step queue" wording only ever describes this
// LEGACY manual-attendance-register/overnight family's own routing —
// create_initial_approval()'s self-clock 4-tier branch (applicant_route is
// not null) returns before ever reaching the approval_workflows lookup this
// cutover script's new/old workflow rows apply to, so an ordinary
// employee's self-clock employee_lead_then_hr route can never be bypassed
// by it. See attendance_clocking_and_recovery_routing.rls.test.ts for that
// route's own full coverage — this file only re-confirms the boundary from
// the legacy side.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const NEW_MIGRATION = "20261106000000_recovery_leave_hr_queue_and_self_clock_attendance.sql";
const CUTOVER_SQL_PATH = path.join(REPO_ROOT, "supabase", "manual-sql", "recovery_leave_hr_queue_stage2_cutover.sql");
const GRANT_AUTHENTICATED_ACCESS_PATH = path.join(REPO_ROOT, "supabase", "tests", "grant-authenticated-access.sql");

async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY_A = "00000000-0000-0000-0000-0000000d0a01";

const USER_MANAGER = "00000000-0000-0000-0000-0000000d0a11";
const USER_WORKER = "00000000-0000-0000-0000-0000000d0a12";
const USER_HR1 = "00000000-0000-0000-0000-0000000d0a13";
const USER_HR2 = "00000000-0000-0000-0000-0000000d0a14";

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000d0a21";
const EMPLOYEE_WORKER = "00000000-0000-0000-0000-0000000d0a22";

describe("Stage 2 cutover: the real manual-sql script against a live in-flight legacy request", () => {
  const db = new RlsTestDatabase();
  let oldWorkflowId: string;
  let inFlightRequestId: string;
  let step1ApprovalId: string;
  let capturedWorkflowIdBefore: string;
  let capturedApproverIdBefore: string;

  beforeAll(async () => {
    // Build the database up to, but NOT including, this PR's own migration
    // — this is what an existing Production company actually looks like
    // today: seeded under the OLD 2-step direct_manager -> role:hr_admin
    // seed_default_approval_workflows() (20261101000000_leave_policy_
    // configuration.sql's own version, the last one ever applied there).
    await db.setupBefore(NEW_MIGRATION);
    // setupBefore() deliberately skips this (it only belongs after every
    // migration has run) — needed here so asUser()'s "authenticated" role
    // actually has the grants RLS assumes, at this intermediate baseline.
    await db.seed(readFileSync(GRANT_AUTHENTICATED_ACCESS_PATH, "utf8"));

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_MANAGER}', 'cut-manager@enginious.ae'),
        ('${USER_WORKER}', 'cut-worker@enginious.ae'),
        ('${USER_HR1}', 'cut-hr1@enginious.ae'),
        ('${USER_HR2}', 'cut-hr2@enginious.ae');

      insert into countries (code, name, default_currency, working_weekdays) values ('CT', 'Cutoverland', 'CTD', array[1,2,3,4,5])
      on conflict (code) do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${COMPANY_A}', 'Cutover Co', 'CT', 'CTD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'CUT-01', '${COMPANY_A}', 'CT', 'Mona', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_WORKER}', '${USER_WORKER}', 'CUT-02', '${COMPANY_A}', 'CT', 'Wale', 'Worker', '2024-01-01');
      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_WORKER}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR1}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_HR2}', 'hr_admin', '${COMPANY_A}');
    `);

    // The company-creation trigger just seeded the OLD 2-step workflow.
    const oldWf = await db.seed(
      `select id from approval_workflows where company_id = '${COMPANY_A}' and entity_type = 'recovery_credit' and is_active = true`,
    );
    expect(oldWf.rows).toHaveLength(1);
    oldWorkflowId = oldWf.rows[0].id;
    const oldSteps = await db.seed(
      `select step_order, approver_type from approval_workflow_steps where workflow_id = '${oldWorkflowId}' order by step_order`,
    );
    expect(oldSteps.rows).toEqual([
      { step_order: 1, approver_type: "direct_manager" },
      { step_order: 2, approver_type: "role:hr_admin" },
    ]);

    // HR records a qualifying weekend day worked for the worker -> a real
    // recovery_credit_requests row, pending at step 1 (the manager),
    // against the OLD workflow_id -- exactly the in-flight state the
    // cutover's own header comment is about.
    await db.asUserCommit(USER_HR1, (query) =>
      query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
        "2027-09-04", // a Saturday
        JSON.stringify([{ employee_id: EMPLOYEE_WORKER, status: "present", work_mode: "office", hours_worked: 8 }]),
      ]),
    );
    const step1 = await db.seed(`
      select r.id as request_id, a.id as approval_id, a.workflow_id, a.approver_id from approvals a
      join recovery_credit_requests r on r.id = a.entity_id
      where a.entity_type = 'recovery_credit' and r.employee_id = '${EMPLOYEE_WORKER}' and a.step_order = 1
    `);
    expect(step1.rows).toHaveLength(1);
    inFlightRequestId = step1.rows[0].request_id;
    step1ApprovalId = step1.rows[0].approval_id;
    capturedWorkflowIdBefore = step1.rows[0].workflow_id;
    capturedApproverIdBefore = step1.rows[0].approver_id;
    expect(capturedWorkflowIdBefore).toBe(oldWorkflowId);
    expect(capturedApproverIdBefore).toBe(USER_MANAGER);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("applies the new migration, then the real cutover script leaves the in-flight approval byte-identical", async () => {
    await db.applyMigration(NEW_MIGRATION);

    // Run the ACTUAL file, unmodified -- this is the artifact the user runs
    // by hand in the Supabase SQL Editor, not a re-typed summary of it.
    const cutoverSql = readFileSync(CUTOVER_SQL_PATH, "utf8");
    await db.seed(cutoverSql);

    // The in-flight approval must be untouched: same id, same workflow_id,
    // same approver_id, still step_order 1, still pending.
    const after = await db.seed(
      `select id, workflow_id, approver_id, step_order, decision from approvals where id = '${step1ApprovalId}'`,
    );
    expect(after.rows).toEqual([
      { id: step1ApprovalId, workflow_id: capturedWorkflowIdBefore, approver_id: capturedApproverIdBefore, step_order: 1, decision: "pending" },
    ]);

    // The OLD workflow row itself: retired (is_active = false), but its OWN
    // steps are completely unedited -- the cutover only ever INSERTs a new
    // workflow, never UPDATEs the old one's steps.
    const oldWfAfter = await db.seed(`select is_active from approval_workflows where id = '${oldWorkflowId}'`);
    expect(oldWfAfter.rows).toEqual([{ is_active: false }]);
    const oldStepsAfter = await db.seed(
      `select step_order, approver_type from approval_workflow_steps where workflow_id = '${oldWorkflowId}' order by step_order`,
    );
    expect(oldStepsAfter.rows).toEqual([
      { step_order: 1, approver_type: "direct_manager" },
      { step_order: 2, approver_type: "role:hr_admin" },
    ]);

    // Exactly one NEW active workflow for the company, single step,
    // role_queue:hr_admin -- this is what "single-step queue" refers to.
    const newWf = await db.seed(
      `select aw.id, aws.step_order, aws.approver_type from approval_workflows aw
       join approval_workflow_steps aws on aws.workflow_id = aw.id
       where aw.company_id = '${COMPANY_A}' and aw.entity_type = 'recovery_credit' and aw.is_active = true`,
    );
    expect(newWf.rows).toEqual([{ id: newWf.rows[0].id, step_order: 1, approver_type: "role_queue:hr_admin" }]);
    expect(newWf.rows[0].id).not.toBe(oldWorkflowId);
  });

  it("the in-flight request keeps advancing through its ORIGINAL 2-step chain after the cutover, never the new queue", async () => {
    // The manager (step 1's own resolved approver) approves through the
    // SAME entry point the real UI uses for every recovery_credit decision
    // (decide_recovery_credit_request(), never decide_leave_approval()
    // directly) -- must advance to a NEW step 2 resolved against the OLD
    // workflow's own second step ('role:hr_admin', a single resolved
    // approver_id), never the new queue_roles mechanism, since
    // decide_leave_approval() looks up the next step by the approval's own
    // (unchanged) workflow_id. applicant_route is null for this legacy
    // request, so "checked with" is required to approve.
    await db.asUserCommit(USER_MANAGER, (query) =>
      query("select decide_recovery_credit_request($1, 'approved', 'Confirmed the work directly')", [inFlightRequestId]),
    );

    const step2 = await db.seed(`
      select a.id, a.workflow_id, a.approver_id, a.queue_roles, a.step_order, a.decision from approvals a
      join recovery_credit_requests r on r.id = a.entity_id
      where a.entity_type = 'recovery_credit' and r.employee_id = '${EMPLOYEE_WORKER}' and a.step_order = 2
    `);
    expect(step2.rows).toHaveLength(1);
    expect(step2.rows[0].workflow_id).toBe(oldWorkflowId);
    expect(step2.rows[0].queue_roles).toBeNull();
    // role:hr_admin resolves to a SPECIFIC person (resolve_approver()) --
    // never null/queue-shaped, confirming this in-flight request was never
    // exposed to the new role_queue:hr_admin mechanism at all.
    expect(step2.rows[0].approver_id).not.toBeNull();
    const step2ApproverId = step2.rows[0].approver_id as string;

    await db.asUserCommit(step2ApproverId, (query) =>
      query("select decide_recovery_credit_request($1, 'approved', 'Checked with the manager directly')", [inFlightRequestId]),
    );
    const finalStatus = await db.seed(`select status, comp_day_ledger_id is not null as credited from recovery_credit_requests where id = '${inFlightRequestId}'`);
    expect(finalStatus.rows).toEqual([{ status: "approved", credited: true }]);
  });

  it("a NEW legacy request submitted for the same company AFTER the cutover uses the new single-step queue, decidable by any current HR Admin", async () => {
    await db.asUserCommit(USER_HR1, (query) =>
      query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
        "2027-09-11", // a different Saturday
        JSON.stringify([{ employee_id: EMPLOYEE_WORKER, status: "present", work_mode: "office", hours_worked: 8 }]),
      ]),
    );
    const step1New = await db.seed(`
      select r.id as request_id, a.workflow_id, a.approver_id, a.queue_roles, a.step_order from approvals a
      join recovery_credit_requests r on r.id = a.entity_id
      where a.entity_type = 'recovery_credit' and r.employee_id = '${EMPLOYEE_WORKER}' and r.work_date = '2027-09-11'
    `);
    expect(step1New.rows).toHaveLength(1);
    expect(step1New.rows[0].approver_id).toBeNull();
    expect(step1New.rows[0].queue_roles).toBeNull(); // legacy role_queue:% stays approval_workflow_steps-driven, not queue_roles
    expect(step1New.rows[0].step_order).toBe(1);
    const newRequestId = step1New.rows[0].request_id as string;

    // The OTHER HR Admin (never assigned anything) may still decide it --
    // proving it is genuinely a queue, not accidentally still resolved to
    // one earliest-granted person.
    await db.asUserCommit(USER_HR2, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked directly')", [newRequestId]));
    const finalStatus = await db.seed(`select status from recovery_credit_requests where id = '${newRequestId}'`);
    expect(finalStatus.rows).toEqual([{ status: "approved" }]);
  });
});
