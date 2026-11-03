import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A11 / U-01. When the Project Manager proposes a scope change, the people who decide it (a Projects founder, or someone holding approve_scope who can
// open the project) are told. Who decides is unchanged: approve_scope or founder. Runtime findings recorded here as tests:
//   * a holder of approve_scope who is neither a founder nor a member of the project can still decide by calling the function, but cannot read the proposal
//     (row-level security needs founder or membership) and gets no notice that they could open: no new access is created for them;
//   * the proposer is never notified of their own proposal.

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), ksaFounder: id(), pm: id(), scopeMember: id(), scopeOnly: id(), plainMember: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@proj-scope.ae')`).join(", ");
const PRJ = { p1: id(), p2: id(), ksa: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

describe("Scope change proposals notify the people who decide (U-01)", () => {
  const db = new RlsTestDatabase();
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const propose = async (user: string, project: string, title = "Add a second LED wall") =>
    (await commit<{ v: string }>(user, `select proj_propose_scope_change('${project}', ${j({ title, proposed_scope: "LED floor and a second wall" })}) as v`))[0]!.v;
  const notices = (user: string, change: string) =>
    admin<Row>(`select type, payload from notifications where user_id = '${user}' and type = 'project_scope_proposed' and payload->>'scope_change_id' = '${change}'`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}'), ('${U.pm}', '${CO.uae}', '{}'),
        ('${U.scopeMember}', '${CO.uae}', '{approve_scope}'), ('${U.scopeOnly}', '${CO.uae}', '{approve_scope}'), ('${U.plainMember}', '${CO.uae}', '{}');
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${PRJ.p1}', '${CO.uae}', 'UAE-P-S1', 'Alpha stage', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.p2}', '${CO.uae}', 'UAE-P-S2', 'Beta arena', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.ksa}', '${CO.ksa}', 'KSA-P-S1', 'Gamma gallery', 'internal', 'in_progress', '${U.ksaFounder}', '${U.ksaFounder}');
      insert into proj_project_details (project_id, scope) select id, 'LED floor' from proj_projects;
      insert into proj_project_members (project_id, user_id, role) values
        ('${PRJ.p1}', '${U.pm}', 'pm'), ('${PRJ.p1}', '${U.scopeMember}', 'member'), ('${PRJ.p1}', '${U.plainMember}', 'member'),
        ('${PRJ.p2}', '${U.pm}', 'pm');
    `);
  });
  afterAll(async () => db.teardown());

  it("tells a Projects founder, and a holder of approve_scope who is a member, that a proposal waits for them", async () => {
    const change = await propose(U.pm, PRJ.p1);
    for (const who of [U.founder, U.scopeMember]) {
      const rows = await notices(who, change);
      expect(rows, who).toHaveLength(1);
      expect(rows[0]!.payload).toMatchObject({ project_id: PRJ.p1, scope_change_id: change, title: "Add a second LED wall", reference: "UAE-P-S1", name: "Alpha stage" });
    }
  });

  it("the founder can read the notice through the participant-filtered reader, and the proposal itself", async () => {
    const change = await propose(U.pm, PRJ.p1, "Move the stage");
    const mine = await q(U.founder, `select type, payload from proj_my_notifications(50, true) where type = 'project_scope_proposed'`);
    expect(mine.some((n) => n.payload.scope_change_id === change)).toBe(true);
    expect(await q(U.founder, `select status from proj_scope_changes where id = '${change}'`)).toEqual([{ status: "proposed" }]);
  });

  it("tells nobody else: not the proposer, not a member without the right, not an outsider, not a founder of another company", async () => {
    const change = await propose(U.pm, PRJ.p1, "Third change");
    for (const who of [U.pm, U.plainMember, U.outsider, U.ksaFounder]) expect(await notices(who, change), who).toHaveLength(0);
  });

  it("a founder who proposes is not told of their own proposal", async () => {
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${PRJ.p2}', '${U.founder}', 'member')`);
    const change = await propose(U.founder, PRJ.p2, "Founder's own");
    expect(await notices(U.founder, change)).toHaveLength(0);
  });

  it("runtime finding: an approve_scope holder who is neither a founder nor a member gets no notice, cannot read the proposal, and can still decide by calling the function (unchanged)", async () => {
    const change = await propose(U.pm, PRJ.p1, "Fourth change");
    expect(await notices(U.scopeOnly, change)).toHaveLength(0);
    expect(await q(U.scopeOnly, `select 1 from proj_scope_changes where id = '${change}'`)).toHaveLength(0);
    await commit(U.scopeOnly, `select proj_decide_scope_change('${change}', 'reject', 'Not needed')`);
    expect((await admin<Row>(`select status from proj_scope_changes where id = '${change}'`))[0]!.status).toBe("rejected");
  });

  it("who decides is unchanged: a member without the right is still refused when calling the function directly", async () => {
    const change = await propose(U.pm, PRJ.p1, "Fifth change");
    await expect(commit(U.plainMember, `select proj_decide_scope_change('${change}', 'approve', 'x')`)).rejects.toThrow(/Only a founder, or someone a founder gave scope approval/);
    await expect(commit(U.pm, `select proj_decide_scope_change('${change}', 'approve', 'x')`)).rejects.toThrow(/Only a founder, or someone a founder gave scope approval/);
    expect((await admin<Row>(`select status from proj_scope_changes where id = '${change}'`))[0]!.status).toBe("proposed");
  });

  it("the proposal itself is unchanged: validation, manager-only, open project, one row per proposal", async () => {
    await expect(commit(U.pm, `select proj_propose_scope_change('${PRJ.p1}', ${j({ title: "", proposed_scope: "x" })})`)).rejects.toThrow(/Give the change a title/);
    await expect(commit(U.pm, `select proj_propose_scope_change('${PRJ.p1}', ${j({ title: "t", proposed_scope: "" })})`)).rejects.toThrow(/Write the proposed scope/);
    await expect(commit(U.plainMember, `select proj_propose_scope_change('${PRJ.p1}', ${j({ title: "t", proposed_scope: "s" })})`)).rejects.toThrow();
    const before = Number((await admin<Row>(`select count(*) n from proj_scope_changes`))[0]!.n);
    await propose(U.pm, PRJ.p1, "One more");
    expect(Number((await admin<Row>(`select count(*) n from proj_scope_changes`))[0]!.n)).toBe(before + 1);
  });

  it("a notice is not repeated for the same proposal (dedupe), and a fresh proposal gets its own", async () => {
    const a = await propose(U.pm, PRJ.p1, "Dedupe A");
    const b = await propose(U.pm, PRJ.p1, "Dedupe B");
    expect(await notices(U.founder, a)).toHaveLength(1);
    expect(await notices(U.founder, b)).toHaveLength(1);
  });
});
