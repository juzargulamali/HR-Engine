import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { COMPANY_AE, COMPANY_OTHER, H, createRecoveryFixtures, plusSeconds, type Person } from "../src/recoveryFixtures";

// A15 / D-14. Two gaps on the Approvals page for Recovery Leave:
//   (1) a project lead who decides step 1 sees the applicant's name as "—": the page read it from `employees`, which a lead (not a manager) cannot read;
//   (2) a CEO / CTO deciding an HR Admin's request on the shared queue gets no card at all: they cannot read the queue approval row (approvals_select looks the
//       request up under the caller's own row-level security) nor the request row (recovery_credit_requests_select has no CEO / CTO branch), so the page says
//       "Nothing waiting on you" although the database would let them decide.
// recovery_decider_inbox(ids) returns, for a request the CALLER is authorised to decide RIGHT NOW (a pending approval assigned to them, or a pending queue
// step whose role they hold in the applicant's company; never the applicant), the minimum the card shows: the applicant's name, company and country and the request's
// own dates, amount, route and window link. Nothing else is widened: the table's policy, routing and calculations are unchanged.

const SAT = "2027-01-09T05:00:00Z"; // a Saturday in AE

describe("Recovery Leave approval cards for the people who decide (A15)", () => {
  const db = new RlsTestDatabase();
  const fx = createRecoveryFixtures(db);
  const { setClock, newPerson, seedSessions, recalc, requests } = fx;
  let hr1: Person, hr2: Person, ceo: Person, cto: Person, hrOther: Person, ceoOther: Person, outsider: Person;

  const as = <T = Record<string, any>>(p: Person, sql: string, params: unknown[] = []) => db.asUser(p.userId, async (q) => (await q(sql, params)).rows as T[]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const cards = (p: Person, ids: string[]) => as<{ id: string; approval_id: string; employee_id: string; employee_name: string }>(p, "select * from recovery_decider_inbox($1::uuid[])", [ids]);

  async function shift(roles: string[] = [], lead?: Person) {
    const person = await newPerson(COMPANY_AE, "AE", roles);
    const leadPerson = lead ?? (await newPerson(COMPANY_AE, "AE"));
    const end = plusSeconds(SAT, 8 * H);
    await setClock(plusSeconds(end, 9 * H));
    await seedSessions(person, [{ start: SAT, end, lead: leadPerson.employeeId, project: "Project X", mode: "site_work" }]);
    await recalc(person);
    return { person, lead: leadPerson, request: (await requests(person))[0]! };
  }

  beforeAll(async () => {
    await db.setup();
    await fx.setupDatabase();
    hr1 = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    hr2 = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    ceo = await newPerson(COMPANY_AE, "AE", ["ceo"]);
    cto = await newPerson(COMPANY_AE, "AE", ["cto"]);
    hrOther = await newPerson(COMPANY_OTHER, "AE", ["hr_admin"]);
    ceoOther = await newPerson(COMPANY_OTHER, "AE", ["ceo"]);
    outsider = await newPerson(COMPANY_AE, "AE");
  }, 60_000);
  afterAll(async () => db.teardown());

  describe("the project lead's step", () => {
    it("REPRODUCED: the lead cannot read the applicant's name from employees, though they can read the request itself", async () => {
      const { person, lead, request } = await shift();
      expect(await as(lead, `select id from employees where id = '${person.employeeId}'`)).toEqual([]);
      expect((await as(lead, `select id from recovery_credit_requests where id = '${request.id}'`))).toHaveLength(1);
    });

    it("the lead gets the applicant's name, company and the request's dates and amount while the lead's step is pending", async () => {
      const { person, lead, request } = await shift();
      const rows = await as<Record<string, any>>(lead, "select * from recovery_decider_inbox($1::uuid[])", [[request.id]]); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: request.id, employee_id: person.employeeId, employee_name: expect.stringMatching(/^Emp\d+ Test$/), company_id: COMPANY_AE, country_code: "AE", applicant_route: "employee_lead_then_hr" });
      expect(new Date(rows[0]!.work_date).toISOString().slice(0, 10)).toBe("2027-01-09");
      expect(Number(rows[0]!.proposed_days)).toBe(request.days);
    });

    it("returns only the fields the card shows (no checked-with notes, correction reasons or segment ids)", async () => {
      const { lead, request } = await shift();
      const rows = await as<Record<string, any>>(lead, "select * from recovery_decider_inbox($1::uuid[])", [[request.id]]); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(Object.keys(rows[0]!).sort()).toEqual([
        "applicant_route", "approval_created_at", "approval_id", "approver_id", "attendance_record_id", "company_id", "consumption_ack_at", "corrected_at", "country_code",
        "employee_id", "employee_name", "event_type", "id", "needs_policy_review", "project_lead_employee_id", "project_name", "proposed_days", "queue_roles",
        "recovery_window_id", "routing_issue", "step_order", "work_date", "work_mode", "workflow_id",
      ]);
    });

    it("nobody else gets the card: not another employee, not HR Admin (not the decider of the lead's step), not the applicant, not another company's lead", async () => {
      const { person, request } = await shift();
      for (const who of [outsider, hr1, person, hrOther, ceo]) expect(await cards(who, [request.id]), who.userId).toEqual([]);
    });

    it("once the lead has decided, the lead no longer gets the card (only a PENDING decision is shown)", async () => {
      const { lead, request } = await shift();
      const step = (await db.seed(`select id from approvals where entity_type = 'recovery_credit' and entity_id = '${request.id}' and step_order = 1`)).rows[0].id as string;
      await db.asUserCommit(lead.userId, async (q) => q("select decide_leave_approval($1, 'approved', 'ok')", [step]));
      expect(await cards(lead, [request.id])).toEqual([]);
    });
  });

  describe("the shared CEO / CTO queue for an HR Admin's own request", () => {
    it("REPRODUCED: the CEO can read neither the request row nor the queue approval row, so the page had nothing to list", async () => {
      const { request } = await shift(["hr_admin"]);
      expect(request.applicant_route).toBe("hr_admin_ceo_cto_queue");
      for (const who of [ceo, cto]) {
        expect(await as(who, `select id from recovery_credit_requests where id = '${request.id}'`)).toEqual([]);
        expect(await as(who, `select id from approvals where entity_type = 'recovery_credit' and entity_id = '${request.id}'`)).toEqual([]);
      }
    });

    it("the CEO and the CTO of the company get the card (name, dates, amount, window link)", async () => {
      const { person, request } = await shift(["hr_admin"]);
      for (const who of [ceo, cto]) {
        const rows = await cards(who, [request.id]);
        expect(rows, who.userId).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: request.id, employee_id: person.employeeId });
      }
    });

    it("refused when calling the function directly: another HR Admin, the applicant, an ordinary employee, and the CEO / HR Admin of another company", async () => {
      const { person, request } = await shift(["hr_admin"]);
      for (const who of [hr1, hr2, person, outsider, ceoOther, hrOther]) expect(await cards(who, [request.id]), who.userId).toEqual([]);
    });

    it("the tables' own policies are unchanged: the CEO still cannot read recovery_credit_requests or the queue approval directly", async () => {
      const { request } = await shift(["hr_admin"]);
      expect(await as(ceo, `select count(*)::int as n from recovery_credit_requests where id = '${request.id}'`)).toEqual([{ n: 0 }]);
      expect(await as(ceo, `select count(*)::int as n from approvals where entity_id = '${request.id}'`)).toEqual([{ n: 0 }]);
    });

    it("with no list the inbox returns every request the caller decides now, each with its approval (the page lists it from this)", async () => {
      const { request } = await shift(["hr_admin"]);
      const mine = await as<Record<string, any>>(ceo, "select * from recovery_decider_inbox()"); // eslint-disable-line @typescript-eslint/no-explicit-any
      const row = mine.find((r) => r.id === request.id)!;
      expect(row).toBeTruthy();
      expect(row).toMatchObject({ approver_id: null, queue_roles: "{ceo,cto}", step_order: 1 });
      expect(row.approval_id).toBe((await db.seed(`select id from approvals where entity_id = '${request.id}'`)).rows[0].id);
      // the same call by an ordinary employee returns nothing at all
      expect(await as(outsider, "select * from recovery_decider_inbox()")).toEqual([]);
    });

    it("routing and the decision are unchanged: the CTO still decides, HR still cannot", async () => {
      const { request } = await shift(["hr_admin"]);
      const step = (await db.seed(`select id from approvals where entity_type = 'recovery_credit' and entity_id = '${request.id}' and step_order = 1`)).rows[0].id as string;
      await expect(db.asUserCommit(hr2.userId, async (q) => q("select decide_leave_approval($1, 'approved', null)", [step]))).rejects.toThrow(/Only an active ceo or cto/);
      await db.asUserCommit(cto.userId, async (q) => q("select decide_leave_approval($1, 'approved', 'ok')", [step]));
      expect(await cards(cto, [request.id])).toEqual([]);
    });
  });

  describe("HR Admin's queue (manager or self-led applicant)", () => {
    it("an HR Admin of the company gets the card for the HR step; HR of another company and an ordinary employee do not", async () => {
      const { request } = await shift(["line_manager"]);
      expect(request.applicant_route).toBe("manager_hr_direct");
      for (const who of [hr1, hr2]) expect(await cards(who, [request.id]), who.userId).toHaveLength(1);
      for (const who of [hrOther, outsider, ceo]) expect(await cards(who, [request.id]), who.userId).toEqual([]);
    });
  });

  it("an empty or unknown list returns nothing, and an anonymous caller is refused", async () => {
    expect(await cards(hr1, [])).toEqual([]);
    expect(await cards(hr1, ["00000000-0000-0000-0000-00000000dead"])).toEqual([]);
    await expect(db.asUser(null, async (q) => q("select * from recovery_decider_inbox($1::uuid[])", [[]]))).rejects.toThrow(/permission denied/);
  });
});
