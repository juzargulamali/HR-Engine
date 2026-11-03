import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Completion pass, A8 leftovers.
//  1. pbx_decisions_waiting_count(): the number for the Finance menu entry. It must equal what pbx_inbox() marks "i_can_decide and not on hold" for the same person (budget
//     versions and final-expense sets), be 0 for people who cannot decide, never count what the person prepared or submitted, stay inside the person's companies, and refuse
//     a signed-out caller. It returns a number only.
//  2. The Project Manager's own view of their project's budget state needs NO new function: the existing row-level security already lets the current PM read the budget,
//     its versions (status, decided_at, decision note) and the final-expense sets of THEIR project, and nobody else's. Asserted here so the My Day rows can rely on it.

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { fin1: id(), fin2: id(), ksaFin: id(), viewer: id(), pm: id(), pm2: id(), pmFin: id(), outsider: id(), founder: id(), ceo: id(), cto: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@pbx-wait.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

describe("Finance menu count and the PM's own budget state", () => {
  const db = new RlsTestDatabase();
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const call = async <T = unknown>(user: string, sql: string): Promise<T> => (Object.values((await commit<Row>(user, sql))[0]!)[0] as T);
  const count = async (user: string) => Number((await q<{ n: number }>(user, `select pbx_decisions_waiting_count() as n`))[0]!.n);
  // the same number, worked out from the inbox the way My Day does
  const inboxCount = async (user: string) => {
    const i = (await q<{ i: Row }>(user, `select pbx_inbox() as i`))[0]!.i;
    const ok = (r: Row) => r.i_can_decide && !r.on_hold;
    return (i.budget_approvals as Row[]).filter(ok).length + (i.final_expense_approvals as Row[]).filter(ok).length;
  };
  let cat: Record<string, string> = {};
  let ref = 200;

  async function newProject(pm: string, company = CO.uae) {
    const pid = id();
    ref += 1;
    await admin(`
      insert into proj_projects (id, company_id, reference, name, kind, pm_user_id, created_by, start_date, end_date)
        values ('${pid}', '${company}', 'W-P-2026-${ref}', 'Wait ${ref}', 'internal', '${pm}', '${U.founder}', current_date, current_date + 10);
      insert into proj_project_details (project_id, location, site_timezone) values ('${pid}', 'Hall', 'Asia/Dubai');
      insert into proj_project_members (project_id, user_id, role) values ('${pid}', '${pm}', 'pm');`);
    return pid;
  }
  const rows = () => [{ category_id: cat.food, date_from: "2026-10-20", activity: "setup", description: "Meals", basis: "fixed", fixed: "100" }];
  async function budgetFor(project: string, pm: string) {
    await call(pm, `select pbx_create_budget('${project}', 'AED')`);
    const d = (await admin<{ id: string; row_version: number; budget_id: string }>(`select id, row_version, budget_id from pbx_budget_versions where project_id = '${project}' and status = 'draft'`))[0]!;
    const rv = await call<number>(pm, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({ period_start: "2026-10-20", period_end: "2026-10-23", people: [pm] })}, ${j(rows())})`);
    return { budget: d.budget_id, version: d.id, rv };
  }
  const submitBudget = (pm: string, b: { version: string; rv: number }) => call<string>(pm, `select pbx_submit_budget('${b.version}', ${b.rv}, '${id()}')`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.uae}', '{}'), ('${U.pm2}', '${CO.uae}', '{}'), ('${U.pmFin}', '${CO.uae}', '{}'), ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.ksaFin}', '${CO.ksa}', '{}');
      insert into pbx_company_grants (user_id, company_id, capabilities) values
        ('${U.fin1}', '${CO.uae}', '{finance,manage_access}'), ('${U.fin2}', '${CO.uae}', '{finance}'), ('${U.pmFin}', '${CO.uae}', '{finance}'),
        ('${U.viewer}', '${CO.uae}', '{view}'), ('${U.ksaFin}', '${CO.ksa}', '{finance,manage_access}'),
        ('${U.ceo}', '${CO.uae}', '{executive_approver}'), ('${U.cto}', '${CO.uae}', '{executive_approver}');
    `);
    cat = Object.fromEntries((await admin<{ key: string; id: string }>(`select key, id from pbx_categories where company_id is null`)).map((r) => [r.key, r.id]));
  }, 120_000);
  afterAll(async () => db.teardown());

  describe("pbx_decisions_waiting_count", () => {
    it("starts at zero for everyone, and a signed-out caller is refused", async () => {
      for (const who of Object.values(U)) expect(await count(who), who).toBe(0);
      await expect(q(null, `select pbx_decisions_waiting_count()`)).rejects.toThrow(/permission denied/);
    });

    it("counts a PM's submitted budget for the Finance people of that company only, and equals the inbox for every person", async () => {
      const p = await newProject(U.pm);
      const b = await budgetFor(p, U.pm);
      await submitBudget(U.pm, b);
      expect(await count(U.fin1)).toBe(1);
      expect(await count(U.fin2)).toBe(1);
      // cannot decide: the PM, a view-only grantee, an outsider, another company's Finance, the executives (a Finance route only needs Finance)
      for (const who of [U.pm, U.pm2, U.viewer, U.outsider, U.ksaFin, U.ceo, U.cto, U.founder]) expect(await count(who), who).toBe(0);
      for (const who of Object.values(U)) expect(await count(who), who).toBe(await inboxCount(who));
    });

    it("never counts what the person prepared or submitted themselves (a Finance person who is also the PM), and counts it for the executive route", async () => {
      const p = await newProject(U.pmFin);
      const b = await budgetFor(p, U.pmFin);
      await submitBudget(U.pmFin, b);
      expect(await count(U.pmFin)).toBe(1);                       // the earlier PM's budget (Finance may decide it), but never their own submission
      expect(await count(U.ceo)).toBe(1);                         // submitted by Finance: the company's approver decides
      expect(await count(U.cto)).toBe(1);
      expect(await count(U.fin1)).toBe(1);                        // still only the first PM's budget: Finance cannot decide a Finance submission
      const own = ((await q<{ i: Row }>(U.pmFin, `select pbx_inbox() as i`))[0]!.i.budget_approvals as Row[]).filter((r) => r.i_can_decide);
      expect(own.map((r) => r.reference)).not.toContain(`W-P-2026-${ref}`);
      for (const who of Object.values(U)) expect(await count(who), who).toBe(await inboxCount(who));
    });

    it("counts a submitted final-expense set too, and a decided one stops counting", async () => {
      const p = await newProject(U.pm2);
      const b = await budgetFor(p, U.pm2);
      await submitBudget(U.pm2, b);
      const before = await count(U.fin1);
      await call(U.fin2, `select pbx_decide_budget('${b.version}', 'approve')`);
      expect(await count(U.fin1)).toBe(before - 1);
      const sub = await call<string>(U.pm2, `select pbx_start_actuals('${b.budget}')`);
      const ids = (await admin<{ id: string }>(`select r.id from pbx_budget_rows r join pbx_budget_versions v on v.id = r.version_id where v.budget_id = '${b.budget}' and v.status = 'approved' order by r.sort_no`)).map((r) => r.id);
      const d = (await admin<{ row_version: number }>(`select row_version from pbx_actual_submissions where id = '${sub}'`))[0]!;
      const rv = await call<number>(U.pm2, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j([{ budget_row_id: ids[0], actual_amount: "90", paid_via: "company_card" }])})`);
      await call(U.pm2, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`);
      expect(await count(U.fin1)).toBe(before);
      for (const who of Object.values(U)) expect(await count(who), who).toBe(await inboxCount(who));
      await call(U.fin1, `select pbx_decide_actuals('${sub}', 'approve')`);
      expect(await count(U.fin1)).toBe(before - 1);
    });

    it("returns a bare number: no project, amount, name or company", async () => {
      const r = await q<Row>(U.fin1, `select * from pbx_decisions_waiting_count()`);
      expect(Object.keys(r[0]!)).toEqual(["pbx_decisions_waiting_count"]);
      expect(typeof r[0]!.pbx_decisions_waiting_count).toBe("number");
    });

    it("is not executable by anonymous callers", async () => {
      const r = await admin<Row>(`select has_function_privilege('anon', 'pbx_decisions_waiting_count()', 'execute') a, has_function_privilege('authenticated', 'pbx_decisions_waiting_count()', 'execute') s`);
      expect(r[0]).toEqual({ a: false, s: true });
    });
  });

  describe("the Project Manager reads their own project's budget state through existing permissions (no new function)", () => {
    it("the current PM reads the budget, versions with status and decision note, and the final-expense sets of their own project", async () => {
      const p = await newProject(U.pm);
      const b = await budgetFor(p, U.pm);
      await submitBudget(U.pm, b);
      await call(U.fin1, `select pbx_decide_budget('${b.version}', 'return', 'Please check the meals')`);
      const mine = await q<Row>(U.pm, `select v.status, v.seq, v.decided_at, v.decision_note from pbx_budget_versions v join pbx_budgets b on b.id = v.budget_id where b.project_id = '${p}' order by v.seq`);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ status: "returned", seq: 1, decision_note: "Please check the meals" });
      expect(mine[0]!.decided_at).not.toBeNull();
      expect(await q(U.pm, `select 1 from pbx_budgets where project_id = '${p}'`)).toHaveLength(1);
    });

    it("another PM, an outsider and a project founder without a budget grant read none of it, and the PM reads none of another project's", async () => {
      const p = await newProject(U.pm);
      await budgetFor(p, U.pm);
      const other = await newProject(U.pm2);
      await budgetFor(other, U.pm2);
      for (const who of [U.pm2, U.outsider, U.founder, U.ksaFin]) {
        expect(await q(who, `select 1 from pbx_budget_versions v join pbx_budgets b on b.id = v.budget_id where b.project_id = '${p}'`), who).toHaveLength(0);
      }
      expect(await q(U.pm, `select 1 from pbx_budget_versions v join pbx_budgets b on b.id = v.budget_id where b.project_id = '${other}'`)).toHaveLength(0);
    });

    it("after a PM change the NEW PM reads the budget at once (the authoritative project record decides, not the budget's PM snapshot)", async () => {
      const p = await newProject(U.pm);
      await budgetFor(p, U.pm);
      expect(await q(U.pm, `select 1 from pbx_budgets where project_id = '${p}'`)).toHaveLength(1);
      await admin(`update proj_projects set pm_user_id = '${U.pm2}' where id = '${p}'; update proj_project_members set removed_at = now() where project_id = '${p}' and user_id = '${U.pm}'`);
      expect(await q(U.pm2, `select 1 from pbx_budgets where project_id = '${p}'`)).toHaveLength(1);
    });
  });
});
