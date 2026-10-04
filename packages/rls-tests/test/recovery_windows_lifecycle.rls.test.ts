import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { computeCompDayExpiry } from "../../domain/src/compDayExpiry";
import { COMPANY_AE, COMPANY_OTHER, H, SYSTEM_ACTOR, createRecoveryFixtures, plusSeconds, type Person } from "../src/recoveryFixtures";

// Recovery windows — approvals, routing, readiness, corrections, ledger,
// concurrency, visibility. Same controlled-clock approach as
// recovery_windows_engine.rls.test.ts (see src/recoveryFixtures.ts).
//
// Most scenarios use a Saturday shift in AE (a weekly rest day, Mon-Fri week):
// 5h earns 0.5 day, 7h earns 1 day. 2027-01-09 is a Saturday.

const SAT = "2027-01-09T05:00:00Z"; // 09:00 Dubai

describe("Recovery windows — approvals, corrections, ledger, access", () => {
  const db = new RlsTestDatabase();
  const fx = createRecoveryFixtures(db);
  const { setClock, newPerson, seedSessions, recalc, windows, requests } = fx;

  let hr1: Person;
  let hr2: Person;
  let ceo: Person;
  let cto: Person;
  let hrOther: Person;

  beforeAll(async () => {
    await db.setup();
    await fx.setupDatabase();
    hr1 = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    hr2 = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    ceo = await newPerson(COMPANY_AE, "AE", ["ceo"]);
    cto = await newPerson(COMPANY_AE, "AE", ["cto"]);
    hrOther = await newPerson(COMPANY_OTHER, "AE", ["hr_admin"]);
    await newPerson(COMPANY_OTHER, "AE", ["ceo"]);
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  async function as<T>(person: Person, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.asUserCommit(person.userId, async (q) => (await q(sql, params)).rows as T[]);
  }
  async function asFails(person: Person, sql: string, params: unknown[], pattern: RegExp) {
    await expect(db.asUserCommit(person.userId, async (q) => q(sql, params))).rejects.toThrow(pattern);
  }
  async function approvalRows(requestId: string) {
    const { rows } = await db.seed(
      `select id, step_order, decision, approver_id, queue_roles::text[] as queue_roles from approvals where entity_type = 'recovery_credit' and entity_id = '${requestId}' order by step_order`,
    );
    return rows as Array<{ id: string; step_order: number; decision: string; approver_id: string | null; queue_roles: string[] | null }>;
  }
  async function ledger(person: Person) {
    const { rows } = await db.seed(
      `select id, entry_type, days::float8 as days, txn_date::text as txn_date, expiry_date::text as expiry_date, source, reference_id, reversal_of_id
       from comp_day_ledger where employee_id = '${person.employeeId}' order by created_at, ctid`,
    );
    return rows as Array<{ id: string; entry_type: string; days: number; txn_date: string; expiry_date: string | null; source: string; reference_id: string; reversal_of_id: string | null }>;
  }
  async function balance(person: Person): Promise<number> {
    const { rows } = await db.seed(`select coalesce(sum(days), 0)::float8 as b from comp_day_ledger where employee_id = '${person.employeeId}'`);
    return rows[0].b;
  }
  async function sessionIds(person: Person) {
    const { rows } = await db.seed(`select id, clock_in_at, clock_out_at from attendance_sessions where employee_id = '${person.employeeId}' order by clock_in_at`);
    return rows as Array<{ id: string; clock_in_at: Date; clock_out_at: Date | null }>;
  }

  /** A fresh employee with a real project lead and one closed Saturday shift, evaluated after it rested. */
  async function shiftWithLead(seconds: number, roles: string[] = [], opts: { start?: string; lead?: Person | "self" | "none"; mode?: string } = {}) {
    const person = await newPerson(COMPANY_AE, "AE", roles);
    const leadPerson = opts.lead === "self" ? person : opts.lead === "none" ? null : (opts.lead as Person | undefined) ?? (await newPerson(COMPANY_AE, "AE"));
    const start = opts.start ?? SAT;
    const end = plusSeconds(start, seconds);
    await setClock(plusSeconds(end, 9 * H));
    await seedSessions(person, [{ start, end, lead: leadPerson?.employeeId ?? null, project: leadPerson ? "Project X" : null, mode: opts.mode ?? (leadPerson ? "site_work" : "office") }]);
    await recalc(person);
    return { person, lead: leadPerson, ws: await windows(person), rs: await requests(person) };
  }

  /** Drives a request through its whole approval chain with the people the route names. */
  async function approveFully(person: Person, requestId: string, who: { hr?: Person; ceo?: Person } = {}) {
    for (let guard = 0; guard < 4; guard += 1) {
      const pending = (await approvalRows(requestId)).filter((a) => a.decision === "pending").sort((a, b) => a.step_order - b.step_order)[0];
      if (!pending) return;
      if (pending.approver_id) {
        const { rows } = await db.seed(`select id from employees where user_id = '${pending.approver_id}'`);
        await db.asUserCommit(pending.approver_id, async (q) => q("select decide_leave_approval($1, 'approved', 'lead ok')", [pending.id]));
        void rows;
      } else if (pending.queue_roles?.includes("ceo")) {
        await db.asUserCommit((who.ceo ?? ceo).userId, async (q) => q("select decide_leave_approval($1, 'approved', 'exec ok')", [pending.id]));
      } else {
        await db.asUserCommit((who.hr ?? hr1).userId, async (q) =>
          q("select decide_recovery_credit_request($1, 'approved', 'checked with the project lead', 'ok')", [requestId]),
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Group 11 — approval routes (retained exactly) and who may decide
  // ---------------------------------------------------------------------
  describe("approval routes", () => {
    it("ordinary employee + project lead: lead first, then HR, then the credit is posted once with a 180-day expiry", async () => {
      const { person, lead, rs } = await shiftWithLead(8 * H);
      expect(rs).toHaveLength(1);
      expect(rs[0]!.applicant_route).toBe("employee_lead_then_hr");
      let steps = await approvalRows(rs[0]!.id);
      expect(steps).toHaveLength(1);
      expect(steps[0]!.approver_id).toBe(lead!.userId);

      // HR cannot jump the queue and decide the lead's step
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'x', null)", [rs[0]!.id], /renewed project lead approval|Only an active|assigned approver/);

      await db.asUserCommit(lead!.userId, async (q) => q("select decide_leave_approval($1, 'approved', 'ok')", [steps[0]!.id]));
      steps = await approvalRows(rs[0]!.id);
      expect(steps.map((s) => [s.step_order, s.decision])).toEqual([[1, "approved"], [2, "pending"]]);
      expect(steps[1]!.queue_roles).toEqual(["hr_admin"]);
      expect((await ledger(person))).toHaveLength(0); // the lead's release credits nothing

      await as(hr1, "select decide_recovery_credit_request($1, 'approved', null, 'verified')", [rs[0]!.id]);
      const l = await ledger(person);
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ entry_type: "earned", days: 1, txn_date: "2027-01-09", expiry_date: "2027-07-08", source: "recovery_window" });
      expect((await requests(person))[0]!.status).toBe("approved");

      // deciding again is refused and never double-credits
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'x', null)", [rs[0]!.id], /No pending approval|already been decided/);
      expect(await ledger(person)).toHaveLength(1);
    });

    it("self-led: goes straight to HR, who must record whom they checked with", async () => {
      const { person, rs } = await shiftWithLead(8 * H, [], { lead: "self" });
      expect(rs[0]!.applicant_route).toBe("self_led_hr_direct");
      expect((await approvalRows(rs[0]!.id))[0]!.queue_roles).toEqual(["hr_admin"]);
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', null, null)", [rs[0]!.id], /Record whom you checked/);
      await as(hr1, "select decide_recovery_credit_request($1, 'approved', 'Checked with the site engineer', null)", [rs[0]!.id]);
      expect(await balance(person)).toBe(1);
    });

    it("permanent manager: goes straight to HR", async () => {
      const { rs } = await shiftWithLead(8 * H, ["line_manager"]);
      expect(rs[0]!.applicant_route).toBe("manager_hr_direct");
      expect((await approvalRows(rs[0]!.id))[0]!.queue_roles).toEqual(["hr_admin"]);
    });

    it("HR applicant: shared CEO/CTO queue — either executive may decide, HR (even another HR) may not, and nobody decides their own", async () => {
      const { person, rs } = await shiftWithLead(8 * H, ["hr_admin"]);
      expect(rs[0]!.applicant_route).toBe("hr_admin_ceo_cto_queue");
      const [step] = await approvalRows(rs[0]!.id);
      expect(step!.queue_roles).toEqual(["ceo", "cto"]);
      await asFails(hr2, "select decide_leave_approval($1, 'approved', null)", [step!.id], /Only an active ceo or cto/);
      await asFails(person, "select decide_leave_approval($1, 'approved', null)", [step!.id], /Only an active ceo or cto/);
      await asFails(hrOther, "select decide_leave_approval($1, 'approved', null)", [step!.id], /Only an active ceo or cto/);
      await as(cto, "select decide_leave_approval($1, 'approved', 'cto ok')", [step!.id]);
      expect(await balance(person)).toBe(1);
    });

    it("an applicant holding BOTH HR and manager roles still goes to the executive queue (HR takes precedence)", async () => {
      const { rs } = await shiftWithLead(8 * H, ["hr_admin", "line_manager"]);
      expect(rs[0]!.applicant_route).toBe("hr_admin_ceo_cto_queue");
    });

    it("a CEO's own credit needs no approver: it is approved automatically (decision 19), never routed to a project lead", async () => {
      const { person, rs } = await shiftWithLead(8 * H, ["ceo"]);
      // an executive has nobody above them: single-step route recorded, approved by the system
      expect(rs[0]!.applicant_route).toBe("self_led_hr_direct");
      expect(rs[0]!.status).toBe("approved");
      expect(rs[0]!.awaiting_project_lead).toBe(false);
      expect(await balance(person)).toBe(1);
    });

    it("missing project lead: the request waits (awaiting lead, no approval row) until the employee supplies one", async () => {
      const { person, rs } = await shiftWithLead(8 * H, [], { lead: "none" });
      expect(rs[0]).toMatchObject({ applicant_route: null, awaiting_project_lead: true });
      expect(await approvalRows(rs[0]!.id)).toHaveLength(0);
      const lead = await newPerson(COMPANY_AE, "AE");
      await as(person, "select resolve_recovery_credit_project_lead($1, $2)", [rs[0]!.id, lead.employeeId]);
      const after = (await requests(person))[0]!;
      expect(after).toMatchObject({ applicant_route: "employee_lead_then_hr", awaiting_project_lead: false });
      expect((await approvalRows(rs[0]!.id))[0]!.approver_id).toBe(lead.userId);
    });

    it("missing approver: shown as unresolved with a reason, never silently dropped, and routed automatically once an approver exists", async () => {
      const person = await newPerson(COMPANY_OTHER, "AE");
      const lead = await newPerson(COMPANY_OTHER, "AE");
      await setClock("2027-01-11T00:00:00Z");
      await seedSessions(person, [{ start: SAT, end: plusSeconds(SAT, 8 * H), lead: lead.employeeId, project: "P", mode: "site_work" }]);
      // company OTHER has an HR admin (hrOther) -> fine; remove them to simulate no approver
      await db.seed(`update user_roles set revoked_at = now() where user_id = '${hrOther.userId}'`);
      await recalc(person);
      const [r] = await requests(person);
      expect(r!.routing_issue).toMatch(/No HR Admin is currently available/);
      expect(await approvalRows(r!.id)).toHaveLength(0);
      await db.seed(`update user_roles set revoked_at = null where user_id = '${hrOther.userId}'`);
      await recalc(person); // the next engine pass retries routing
      const [fixed] = await requests(person);
      expect(fixed!.routing_issue).toBeNull();
      expect(await approvalRows(r!.id)).toHaveLength(1);
    });

    it("an HR applicant with no CEO/CTO available is unresolved with a reason", async () => {
      const hrApplicant = await newPerson(COMPANY_OTHER, "AE", ["hr_admin"]);
      await db.seed(`update user_roles set revoked_at = now() where company_id = '${COMPANY_OTHER}' and role in ('ceo','cto')`);
      await setClock("2027-01-12T00:00:00Z");
      await seedSessions(hrApplicant, [{ start: SAT, end: plusSeconds(SAT, 8 * H), lead: hrApplicant.employeeId, project: "P", mode: "site_work" }]);
      await recalc(hrApplicant);
      const [r] = await requests(hrApplicant);
      expect(r!.routing_issue).toMatch(/No eligible approver currently holds the ceo or cto/);
      await db.seed(`update user_roles set revoked_at = null where company_id = '${COMPANY_OTHER}' and role in ('ceo','cto')`);
    });

    it("an unrelated HR Admin from another company, and an unrelated colleague, cannot decide or even see the request", async () => {
      const { person, rs } = await shiftWithLead(8 * H, [], { lead: "self" });
      await asFails(hrOther, "select decide_recovery_credit_request($1, 'approved', 'x', null)", [rs[0]!.id], /Only an active hr_admin may decide/);
      const colleague = await newPerson(COMPANY_AE, "AE");
      await asFails(colleague, "select decide_recovery_credit_request($1, 'approved', 'x', null)", [rs[0]!.id], /Only an active hr_admin may decide/);
      expect(await as(colleague, "select id from recovery_credit_requests where id = $1", [rs[0]!.id])).toHaveLength(0);
      expect(await as(hrOther, "select id from recovery_credit_requests where id = $1", [rs[0]!.id])).toHaveLength(0);
      expect(await as(person, "select id from recovery_credit_requests where id = $1", [rs[0]!.id])).toHaveLength(1);
      expect(await as(hr1, "select id from recovery_credit_requests where id = $1", [rs[0]!.id])).toHaveLength(1);
    });

    it("several project leads/projects in one window: evidence of both is kept and HR verification is required", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const leadA = await newPerson(COMPANY_AE, "AE");
      const leadB = await newPerson(COMPANY_AE, "AE");
      await setClock("2027-01-12T00:00:00Z");
      await seedSessions(person, [
        { start: SAT, end: plusSeconds(SAT, 3 * H), lead: leadA.employeeId, project: "Alpha", mode: "site_work" },
        { start: plusSeconds(SAT, 4 * H), end: plusSeconds(SAT, 8 * H), lead: leadB.employeeId, project: "Beta", mode: "site_work" },
      ]);
      await recalc(person);
      const [w] = await windows(person);
      expect(w!.review_flags).toContain("multiple_leads");
      expect(w!.hr_verification_required).toBe(true);
      const { rows } = await db.seed(`select distinct project_lead_employee_id from recovery_window_allocations where window_id = '${w!.id}'`);
      expect(rows).toHaveLength(2);
      const [r] = await requests(person);
      expect(r!.needs_policy_review).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Group 10 — readiness is enforced in the database, not just in the UI
  // ---------------------------------------------------------------------
  describe("final approval readiness (database-enforced)", () => {
    it("refuses direct approval until HR has verified a window that requires it, then allows it", async () => {
      const { person, rs, ws } = await shiftWithLead(8 * H, [], { lead: "self", mode: "business_travel" });
      expect(ws[0]!.hr_verification_required).toBe(true);
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'checked', null)", [rs[0]!.id], /HR must verify this window/);
      const [step] = await approvalRows(rs[0]!.id);
      await asFails(hr1, "select decide_leave_approval($1, 'approved', null)", [step!.id], /HR must verify this window/); // the lower-level entry point too
      expect(await balance(person)).toBe(0);
      await asFails(hr1, "select hr_verify_recovery_window($1, '')", [ws[0]!.id], /Describe what you checked/);
      await asFails(hrOther, "select hr_verify_recovery_window($1, 'x')", [ws[0]!.id], /Only HR Admin may verify/);
      await as(hr1, "select hr_verify_recovery_window($1, 'Confirmed the journey was working time with the project lead')", [ws[0]!.id]);
      await as(hr1, "select decide_recovery_credit_request($1, 'approved', 'checked', null)", [rs[0]!.id]);
      expect(await balance(person)).toBe(1);
    });

    it("refuses approval of a request whose window has not closed", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 3 * H));
      await seedSessions(person, [{ start: SAT, end: null, lead: person.employeeId, project: "P", mode: "site_work" }]);
      await recalc(person);
      const [w] = await windows(person);
      expect(w!.status).toBe("open");
      // Hand-craft the kind of row a direct database caller might try to push through.
      const requestId = randomUUID();
      await db.seed(`
        insert into recovery_credit_requests (id, employee_id, segment_id, work_date, event_type, proposed_days, created_by, applicant_route, recovery_window_id, window_revision_no)
        select '${requestId}', '${person.employeeId}', segment_id, '2027-01-09', 'window', 1, '${SYSTEM_ACTOR}', 'self_led_hr_direct', '${w!.id}', 0
        from recovery_window_allocations where window_id = '${w!.id}' limit 1;
        insert into approvals (entity_type, entity_id, step_order, queue_roles, decision) values ('recovery_credit', '${requestId}', 1, array['hr_admin']::app_role[], 'pending');`);
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'x', null)", [requestId], /has not closed yet/);
      expect(await balance(person)).toBe(0);
    });

    it("refuses an approval whose amount no longer matches the evidence", async () => {
      const { person, rs, ws } = await shiftWithLead(8 * H, [], { lead: "self" });
      await db.seed(`update recovery_windows set entitlement_days = 0.5 where id = '${ws[0]!.id}'`); // simulate evidence moving under the request
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'x', null)", [rs[0]!.id], /evidence for this window changed/);
      expect(await balance(person)).toBe(0);
    });

    it("HR cannot override a window-based request by typing hours", async () => {
      const { rs } = await shiftWithLead(8 * H, [], { lead: "self" });
      await asFails(hr1, "select adjust_recovery_credit_request($1, '2027-01-09', 3, 'because', null)", [rs[0]!.id], /cannot be overridden by typing hours/);
    });
  });

  // ---------------------------------------------------------------------
  // Group 12 — idempotency, races, retries
  // ---------------------------------------------------------------------
  describe("idempotency and concurrency", () => {
    it("re-running the engine any number of times changes nothing", async () => {
      const { person } = await shiftWithLead(8 * H);
      const snapshot = async () => {
        const { rows } = await db.seed(`
          select (select count(*) from recovery_periods where employee_id = '${person.employeeId}')::int as periods,
                 (select count(*) from recovery_windows where employee_id = '${person.employeeId}')::int as windows,
                 (select count(*) from recovery_window_revisions r join recovery_windows w on w.id = r.window_id where w.employee_id = '${person.employeeId}')::int as revisions,
                 (select count(*) from recovery_credit_requests where employee_id = '${person.employeeId}')::int as requests,
                 (select count(*) from recovery_alerts where employee_id = '${person.employeeId}')::int as alerts,
                 (select count(*) from approvals a join recovery_credit_requests r on r.id = a.entity_id and a.entity_type = 'recovery_credit' where r.employee_id = '${person.employeeId}')::int as approvals`);
        return rows[0];
      };
      const before = await snapshot();
      for (let i = 0; i < 4; i += 1) await recalc(person);
      await db.seed("select recovery_process_due('test')");
      expect(await snapshot()).toEqual(before);
    });

    it("two engine runs racing for the same employee never create a duplicate window or request", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 20 * H));
      await seedSessions(person, [{ start: SAT, end: plusSeconds(SAT, 8 * H), lead: lead.employeeId, project: "P", mode: "site_work" }]);
      await Promise.all([recalc(person), recalc(person), recalc(person)]);
      expect(await windows(person)).toHaveLength(1);
      expect(await requests(person)).toHaveLength(1);
    });

    it("two approvers deciding the same request at once: exactly one wins and credit is posted at most once", async () => {
      const { person, rs } = await shiftWithLead(8 * H, [], { lead: "self" });
      const results = await Promise.allSettled([
        db.asUserCommit(hr1.userId, async (q) => q("select decide_recovery_credit_request($1, 'approved', 'checked', null)", [rs[0]!.id])),
        db.asUserCommit(hr2.userId, async (q) => q("select decide_recovery_credit_request($1, 'approved', 'checked', null)", [rs[0]!.id])),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ledger(person)).toHaveLength(1);
      expect(await balance(person)).toBe(1);
    });

    it("a rejected request is a final answer for that evidence: re-running never re-requests it", async () => {
      const { person, rs } = await shiftWithLead(8 * H, [], { lead: "self" });
      await as(hr1, "select decide_recovery_credit_request($1, 'rejected', 'not worked', 'no')", [rs[0]!.id]);
      for (let i = 0; i < 3; i += 1) await recalc(person);
      const all = await requests(person);
      expect(all).toHaveLength(1);
      expect(all[0]!.status).toBe("rejected");
    });
  });

  // ---------------------------------------------------------------------
  // Group 13-16 — corrections, ledger adjustments, evidence rules
  // ---------------------------------------------------------------------
  describe("corrections before approval", () => {
    it("0.5 -> 1 while still PENDING: the same request is updated, the original/corrected hours are kept, and the lead must approve again", async () => {
      const { person, lead, rs } = await shiftWithLead(5 * H);
      expect(rs[0]!.days).toBe(0.5);
      const [step] = await approvalRows(rs[0]!.id);
      await db.asUserCommit(lead!.userId, async (q) => q("select decide_leave_approval($1, 'approved', 'ok')", [step!.id]));
      expect((await approvalRows(rs[0]!.id)).map((s) => s.decision)).toEqual(["approved", "pending"]);

      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 20 * H));
      await asFails(hr1, "select hr_correct_attendance_session($1, $2, $3, '')", [session!.id, SAT, plusSeconds(SAT, 7 * H)], /A reason is required/);
      await asFails(hrOther, "select hr_correct_attendance_session($1, $2, $3, 'x')", [session!.id, SAT, plusSeconds(SAT, 7 * H)], /Only HR Admin may correct/);
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Forgot to clock out; confirmed with the lead')", [session!.id, SAT, plusSeconds(SAT, 7 * H)]);

      const all = await requests(person);
      expect(all).toHaveLength(1); // same request, not a second one
      expect(all[0]).toMatchObject({ id: rs[0]!.id, days: 1, window_revision_no: 2 });
      expect((await approvalRows(rs[0]!.id)).map((s) => [s.step_order, s.decision])).toEqual([[1, "pending"], [2, "pending"]]); // renewed lead approval
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', null, null)", [rs[0]!.id], /renewed project lead approval|assigned approver|No pending/);

      // original and corrected evidence side by side, with reason/actor
      const { rows: corr } = await db.seed(`select kind, original_clock_out_at, corrected_clock_out_at, reason, actor_id from attendance_session_corrections where session_id = '${session!.id}'`);
      expect(corr).toHaveLength(1);
      expect(corr[0].original_clock_out_at.toISOString()).toBe(plusSeconds(SAT, 5 * H));
      expect(corr[0].corrected_clock_out_at.toISOString()).toBe(plusSeconds(SAT, 7 * H));
      expect(corr[0].actor_id).toBe(hr1.userId);
      const { rows: revs } = await db.seed(`select r.revision_no, r.recorded_seconds::float8 as secs, r.entitlement_days::float8 as d, r.previous_facts, r.actor_id, r.reason, r.origin from recovery_window_revisions r join recovery_windows w on w.id = r.window_id where w.employee_id = '${person.employeeId}' order by r.revision_no`);
      expect(revs.map((r) => [r.revision_no, r.secs, r.d])).toEqual([[1, 5 * H, 0.5], [2, 7 * H, 1]]);
      expect(revs[1].previous_facts.recorded_seconds).toBe(5 * H);
      expect(revs[1].actor_id).toBe(hr1.userId);
      expect(revs[1].origin).toBe("hr_correction");
    });

    it("hours that change without the amount changing are still a recorded change (14h -> 15h, both 0.5 day)", async () => {
      const { person, rs } = await shiftWithLead(14 * H, [], { start: "2027-01-05T05:00:00Z" }); // Tuesday, normal day
      expect(rs[0]!.days).toBe(0.5);
      const [session] = await sessionIds(person);
      await setClock("2027-01-07T00:00:00Z");
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Adjusted by one hour after checking the site log')", [session!.id, "2027-01-05T05:00:00Z", plusSeconds("2027-01-05T05:00:00Z", 15 * H)]);
      const { rows } = await db.seed(`select r.revision_no, r.recorded_seconds::float8 as secs, r.entitlement_days::float8 as d from recovery_window_revisions r join recovery_windows w on w.id = r.window_id where w.employee_id = '${person.employeeId}' order by r.revision_no`);
      expect(rows.map((r) => [r.revision_no, r.secs, r.d])).toEqual([[1, 14 * H, 0.5], [2, 15 * H, 0.5]]);
    });

    it("a correction that takes a pending request to zero cancels it (zero-entitlement outcomes are supported)", async () => {
      const { person, rs } = await shiftWithLead(5 * H);
      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 20 * H));
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Only an hour was genuinely worked')", [session!.id, SAT, plusSeconds(SAT, 1 * H)]);
      expect((await requests(person))[0]!).toMatchObject({ id: rs[0]!.id, status: "cancelled" });
      expect((await windows(person))[0]!.days).toBe(0);
    });
  });

  describe("corrections after credit (ledger adjustments)", () => {
    it("0.5 credited, corrected to 1: ONLY +0.5 is requested, expiry is not extended, and repeating changes nothing", async () => {
      const { person, rs } = await shiftWithLead(5 * H, [], { lead: "self" });
      await approveFully(person, rs[0]!.id);
      expect((await ledger(person)).map((l) => [l.entry_type, l.days])).toEqual([["earned", 0.5]]);
      const original = (await ledger(person))[0]!;

      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 30 * H));
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Clock-out was missed by two hours')", [session!.id, SAT, plusSeconds(SAT, 7 * H)]);
      const reqs = await requests(person);
      expect(reqs.map((r) => [r.event_type, r.status, r.days])).toEqual([["window", "approved", 0.5], ["window_top_up", "submitted", 0.5]]);
      expect(reqs[1]!.adjusts_request_id).toBe(rs[0]!.id);
      expect(await balance(person)).toBe(0.5); // nothing more credited yet

      await approveFully(person, reqs[1]!.id);
      const l = await ledger(person);
      expect(l.map((x) => [x.entry_type, x.days])).toEqual([["earned", 0.5], ["earned", 0.5]]);
      expect(l[1]!.expiry_date).toBe(original.expiry_date); // never extends the same window's expiry
      expect(l[1]!.txn_date).toBe(original.txn_date);
      expect(await balance(person)).toBe(1);

      for (let i = 0; i < 3; i += 1) await recalc(person);
      expect(await requests(person)).toHaveLength(2); // repeat = 0 further
      expect(await balance(person)).toBe(1);
    });

    it("a downward correction BEFORE any use reverses and re-earns the remainder, keeping the original dates", async () => {
      const { person, rs } = await shiftWithLead(7 * H, [], { lead: "self" });
      await approveFully(person, rs[0]!.id);
      const original = (await ledger(person))[0]!;
      expect(original.days).toBe(1);
      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 30 * H));
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Lunch away from site was clocked in by mistake')", [session!.id, SAT, plusSeconds(SAT, 5 * H)]);
      const reqs = await requests(person);
      const reduction = reqs.find((r) => r.event_type === "window_reduction")!;
      expect(reduction).toMatchObject({ days: 0.5, status: "submitted" });
      await approveFully(person, reduction.id);
      const l = await ledger(person);
      expect(l.map((x) => [x.entry_type, x.days])).toEqual([["earned", 1], ["reversal", -1], ["earned", 0.5]]);
      expect(l[1]!.reversal_of_id).toBe(original.id);
      expect(l[2]).toMatchObject({ txn_date: original.txn_date, expiry_date: original.expiry_date });
      expect(await balance(person)).toBe(0.5);
    });

    it("a downward correction after the credit was USED needs an explicit HR acknowledgement — never a silent negative", async () => {
      const { person, rs } = await shiftWithLead(7 * H, [], { lead: "self" });
      await approveFully(person, rs[0]!.id);
      await db.seed(`insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, created_by) values ('${person.employeeId}', '2027-02-01', 'redeemed', -1, 'leave', '${hr1.userId}')`);
      expect(await balance(person)).toBe(0);

      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 30 * H));
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Reduced after review')", [session!.id, SAT, plusSeconds(SAT, 5 * H)]);
      const reduction = (await requests(person)).find((r) => r.event_type === "window_reduction")!;
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'checked', null)", [reduction.id], /already been used.*acknowledge/);
      await asFails(hr1, "select hr_acknowledge_recovery_reduction($1, '')", [reduction.id], /A note is required/);
      await asFails(hrOther, "select hr_acknowledge_recovery_reduction($1, 'x')", [reduction.id], /Only HR Admin/);
      await as(hr1, "select hr_acknowledge_recovery_reduction($1, 'Employee will repay half a day from next month')", [reduction.id]);
      await as(hr1, "select decide_recovery_credit_request($1, 'approved', 'checked', null)", [reduction.id]);
      expect(await balance(person)).toBe(-0.5); // explicit, acknowledged, auditable
    });

    it("corrected all the way to zero after approval: a full reduction request, balance returns to zero", async () => {
      const { person, rs } = await shiftWithLead(5 * H, [], { lead: "self" });
      await approveFully(person, rs[0]!.id);
      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 30 * H));
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Mostly personal time')", [session!.id, SAT, plusSeconds(SAT, 1 * H)]);
      const reduction = (await requests(person)).find((r) => r.event_type === "window_reduction")!;
      expect(reduction.days).toBe(0.5);
      await approveFully(person, reduction.id);
      expect(await balance(person)).toBe(0);
    });

    it("a correction that would move a period that already has an approved credit is refused and leaves everything untouched", async () => {
      const { person, rs } = await shiftWithLead(5 * H, [], { lead: "self" });
      await approveFully(person, rs[0]!.id);
      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 30 * H));
      await asFails(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Started earlier')", [session!.id, plusSeconds(SAT, -1 * H), plusSeconds(SAT, 5 * H)], /restructure the working period/);
      const { rows } = await db.seed(`select clock_in_at from attendance_sessions where id = '${session!.id}'`);
      expect(rows[0].clock_in_at.toISOString()).toBe(new Date(SAT).toISOString());
      expect((await requests(person))).toHaveLength(1);
    });
  });

  describe("expiry and consumption after adjustments", () => {
    it("a top-up never extends the window's 180-day expiry, and oldest-first consumption + the expiry sweep stay consistent", async () => {
      const { person, rs } = await shiftWithLead(5 * H, [], { lead: "self" });
      await approveFully(person, rs[0]!.id);
      const [session] = await sessionIds(person);
      await setClock(plusSeconds(SAT, 30 * H));
      await as(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Clock-out was missed')", [session!.id, SAT, plusSeconds(SAT, 7 * H)]);
      const topUp = (await requests(person)).find((r) => r.event_type === "window_top_up")!;
      await approveFully(person, topUp.id);
      const entries = await ledger(person);
      expect(entries.map((e) => e.expiry_date)).toEqual(["2027-07-08", "2027-07-08"]);

      // Half a day used: it is consumed from the pool oldest-first, and the sweep only expires what is left.
      await db.seed(`insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, created_by) values ('${person.employeeId}', '2027-02-01', 'redeemed', -0.5, 'leave', '${hr1.userId}')`);
      const all = await ledger(person);
      const postings = computeCompDayExpiry(
        all.map((e) => ({ id: e.id, entryType: e.entry_type as "earned", days: e.days, txnDate: e.txn_date, expiryDate: e.expiry_date })),
        "2027-07-09",
      );
      expect(postings.reduce((sum, p) => sum + p.expiredDays, 0)).toBe(0.5);
      // before the expiry date nothing expires
      expect(computeCompDayExpiry(all.map((e) => ({ id: e.id, entryType: e.entry_type as "earned", days: e.days, txnDate: e.txn_date, expiryDate: e.expiry_date })), "2027-07-07")).toHaveLength(0);
    });
  });

  describe("evidence rules for corrections and added attendance", () => {
    it("rejects a clock-out in the future, a clock-out before the clock-in, and overlapping recordings", async () => {
      const { person } = await shiftWithLead(5 * H);
      await setClock(plusSeconds(SAT, 20 * H));
      const [session] = await sessionIds(person);
      await asFails(hr1, "select hr_correct_attendance_session($1, $2, $3, 'x')", [session!.id, SAT, plusSeconds(SAT, 40 * H)], /cannot be in the future/);
      await asFails(hr1, "select hr_correct_attendance_session($1, $2, $3, 'x')", [session!.id, plusSeconds(SAT, 6 * H), SAT], /after the corrected clock-in/);
      // another recording for the same person that the first would overlap
      await seedSessions(person, [{ start: plusSeconds(SAT, 10 * H), end: plusSeconds(SAT, 12 * H) }]);
      await asFails(hr1, "select hr_correct_attendance_session($1, $2, $3, 'x')", [session!.id, SAT, plusSeconds(SAT, 11 * H)], /overlaps another recorded work segment/);
      await asFails(hr1, "select hr_add_missing_attendance($1, $2, $3, 'office', null, null, 'x')", [person.employeeId, plusSeconds(SAT, 11 * H), plusSeconds(SAT, 13 * H)], /overlaps another recorded work segment/);
    });

    it("'Add missing attendance' is recorded by HR, needs a reason, never looks like a live clock-in, and is calculated like any evidence", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 30 * H));
      await asFails(hr1, "select hr_add_missing_attendance($1, $2, $3, 'office', null, null, '')", [person.employeeId, SAT, plusSeconds(SAT, 5 * H)], /A reason is required/);
      await asFails(hrOther, "select hr_add_missing_attendance($1, $2, $3, 'office', null, null, 'x')", [person.employeeId, SAT, plusSeconds(SAT, 5 * H)], /Only HR Admin/);
      await asFails(hr1, "select hr_add_missing_attendance($1, $2, $3, 'office', null, null, 'x')", [person.employeeId, SAT, plusSeconds(SAT, 99 * H)], /cannot be in the future/);
      const [added] = await as<{ id: string }>(hr1, "select hr_add_missing_attendance($1, $2, $3, 'office', null, null, 'Employee forgot to clock; confirmed by the manager') as id", [person.employeeId, SAT, plusSeconds(SAT, 5 * H)]);
      const id = added!.id;
      const { rows } = await db.seed(`select status, recorded_by_hr, recorded_by_hr_reason, recovery_model from attendance_sessions where id = '${id}'`);
      expect(rows[0]).toMatchObject({ status: "closed", recorded_by_hr: true, recovery_model: "windowed" });
      expect((await windows(person))[0]).toMatchObject({ days: 0.5, status: "closed" });
      expect((await windows(person))[0]!.review_flags).toContain("hr_recorded");
      const open = await db.seed(`select count(*)::int as n from attendance_sessions where employee_id = '${person.employeeId}' and status = 'open'`);
      expect(open.rows[0].n).toBe(0);
    });

    it("a forgotten clock-out closed by HR is flagged and needs explicit HR verification before any credit", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 60 * H));
      await seedSessions(person, [{ start: SAT, end: null, lead: person.employeeId, project: "P", mode: "site_work" }]);
      await recalc(person);
      const [session] = await sessionIds(person);
      await asFails(hr1, "select hr_close_attendance_session($1, $2, 'forgot')", [session!.id, plusSeconds(SAT, 90 * H)], /cannot be in the future/);
      await as(hr1, "select hr_close_attendance_session($1, $2, 'Employee left at five and forgot to clock out')", [session!.id, plusSeconds(SAT, 8 * H)]);
      const [w] = await windows(person);
      expect(w!.review_flags).toContain("forgotten_clock_out");
      expect(w!.hr_verification_required).toBe(true);
      expect(w!.days).toBe(1);
      // The open session had already rolled over into later windows; once HR corrected
      // the end of the shift, those later windows' requests were cancelled.
      const all = await requests(person);
      expect(all.filter((x) => x.status === "cancelled").length).toBe(all.length - 1);
      const r = all.find((x) => x.status !== "cancelled")!;
      await asFails(hr1, "select decide_recovery_credit_request($1, 'approved', 'checked', null)", [r!.id], /HR must verify this window/);
    });

    it("an overlapping manual daily entry or approved leave is shown as a conflict and needs verification — never silently overwritten", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await db.seed(`insert into attendance_records (employee_id, work_date, status, source, hours_worked) values ('${person.employeeId}', '2027-01-09', 'present', 'manual', 8)`);
      const lead = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 30 * H));
      await seedSessions(person, [{ start: SAT, end: plusSeconds(SAT, 5 * H), lead: lead.employeeId, project: "P", mode: "site_work" }]);
      await recalc(person);
      const [w] = await windows(person);
      expect(w!.review_flags).toContain("manual_conflict");
      expect(w!.hr_verification_required).toBe(true);
      const { rows } = await db.seed(`select status, source, hours_worked::float8 as h from attendance_records where employee_id = '${person.employeeId}' and work_date = '2027-01-09'`);
      expect(rows[0]).toEqual({ status: "present", source: "manual", h: 8 }); // the manual record is untouched

      const onLeave = await newPerson(COMPANY_AE, "AE");
      await db.seed(`begin; set local session_replication_role = replica;
        insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days, status) values ('${onLeave.employeeId}', 'annual', '2027-01-07', '2027-01-11', 3, 'approved');
        commit;`);
      await seedSessions(onLeave, [{ start: SAT, end: plusSeconds(SAT, 5 * H), lead: lead.employeeId, project: "P", mode: "site_work" }]);
      await recalc(onLeave);
      expect((await windows(onLeave))[0]!.review_flags).toContain("leave_conflict");
    });

    it("the manual daily register never creates a window-policy credit from a typed total, and flags it for review instead", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const { rows } = await db.asUserCommit(hr1.userId, async (q) =>
        q("select * from record_attendance_and_recovery('2027-01-09', $1::jsonb)", [JSON.stringify([{ employee_id: person.employeeId, status: "present", work_mode: "office", hours_worked: 8 }])]),
      );
      expect(rows[0]).toMatchObject({ credited: false, needs_policy_review: true });
      const { rows: reqs } = await db.seed(`select count(*)::int as n from recovery_credit_requests where employee_id = '${person.employeeId}'`);
      expect(reqs[0].n).toBe(0);
    });
  });
});
