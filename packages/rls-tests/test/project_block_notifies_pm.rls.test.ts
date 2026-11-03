import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Completion pass, section 2. A blocker that names someone other than the Project Manager ALSO tells the Project Manager. One notice per person (never twice to
// the same person), the reporter is never told about their own action, and who may block / what must be given is unchanged.

const id = () => randomUUID();
const CO = { uae: id() };
const U = { pm: id(), assignee: id(), colleague: id(), head: id(), outsider: id(), inactivePm: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@proj-block.ae')`).join(", ");
const PRJ = { p1: id(), p2: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

describe("Blockers tell the Project Manager when someone else is named to unblock", () => {
  const db = new RlsTestDatabase();
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const task = async (project: string, assignee: string, title: string, creator = U.pm) =>
    (await commit<{ v: string }>(creator, `select proj_create_task('${project}', ${j({ title, assignee_id: assignee })}) as v`))[0]!.v;
  const notices = (user: string, taskId: string) =>
    admin<Row>(`select payload from notifications where user_id = '${user}' and type = 'project_task_blocked' and payload->>'task_id' = '${taskId}'`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.uae}', '{}'), ('${U.inactivePm}', '${CO.uae}', '{}'), ('${U.assignee}', '${CO.uae}', '{}'), ('${U.colleague}', '${CO.uae}', '{}'), ('${U.head}', '${CO.uae}', '{}');
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${PRJ.p1}', '${CO.uae}', 'UAE-P-B1', 'Alpha stage', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.p2}', '${CO.uae}', 'UAE-P-B2', 'Beta arena', 'internal', 'in_progress', '${U.inactivePm}', '${U.inactivePm}');
      insert into proj_project_details (project_id, scope) select id, 'LED floor' from proj_projects;
      insert into proj_project_members (project_id, user_id, role) values
        ('${PRJ.p1}', '${U.pm}', 'pm'), ('${PRJ.p1}', '${U.assignee}', 'member'), ('${PRJ.p1}', '${U.colleague}', 'member'), ('${PRJ.p1}', '${U.head}', 'member'),
        ('${PRJ.p2}', '${U.inactivePm}', 'pm'), ('${PRJ.p2}', '${U.assignee}', 'member'), ('${PRJ.p2}', '${U.colleague}', 'member');
    `);
  });
  afterAll(async () => db.teardown());

  it("a member names a colleague: the colleague is told to act and the Project Manager is told who was asked (no request for the PM to act)", async () => {
    const t = await task(PRJ.p1, U.assignee, "Hang truss");
    await commit(U.assignee, `select proj_block_task('${t}', 'Power not ready', '${U.colleague}', null)`);
    const colleague = await notices(U.colleague, t);
    const pm = await notices(U.pm, t);
    expect(colleague).toHaveLength(1);
    expect(colleague[0]!.payload.fyi).toBeUndefined();
    expect(pm).toHaveLength(1);
    expect(pm[0]!.payload).toMatchObject({ fyi: true, unblocker: "colleague", reason: "Power not ready", reference: "UAE-P-B1" });
    expect(await notices(U.assignee, t)).toHaveLength(0); // the reporter is never told about their own action
  });

  it("the named person IS the Project Manager: one notice, not two", async () => {
    const t = await task(PRJ.p1, U.assignee, "Rig lights");
    await commit(U.assignee, `select proj_block_task('${t}', 'Needs a decision', '${U.pm}', null)`);
    const pm = await notices(U.pm, t);
    expect(pm).toHaveLength(1);
    expect(pm[0]!.payload.fyi).toBeUndefined();
  });

  it("no person named (an action only): the Project Manager gets the one notice as before", async () => {
    const t = await task(PRJ.p1, U.assignee, "Paint set");
    await commit(U.assignee, `select proj_block_task('${t}', 'Paint late', null, 'Supplier delivers Tuesday')`);
    const pm = await notices(U.pm, t);
    expect(pm).toHaveLength(1);
    expect(pm[0]!.payload.fyi).toBeUndefined();
  });

  it("the Project Manager reports the blocker and names a colleague: only the colleague is told, never the reporter", async () => {
    const t = await task(PRJ.p1, U.assignee, "Install screens");
    await commit(U.pm, `select proj_block_task('${t}', 'Cables missing', '${U.colleague}', null)`);
    expect(await notices(U.colleague, t)).toHaveLength(1);
    expect(await notices(U.pm, t)).toHaveLength(0);
  });

  it("the reporter names themselves: the Project Manager is told, the reporter is not", async () => {
    const t = await task(PRJ.p1, U.assignee, "Tape floor");
    await commit(U.assignee, `select proj_block_task('${t}', 'Waiting on my own approval', '${U.assignee}', null)`);
    expect(await notices(U.assignee, t)).toHaveLength(0);
    expect(await notices(U.pm, t)).toHaveLength(1);
  });

  it("blocking again after clearing is a new blocker with its own notices; the same blocker is not repeated", async () => {
    const t = await task(PRJ.p1, U.assignee, "Focus lamps");
    await commit(U.assignee, `select proj_block_task('${t}', 'First', '${U.colleague}', null)`);
    await commit(U.assignee, `select proj_unblock_task('${t}', 'ok')`);
    await commit(U.assignee, `select proj_block_task('${t}', 'Second', '${U.colleague}', null)`);
    expect(await notices(U.pm, t)).toHaveLength(2);
    expect(await notices(U.colleague, t)).toHaveLength(2);
  });

  it("an inactive Project Manager is not notified (the existing rule), and the named person still is", async () => {
    const t = await task(PRJ.p2, U.assignee, "Seat plan", U.inactivePm);
    await admin(`update profiles set is_active = false where id = '${U.inactivePm}'`);
    await commit(U.assignee, `select proj_block_task('${t}', 'Venue closed', '${U.colleague}', null)`);
    expect(await notices(U.inactivePm, t)).toHaveLength(0);
    expect(await notices(U.colleague, t)).toHaveLength(1);
  });

  it("unchanged: a reason and a responsible person or action are required, the person must be a member, and only the assignee, head or PM may block (refused when called directly)", async () => {
    const t = await task(PRJ.p1, U.assignee, "Refusals");
    await expect(commit(U.assignee, `select proj_block_task('${t}', '', '${U.colleague}', null)`)).rejects.toThrow(/what is blocking/);
    await expect(commit(U.assignee, `select proj_block_task('${t}', 'Reason', null, null)`)).rejects.toThrow(/who or what action/);
    await expect(commit(U.assignee, `select proj_block_task('${t}', 'Reason', '${U.outsider}', null)`)).rejects.toThrow(/must be a member/);
    await expect(commit(U.colleague, `select proj_block_task('${t}', 'Reason', '${U.pm}', null)`)).rejects.toThrow(/Only the assignee, the department head or the Project Manager/);
    expect(await notices(U.pm, t)).toHaveLength(0);
    expect((await admin<Row>(`select blocked_at from proj_tasks where id = '${t}'`))[0]!.blocked_at).toBeNull();
  });

  it("nobody gains access: the Project Manager's notice names the project and task only (no extra project data)", async () => {
    const t = await task(PRJ.p1, U.assignee, "Payload check");
    await commit(U.assignee, `select proj_block_task('${t}', 'Reason', '${U.colleague}', null)`);
    const keys = Object.keys((await notices(U.pm, t))[0]!.payload).sort();
    expect(keys).toEqual(["dedupe_key", "fyi", "name", "project_id", "reason", "reference", "task", "task_id", "unblocker"]);
  });
});
