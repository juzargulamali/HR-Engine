import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { COMPANY_AE, H, createRecoveryFixtures, plusSeconds, type Person } from "../src/recoveryFixtures";

// CEO/CTO requests need no approver (docs/08-decisions-log.md, decision 19):
//   * their LEAVE is approved on submission (through decide_leave_approval(), so
//     the ledger work is the normal one);
//   * their reimbursement CLAIMS go straight to Finance;
//   * their Recovery Leave credit is approved automatically when nothing blocks
//     it, and goes to the HR queue otherwise.
// Every other applicant keeps the existing routing — asserted below too.

const SAT = "2027-01-09T05:00:00Z"; // a Saturday (weekly rest day) in AE, 09:00 Dubai

describe("CEO/CTO requests need no approver", () => {
  const db = new RlsTestDatabase();
  const fx = createRecoveryFixtures(db);
  const { setClock, newPerson, seedSessions, recalc, requests } = fx;

  let hr: Person;
  let finance: Person;
  let ceo: Person;
  let cto: Person;
  let manager: Person;
  let report: Person;

  beforeAll(async () => {
    await db.setup();
    await fx.setupDatabase();
    hr = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    finance = await newPerson(COMPANY_AE, "AE", ["finance"]);
    ceo = await newPerson(COMPANY_AE, "AE", ["ceo"]);
    cto = await newPerson(COMPANY_AE, "AE", ["cto"]);
    manager = await newPerson(COMPANY_AE, "AE", ["line_manager"]);
    report = await newPerson(COMPANY_AE, "AE");
    await db.seed(`
      update employees set manager_id = '${manager.employeeId}' where id = '${report.employeeId}';
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('${randomUUID()}', 'AE', 'leave_rules', 97, '2020-01-01', 'active', '{}'::jsonb, '${hr.userId}', '${ceo.userId}', now());
    `);
    // the policy_leave_types row must hang off the policy just created
    await db.seed(`
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
        select id, 'annual', 'Annual Leave', 'monthly_accrual' from policy_versions where policy_type = 'leave_rules' and version_no = 97;
    `);
    for (const p of [ceo, cto, report]) {
      await db.seed(`insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by)
                     values ('${p.employeeId}', 'annual', '2026-01-01', 'accrual', 10, '${hr.userId}')`);
    }
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  async function submitLeave(p: Person, start: string, end: string, days: number) {
    return db.asUserCommit(p.userId, async (q) => {
      const r = await q("select submit_leave_request('annual', $1, $2, false, false, $3, null) as id", [start, end, days]);
      return r.rows[0].id as string;
    });
  }
  async function leaveState(id: string) {
    const { rows: req } = await db.seed(`select status from leave_requests where id = '${id}'`);
    const { rows: apr } = await db.seed(`select step_order, decision, approver_id, comments from approvals where entity_type = 'leave_request' and entity_id = '${id}' order by step_order`);
    return { status: req[0].status as string, approvals: apr as Array<{ step_order: number; decision: string; approver_id: string; comments: string | null }> };
  }
  async function annualBalance(p: Person): Promise<number> {
    const { rows } = await db.seed(`select coalesce(sum(amount_days), 0)::float8 as b from leave_ledger where employee_id = '${p.employeeId}' and leave_type_code = 'annual'`);
    return rows[0].b;
  }

  describe("leave", () => {
    it("a CEO's leave is approved on submission and the balance is deducted exactly as for any approved leave", async () => {
      const before = await annualBalance(ceo);
      const id = await submitLeave(ceo, "2027-03-02", "2027-03-03", 2);
      const s = await leaveState(id);
      expect(s.status).toBe("approved");
      expect(s.approvals).toHaveLength(1);
      expect(s.approvals[0]).toMatchObject({ step_order: 1, decision: "approved" });
      expect(s.approvals[0]!.comments).toMatch(/Approved automatically/);
      expect(await annualBalance(ceo)).toBe(before - 2);
    });

    it("works for a CTO too, and needs no other executive to exist", async () => {
      const id = await submitLeave(cto, "2027-03-09", "2027-03-09", 1);
      expect((await leaveState(id)).status).toBe("approved");
    });

    it("an employee's leave still goes to their manager and stays pending", async () => {
      const id = await submitLeave(report, "2027-03-16", "2027-03-16", 1);
      const s = await leaveState(id);
      expect(s.status).toBe("submitted");
      expect(s.approvals).toHaveLength(1);
      expect(s.approvals[0]).toMatchObject({ decision: "pending", approver_id: manager.userId });
    });

    it("an employee with no manager keeps the existing fallback: the request goes to a CEO/CTO and stays pending", async () => {
      const orphan = await newPerson(COMPANY_AE, "AE");
      const id = await submitLeave(orphan, "2027-03-23", "2027-03-23", 1);
      const s = await leaveState(id);
      expect(s.status).toBe("submitted");
      expect(s.approvals).toHaveLength(1);
      expect(s.approvals[0]!.decision).toBe("pending");
      expect([ceo.userId, cto.userId]).toContain(s.approvals[0]!.approver_id);
    });
  });

  describe("reimbursement claims", () => {
    async function submitClaim(p: Person) {
      return db.asUserCommit(p.userId, async (q) => {
        const c = await q("insert into reimbursement_claims (employee_id, currency) values ($1, 'AED') returning id", [p.employeeId]);
        const claimId = c.rows[0].id as string;
        await q("update reimbursement_claims set status = 'submitted' where id = $1", [claimId]);
        const a = await q("select create_initial_approval('reimbursement_claim', $1) as id", [claimId]);
        return { claimId, approvalId: a.rows[0].id as string };
      });
    }
    async function approver(approvalId: string) {
      const { rows } = await db.seed(`select approver_id, decision from approvals where id = '${approvalId}'`);
      return rows[0] as { approver_id: string; decision: string };
    }

    it("a CEO's claim goes straight to Finance", async () => {
      const { approvalId } = await submitClaim(ceo);
      expect(await approver(approvalId)).toEqual({ approver_id: finance.userId, decision: "pending" });
    });

    it("an employee's claim still goes to their manager", async () => {
      const { approvalId } = await submitClaim(report);
      expect(await approver(approvalId)).toEqual({ approver_id: manager.userId, decision: "pending" });
    });
  });

  describe("i_am_c_level()", () => {
    it("is true for a CEO and a CTO, false for everyone else, and is about the caller only", async () => {
      const ask = (p: Person) => db.asUserCommit(p.userId, async (q) => (await q("select i_am_c_level($1) as v", [COMPANY_AE])).rows[0].v as boolean);
      expect(await ask(ceo)).toBe(true);
      expect(await ask(cto)).toBe(true);
      expect(await ask(hr)).toBe(false);
      expect(await ask(report)).toBe(false);
    });

    it("the two-argument helper is not callable by a signed-in user", async () => {
      await expect(db.asUserCommit(report.userId, async (q) => q("select is_c_level($1, $2)", [ceo.userId, COMPANY_AE]))).rejects.toThrow(/permission denied/);
    });
  });

  describe("Recovery Leave credit", () => {
    async function shift(person: Person, seconds: number, mode = "office") {
      const end = plusSeconds(SAT, seconds);
      await setClock(plusSeconds(end, 9 * H));
      await seedSessions(person, [{ start: SAT, end, mode }]);
      await recalc(person);
      return requests(person);
    }
    async function creditBalance(p: Person): Promise<number> {
      const { rows } = await db.seed(`select coalesce(sum(days), 0)::float8 as b from comp_day_ledger where employee_id = '${p.employeeId}'`);
      return rows[0].b;
    }

    it("a CEO's credit is approved automatically when nothing blocks it, with no approver and no lead", async () => {
      const exec = await newPerson(COMPANY_AE, "AE", ["ceo"]);
      const rs = await shift(exec, 8 * H);
      expect(rs).toHaveLength(1);
      expect(rs[0]!.status).toBe("approved");
      expect(rs[0]!.awaiting_project_lead).toBe(false);
      expect(await creditBalance(exec)).toBe(1);
      const { rows } = await db.seed(`select decision, comments from approvals where entity_type = 'recovery_credit' and entity_id = '${rs[0]!.id}'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decision: "approved" });
      expect(rows[0].comments).toMatch(/Approved automatically/);
    });

    it("a CEO who also holds HR Admin is treated as an executive (auto-approved), not as an HR applicant", async () => {
      const both = await newPerson(COMPANY_AE, "AE", ["ceo", "hr_admin"]);
      const rs = await shift(both, 8 * H);
      expect(rs[0]!.status).toBe("approved");
      expect(await creditBalance(both)).toBe(1);
    });

    it("a window that needs HR verification (business travel) is NOT auto-approved: it waits in the HR queue", async () => {
      const exec = await newPerson(COMPANY_AE, "AE", ["cto"]);
      const rs = await shift(exec, 8 * H, "business_travel");
      expect(rs).toHaveLength(1);
      expect(rs[0]!.status).not.toBe("approved");
      expect(await creditBalance(exec)).toBe(0);
      const { rows } = await db.seed(`select decision, queue_roles::text[] as queue_roles from approvals where entity_type = 'recovery_credit' and entity_id = '${rs[0]!.id}'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decision: "pending", queue_roles: ["hr_admin"] });
    });

    it("a correction an HR Admin makes after the credit was approved goes to the HR queue: a human decides it, never the auto-approval", async () => {
      const exec = await newPerson(COMPANY_AE, "AE", ["ceo"]);
      const first = await shift(exec, 5 * H);
      expect(first[0]).toMatchObject({ status: "approved", days: 0.5 });
      expect(await creditBalance(exec)).toBe(0.5);

      const { rows: sessions } = await db.seed(`select id from attendance_sessions where employee_id = '${exec.employeeId}'`);
      await setClock(plusSeconds(SAT, 30 * H));
      await db.asUserCommit(hr.userId, async (q) =>
        q("select hr_correct_attendance_session($1, $2, $3, 'Clock-out was missed by two hours')", [sessions[0].id, SAT, plusSeconds(SAT, 7 * H)]),
      );
      const reqs = await requests(exec);
      const topUp = reqs.find((r) => r.event_type === "window_top_up")!;
      expect(topUp.status).not.toBe("approved");
      expect(await creditBalance(exec)).toBe(0.5); // nothing more credited until HR decides
      const { rows } = await db.seed(`select decision, queue_roles::text[] as queue_roles from approvals where entity_type = 'recovery_credit' and entity_id = '${topUp.id}'`);
      expect(rows).toEqual([{ decision: "pending", queue_roles: ["hr_admin"] }]);
    });

    it("an ordinary employee's credit is unchanged: it still needs a lead and HR", async () => {
      const lead = await newPerson(COMPANY_AE, "AE");
      const emp = await newPerson(COMPANY_AE, "AE");
      const end = plusSeconds(SAT, 8 * H);
      await setClock(plusSeconds(end, 9 * H));
      await seedSessions(emp, [{ start: SAT, end, lead: lead.employeeId, project: "Project X", mode: "site_work" }]);
      await recalc(emp);
      const rs = await requests(emp);
      expect(rs[0]!.status).not.toBe("approved");
      expect(rs[0]!.applicant_route).toBe("employee_lead_then_hr");
      expect(await creditBalance(emp)).toBe(0);
    });
  });
});
