import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Completion pass, section 3: scope-change approvers. proj_decide_scope_change() authorises the capability approve_scope (founders hold every capability) and nothing
// about membership. A holder who is neither founder nor member could decide but could not read what they were asked to approve. The two read-only functions under
// test give the people the decision function already authorises ONLY what the decision form needs:
//   proj_scope_decisions_waiting()    the open proposals the caller may decide (id, project reference / name, title, when)
//   proj_scope_decision_context(id)   one proposal: the same plus proposed scope text, effect on dates, proposer's display name, status, can_decide
// Everything else about the project stays as closed to them as before: that is asserted here too (direct table reads, other tables, commercial effect).

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), ksaFounder: id(), pm: id(), scopeMember: id(), scopeOnly: id(), plainMember: id(), outsider: id(), viewer: id(), inactive: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@scope-ctx.ae')`).join(", ");
const PRJ = { p1: id(), p2: id(), done: id(), ksa: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

describe("Scope-change deciders see the minimum proposal context without belonging to the project", () => {
  const db = new RlsTestDatabase();
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const propose = async (project: string, title: string, extra: Record<string, unknown> = {}) =>
    (await commit<{ v: string }>(U.pm, `select proj_propose_scope_change('${project}', ${j({ title, proposed_scope: "LED floor and a second wall", effect_on_dates: "Two days later", ...extra })}) as v`))[0]!.v;
  const ctxOf = (user: string | null, change: string) => q(user, `select * from proj_scope_decision_context('${change}')`);
  const waiting = (user: string | null) => q<Row>(user, `select * from proj_scope_decisions_waiting()`);

  let c1: string;
  let c2: string;
  let cCommercial: string;
  let cDone: string;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      update profiles set full_name = 'Pia Pm' where id = '${U.pm}';
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}'), ('${U.pm}', '${CO.uae}', '{}'),
        ('${U.scopeMember}', '${CO.uae}', '{approve_scope}'), ('${U.scopeOnly}', '${CO.uae}', '{approve_scope}'), ('${U.plainMember}', '${CO.uae}', '{}'),
        ('${U.viewer}', '${CO.uae}', '{view_commercial}'), ('${U.inactive}', '${CO.uae}', '{approve_scope}');
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${PRJ.p1}', '${CO.uae}', 'UAE-P-X1', 'Alpha stage', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.p2}', '${CO.uae}', 'UAE-P-X2', 'Beta arena', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.done}', '${CO.uae}', 'UAE-P-X3', 'Delta hall', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.ksa}', '${CO.ksa}', 'KSA-P-X1', 'Gamma gallery', 'internal', 'in_progress', '${U.ksaFounder}', '${U.ksaFounder}');
      insert into proj_project_details (project_id, scope) select id, 'LED floor' from proj_projects;
      insert into proj_project_members (project_id, user_id, role) values
        ('${PRJ.p1}', '${U.pm}', 'pm'), ('${PRJ.p1}', '${U.scopeMember}', 'member'), ('${PRJ.p1}', '${U.plainMember}', 'member'),
        ('${PRJ.p2}', '${U.pm}', 'pm'), ('${PRJ.done}', '${U.pm}', 'pm');
    `);
    c1 = await propose(PRJ.p1, "Add a second LED wall");
    c2 = await propose(PRJ.p2, "Move the stage");
    cCommercial = await propose(PRJ.p1, "Costed change", { cost_note: "Extra truss", amount: 12500, currency: "AED" });
    cDone = await propose(PRJ.done, "Late change");
    await admin(`update proj_projects set status = 'completed' where id = '${PRJ.done}'`);
    await admin(`update profiles set is_active = false where id = '${U.inactive}'`);
  }, 60_000);
  afterAll(async () => db.teardown());

  it("reproduction: a holder of approve_scope who is not a member cannot read the proposal or the project directly, yet the decision function authorises them", async () => {
    expect(await q(U.scopeOnly, `select 1 from proj_scope_changes where id = '${c2}'`)).toHaveLength(0);
    // (the project's name and reference are already readable to everyone with a Projects grant: the summary level of proj_projects, unchanged)
    expect(await q(U.scopeOnly, `select 1 from proj_project_details where project_id = '${PRJ.p2}'`)).toHaveLength(0);
  });

  it("the waiting list gives that holder the open proposals of their company, with only id, project reference and name, title and time", async () => {
    const rows = await waiting(U.scopeOnly);
    expect(rows.map((r) => r.title).sort()).toEqual(["Add a second LED wall", "Costed change", "Move the stage"].sort());
    expect(Object.keys(rows[0]!).sort()).toEqual(["project_id", "project_name", "project_reference", "proposed_at", "scope_change_id", "title"]);
    expect(rows.find((r) => r.title === "Move the stage")).toMatchObject({ project_reference: "UAE-P-X2", project_name: "Beta arena", project_id: PRJ.p2, scope_change_id: c2 });
  });

  it("the context gives exactly the fields the decision form needs, and nothing about the rest of the project", async () => {
    const rows = await ctxOf(U.scopeOnly, c2);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["can_decide", "effect_on_dates", "project_id", "project_name", "project_reference", "proposed_at", "proposed_by_name", "proposed_scope", "scope_change_id", "status", "title"].sort());
    expect(rows[0]).toMatchObject({
      title: "Move the stage", proposed_scope: "LED floor and a second wall", effect_on_dates: "Two days later", proposed_by_name: "Pia Pm", status: "proposed", can_decide: true,
      project_reference: "UAE-P-X2", project_name: "Beta arena",
    });
    // not the current scope, not the cost effect
    expect(JSON.stringify(rows)).not.toMatch(/LED floor"|12500|Extra truss|AED/);
  });

  it("the cost effect of a proposal never appears (it stays behind view_commercial), and the holder cannot read it directly", async () => {
    const rows = await ctxOf(U.scopeOnly, cCommercial);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/12500|Extra truss|AED|amount|cost_note/);
    expect(await q(U.scopeOnly, `select * from proj_scope_change_commercial`)).toHaveLength(0);
  });

  it("no project access is created: the holder still reads no project detail, task, member, budget, handover or proposal row", async () => {
    for (const t of ["proj_project_details", "proj_project_members", "proj_scope_changes", "proj_tasks", "proj_handovers", "proj_feedback", "proj_files"]) {
      expect(await q(U.scopeOnly, `select 1 from ${t}`), t).toHaveLength(0);
    }
    expect(await q(U.scopeOnly, `select proj_can_view_details('${PRJ.p2}') as v`)).toEqual([{ v: false }]);
  });

  it("a founder and a member who holds the right get the same context (founder: every proposal of the company)", async () => {
    for (const who of [U.founder, U.scopeMember]) {
      expect((await ctxOf(who, c1))[0], who).toMatchObject({ title: "Add a second LED wall", can_decide: true });
      expect((await waiting(who)).length, who).toBe(3);
    }
  });

  it("is refused to everyone else when called directly: no capability, a plain member, the proposer, a commercial reader, an outsider, another company's founder, an inactive holder, anonymous", async () => {
    for (const who of [U.plainMember, U.pm, U.viewer, U.outsider, U.ksaFounder, U.inactive]) {
      expect(await ctxOf(who, c1), who).toHaveLength(0);
      expect(await waiting(who), who).toHaveLength(0);
    }
    await expect(ctxOf(null, c1)).rejects.toThrow(/permission denied/);
    await expect(waiting(null)).rejects.toThrow(/permission denied/);
    await expect(q(U.scopeOnly, `select * from proj_scope_decision_context('${randomUUID()}')`)).resolves.toHaveLength(0);
  });

  it("another company's holder sees their own company's proposals only", async () => {
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${PRJ.ksa}', '${U.ksaFounder}', 'pm') on conflict do nothing`);
    expect(await waiting(U.ksaFounder)).toHaveLength(0);
  });

  it("a completed project's proposal is not waiting and cannot be decided; a decided one leaves the list and says so", async () => {
    expect((await waiting(U.scopeOnly)).map((r) => r.scope_change_id)).not.toContain(cDone);
    expect((await ctxOf(U.scopeOnly, cDone))[0]).toMatchObject({ status: "proposed", can_decide: false });
    const c3 = await propose(PRJ.p2, "Decided later");
    expect((await waiting(U.scopeOnly)).map((r) => r.scope_change_id)).toContain(c3);
    await commit(U.scopeOnly, `select proj_decide_scope_change('${c3}', 'reject', 'Not needed')`);
    expect((await waiting(U.scopeOnly)).map((r) => r.scope_change_id)).not.toContain(c3);
    expect((await ctxOf(U.scopeOnly, c3))[0]).toMatchObject({ status: "rejected", can_decide: false });
  });

  it("the decision itself is unchanged: that holder decides with the existing function, a member without the right is still refused, and the notice reader is unchanged", async () => {
    await expect(commit(U.plainMember, `select proj_decide_scope_change('${c1}', 'approve', 'x')`)).rejects.toThrow(/Only a founder, or someone a founder gave scope approval/);
    await commit(U.scopeOnly, `select proj_decide_scope_change('${c1}', 'reject', 'Not needed')`);
    expect((await admin<Row>(`select status, decided_by from proj_scope_changes where id = '${c1}'`))[0]).toMatchObject({ status: "rejected", decided_by: U.scopeOnly });
    // scopeOnly still has no project notices through the participant-filtered reader
    expect(await q(U.scopeOnly, `select 1 from proj_my_notifications(50, false)`)).toHaveLength(0);
  });

  it("the functions are not executable by anonymous callers and add no privilege on any table", async () => {
    const r = await admin<Row>(`select has_function_privilege('anon', 'proj_scope_decision_context(uuid)', 'execute') a, has_function_privilege('authenticated', 'proj_scope_decision_context(uuid)', 'execute') s,
      has_function_privilege('anon', 'proj_scope_decisions_waiting()', 'execute') a2, has_function_privilege('authenticated', 'proj_scope_decisions_waiting()', 'execute') s2`);
    expect(r[0]).toEqual({ a: false, s: true, a2: false, s2: true });
  });
});
