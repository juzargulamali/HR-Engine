import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects & Tasks Phase 2 follow-up (migration 20270107000100_proj_phase2_teams_crew_ops_review.sql), against a real Postgres. Fictional data throughout.
//   * Team setup: presets in one save, a lead for each (optional), idempotent (no duplicate team, an existing lead is never overwritten, only a missing one is filled), explicit access
//     confirmation before a lead is added to the project, a site team enrols nobody, rosters preserved, cross-company denial.
//   * Site-only technicians: crew may include company employees who are NOT on the project; they read only their own assignment, and nothing else (tasks, files, chat, reviews,
//     schedule, register); revocation and the end of the activity end the access; the booking overlap rule applies to crew.
//   * Operations review: a version the Project Manager submits (on anyone's task) goes to an Operations Manager; neither the submitter nor the assignee can decide it even with the
//     Operations role; a new version gets its own review; an old version cannot be approved once a newer one exists; "needs a reviewer" when nobody is eligible.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), head: id(), design: id(), eng: id(), lead1: id(), lead2: id(), ops1: id(), ops2: id(), opsDual: id(), tech1: id(), tech2: id(), noGrant: id(), outsider: id(), outsiderOps: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@followup.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const migrationSql = () => readFileSync(path.join(__dirname, "../../../supabase/migrations/20270107000100_proj_phase2_teams_crew_ops_review.sql"), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe("Projects Phase 2 follow-up: team setup, site-only technicians, Operations review", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const count = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0]!.n);
  const asRows = async <T = Row>(user: string, sql: string): Promise<T[]> => (await db.asUserCommit(user, async (query) => (await query(sql)).rows)) as T[];
  const setup = (user: string, project: string, teams: Row[], confirm = false) => call<Row>(user, `proj_setup_teams('${project}', ${j(teams)}, ${confirm})`);
  const createTask = (user: string, project: string, f: Row) => call<string>(user, `proj_create_task('${project}', ${j(f)})`);
  const setOutput = (user: string, task: string, label: string) => call<Row>(user, `proj_set_task_output('${task}', '${label}', 1, true)`);
  const submit = (user: string, task: string, file: string, key?: string) => call<Row>(user, `proj_submit_task_output('${task}', '${file}', null, 1, null, false, ${key ? `'${key}'` : "null"}, null)`);
  const decide = (user: string, version: string, decision: string, note?: string) => call<Row>(user, `proj_decide_task_output('${version}', '${decision}', ${note ? `'${note}'` : "null"})`);
  const register = (user: string, project: string, task: string) => call<Row>(user, `proj_deliverables_register('${project}', '${task}')`);
  const link = async (project: string, label: string, by: string, restricted = false) => (await admin<{ id: string }>(
    `insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${project}', 'link', 'document', '${label}', 'https://docs.example.com/${label.replace(/\W+/g, "-")}', ${restricted}, '${by}') returning id`))[0]!.id;
  const employee = (user: string, company: string, n: number) => admin(
    `insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values ('${user}', 'EMP-${n}', '${company}', 'AE', 'Fictional', 'Tech${n}', '2024-01-01')`);

  let P = "", PB = "", TEAM = "", DONE = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.a}', '{}'), ('${U.head}', '${CO.a}', '{}'), ('${U.design}', '${CO.a}', '{}'), ('${U.eng}', '${CO.a}', '{}'), ('${U.lead1}', '${CO.a}', '{}'), ('${U.lead2}', '${CO.a}', '{}'),
        ('${U.ops1}', '${CO.a}', '{operations}'), ('${U.ops2}', '${CO.a}', '{operations}'), ('${U.opsDual}', '${CO.a}', '{operations}'),
        ('${U.outsider}', '${CO.b}', '{}'), ('${U.outsiderOps}', '${CO.b}', '{operations}');
    `);
    await employee(U.tech1, CO.a, 1); await employee(U.tech2, CO.a, 2); await employee(U.noGrant, CO.b, 3);
    const proj = async (co: string, ref: string, name: string, pm: string, status = "in_progress") => (await admin<{ id: string }>(
      `insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${co}', '${ref}', '${name}', 'internal', '${status}', '${pm}', '${pm}') returning id`))[0]!.id;
    P = await proj(CO.a, "UAE-P-2027-0401", "Fictional Follow-up Expo", U.pm);
    PB = await proj(CO.b, "OTH-P-2027-0401", "Fictional other company job", U.outsider);
    DONE = await proj(CO.a, "UAE-P-2027-0402", "Fictional finished job", U.pm, "completed");
    await db.seed(`
      insert into proj_project_details (project_id, location, site_timezone, scope, technologies) values
        ('${P}', 'Fictional Expo Centre', 'Asia/Dubai', null, '[]'::jsonb), ('${PB}', 'Elsewhere', 'Asia/Dubai', null, '[]'::jsonb), ('${DONE}', 'Elsewhere', 'Asia/Dubai', null, '[]'::jsonb);
      insert into proj_project_members (project_id, user_id, role) values
        ('${P}', '${U.pm}', 'pm'), ('${P}', '${U.head}', 'member'), ('${P}', '${U.design}', 'member'), ('${P}', '${U.eng}', 'member'), ('${PB}', '${U.outsider}', 'pm'), ('${DONE}', '${U.pm}', 'pm');
    `);
    TEAM = (await admin<{ id: string }>(`insert into proj_teams (project_id, name, head_user_id, created_by) values ('${P}', 'Creative', '${U.head}', '${U.pm}') returning id`))[0]!.id;
  });
  afterAll(async () => db.teardown());

  // ------------------------------------------------------------------------------------------------------------------------------------------------ team setup
  it("a team can be saved without a lead; the lead column accepts nothing else changing", async () => {
    const r = await setup(U.pm, P, [{ name: "Content", preset: "content" }, { name: "Programming", preset: "programming", lead_user_id: U.eng }]);
    expect(r).toMatchObject({ created: 2, existing: 0, leads_set: 0, members_added: 0, lead_needed: ["Content"] });
    const rows = await admin<{ name: string; head_user_id: string | null; preset_key: string }>(`select name, head_user_id, preset_key from proj_teams where project_id = '${P}' and removed_at is null order by name`);
    expect(rows.map((x) => [x.name, x.head_user_id, x.preset_key])).toEqual([["Content", null, "content"], ["Creative", U.head, null], ["Programming", U.eng, "programming"]]);
    // the lead is placed in their team without losing their place on the project
    expect((await admin<{ team_id: string }>(`select team_id from proj_project_members where project_id = '${P}' and user_id = '${U.eng}' and removed_at is null`))[0]!.team_id).toBeTruthy();
  });

  it("reopening or retrying never duplicates a team or overwrites a lead; only a missing lead is filled", async () => {
    const again = await setup(U.pm, P, [{ name: "content" }, { name: " Programming ", lead_user_id: U.head }]);   // same names (case and spacing ignored); a different lead for Programming
    expect(again).toMatchObject({ created: 0, existing: 2, leads_set: 0, members_added: 0 });
    expect(await count(`select 1 from proj_teams where project_id = '${P}' and removed_at is null`)).toBe(3);
    expect((await admin<{ head_user_id: string }>(`select head_user_id from proj_teams where project_id = '${P}' and name = 'Programming'`))[0]!.head_user_id).toBe(U.eng);   // not overwritten
    const fill = await setup(U.pm, P, [{ name: "Content", lead_user_id: U.design }]);                                // fills the MISSING lead
    expect(fill).toMatchObject({ created: 0, existing: 1, leads_set: 1, lead_needed: [] });
    const retry = await setup(U.pm, P, [{ name: "Content", lead_user_id: U.head }]);                                // and now it is not replaced
    expect(retry).toMatchObject({ leads_set: 0 });
    expect((await admin<{ head_user_id: string }>(`select head_user_id from proj_teams where project_id = '${P}' and name = 'Content'`))[0]!.head_user_id).toBe(U.design);
    // two identical saves at the same moment make one team
    await Promise.all([setup(U.pm, P, [{ name: "Engineering", preset: "engineering" }]), setup(U.pm, P, [{ name: "Engineering", preset: "engineering" }])]);
    expect(await count(`select 1 from proj_teams where project_id = '${P}' and removed_at is null and name = 'Engineering'`)).toBe(1);
  });

  it("access is explicit: a lead who is not on the project is added only when the caller confirms it; ineligible people and non-managers are refused", async () => {
    await expect(setup(U.pm, P, [{ name: "Site / Installation", preset: "site_installation", lead_user_id: U.lead1 }])).rejects.toThrow(/Confirm access first/);
    expect(await count(`select 1 from proj_teams where project_id = '${P}' and name like 'Site%'`)).toBe(0);                     // nothing was written
    expect(await count(`select 1 from proj_project_members where project_id = '${P}' and user_id = '${U.lead1}'`)).toBe(0);
    const ok = await setup(U.pm, P, [{ name: "Site / Installation", preset: "site_installation", lead_user_id: U.lead1 }], true);
    expect(ok).toMatchObject({ created: 1, members_added: 1 });
    expect(await count(`select 1 from proj_project_members where project_id = '${P}' and user_id = '${U.lead1}' and removed_at is null`)).toBe(1);
    await expect(setup(U.pm, P, [{ name: "Ghost", lead_user_id: U.noGrant }], true)).rejects.toThrow(/needs Projects access/);     // no Projects access in this company
    await expect(setup(U.design, P, [{ name: "Nope" }])).rejects.toThrow(/Project Manager|manage/i);                           // not the manager
    await expect(setup(U.outsider, P, [{ name: "Cross company" }])).rejects.toThrow();                                           // another company
    await expect(setup(U.pm, DONE, [{ name: "Late" }])).rejects.toThrow(/read-only/);                                            // a finished project
  });

  it("a site team enrols nobody: technicians are never added to the project by choosing the team", async () => {
    const before = await count(`select 1 from proj_project_members where project_id = '${P}' and removed_at is null`);
    await setup(U.pm, P, [{ name: "Site / Installation", preset: "site_installation" }]);
    expect(await count(`select 1 from proj_project_members where project_id = '${P}' and removed_at is null`)).toBe(before);
    expect(await count(`select 1 from proj_project_members where project_id = '${P}' and user_id in ('${U.tech1}', '${U.tech2}')`)).toBe(0);
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------ site-only technicians
  let SETUP = "", SHOW = "", T1 = "", FILE = "";
  const dayAt = (n: number, hh: string) => `${day(n)}T${hh}`;
  it("crew may include a site-only technician; the PM sets call time and instructions; an unknown or other-company person is refused", async () => {
    SETUP = (await call<Row>(U.pm, `proj_save_site_activity('${P}', null, ${j({ activity_kind: "setup", title: "Setup (run 1)", location: "Hall 3", start_date: day(5), end_date: day(5), starts_local: dayAt(5, "09:00"), ends_local: dayAt(5, "18:00"), activity_state: "confirmed" })})`)).id;
    const r = await call<Row>(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.tech1, role: "installation", call_local: dayAt(5, "07:30"), instructions: "Bring a hard hat; enter by gate 2" }, { user_id: U.eng, role: "installation" }])}, null)`);
    expect(r).toMatchObject({ added: 2, removed: 0 });
    await expect(call(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.noGrant, role: "installation" }])}, null)`)).rejects.toThrow(/members of the project or active employees/);   // another company's employee
    await expect(call(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.outsider, role: "installation" }])}, null)`)).rejects.toThrow(/members of the project or active employees/);
    expect(await count(`select 1 from proj_project_members where project_id = '${P}' and user_id = '${U.tech1}'`)).toBe(0);     // assigned, but not on the project
    // the schedule shows who is site-only
    const sched = await call<Row>(U.pm, `proj_site_schedule('${P}')`);
    const act = sched.activities.find((a: Row) => a.id === SETUP);
    expect(act.crew.map((c: Row) => [c.role, c.site_only]).sort()).toEqual([["installation", false], ["installation", true]]);
    expect(act.crew.find((c: Row) => c.site_only).instructions).toContain("gate 2");
  });

  it("a site-only technician sees their own assignment and nothing else: the read returns the activity, role, venue, call time, instructions and brief readiness", async () => {
    await call(U.pm, `proj_set_activity_readiness('${SETUP}', ${j({ hardware: "ready", content: "not_ready", app: "unknown", note: "Final video due Thursday", crew_instructions: "Park at the loading bay" })})`);
    const mine = await call<Row[]>(U.tech1, "proj_my_site_assignments()");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "Setup (run 1)", role: "installation", location: "Hall 3", site_only: true, instructions: "Bring a hard hat; enter by gate 2", crew_instructions: "Park at the loading bay",
      ready: { hardware: "ready", content: "not_ready", app: "unknown", note: "Final video due Thursday" } });
    expect(mine[0]!.call_at).toBeTruthy();
    expect(Object.keys(mine[0]!).sort()).not.toContain("budget");
    expect(JSON.stringify(mine)).not.toMatch(/scope|client|price|task_id|file/i);
    expect(await call<Row[]>(U.tech2, "proj_my_site_assignments()")).toEqual([]);                                  // someone not assigned sees nothing
  });

  it("the assignment grants nothing else: no tasks, files, chat, reviews, members, schedule, register or exports", async () => {
    T1 = await createTask(U.pm, P, { title: "Storyboard", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, T1, "Storyboard");
    FILE = await link(P, "Storyboard draft", U.design);
    const secret = await link(P, "Confidential quote", U.pm, true);
    for (const t of ["proj_tasks", "proj_files", "proj_task_output_versions", "proj_project_members", "proj_site_crew", "proj_plan_items", "proj_messages", "proj_milestones", "proj_feedback", "proj_teams", "proj_site_shipments", "proj_project_details"]) {
      expect(await asRows(U.tech1, `select 1 from ${t} where project_id = '${P}'`), t).toEqual([]);
    }
    expect(await asRows(U.tech1, `select 1 from proj_projects where id = '${P}'`)).toEqual([]);
    for (const q of [`proj_deliverables_register('${P}', null)`, `proj_site_schedule('${P}')`, `proj_work_overview('${P}')`]) await expect(call(U.tech1, q)).rejects.toThrow(/not found/i);
    await expect(call(U.tech1, `proj_set_task_status('${T1}', 'in_progress', null)`)).rejects.toThrow();
    await expect(call(U.tech1, `proj_submit_task_output('${T1}', '${FILE}', null, 1, null, false, null, null)`)).rejects.toThrow();
    await expect(call(U.tech1, `proj_decide_task_output('${id()}', 'approved', null)`)).rejects.toThrow();
    await expect(call(U.tech1, `proj_set_site_crew('${SETUP}', '[]'::jsonb, null)`)).rejects.toThrow();                // cannot change the crew
    expect(await asRows(U.tech1, `select * from chat_my_groups()`)).toEqual([]);
    await expect(call(U.tech1, `chat_project_group('${P}')`)).rejects.toThrow(/not a member/);                       // no Project Chat
    expect(await asRows(U.tech1, `select * from proj_site_technician_candidates('${P}')`)).toEqual([]);
    expect(secret).toBeTruthy();
  });

  it("revocation and the end of the activity end the access; another company's person never gains any", async () => {
    // revoked: the crew row goes
    await call(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.eng, role: "installation" }])}, null)`);
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toEqual([]);
    // assigned again, then the activity is finished
    await call(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.tech1, role: "standby" }, { user_id: U.eng, role: "installation" }])}, null)`);
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toHaveLength(1);
    await admin(`update proj_plan_items set status = 'done' where id = '${SETUP}'`);
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toEqual([]);
    await admin(`update proj_plan_items set status = 'planned' where id = '${SETUP}'`);
    // the activity ended three days ago: no longer shown
    await admin(`update proj_plan_items set start_date = null, end_date = null, starts_at = ((current_date - 4)::timestamp at time zone 'Asia/Dubai'), ends_at = ((current_date - 3)::timestamp at time zone 'Asia/Dubai') where id = '${SETUP}'`);
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toEqual([]);
    await admin(`update proj_plan_items set start_date = null, end_date = null, starts_at = '${dayAt(5, "09:00")}+04'::timestamptz, ends_at = '${dayAt(5, "18:00")}+04'::timestamptz where id = '${SETUP}'`);
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toHaveLength(1);
    // a finished project ends it too
    await admin(`update proj_projects set status = 'completed' where id = '${P}'`);
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toEqual([]);
    await admin(`update proj_projects set status = 'in_progress' where id = '${P}'`);
    // another company's manager cannot reach this activity
    await expect(call(U.outsider, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.outsider, role: "installation" }])}, null)`)).rejects.toThrow();
    expect(await call<Row[]>(U.outsider, "proj_my_site_assignments()")).toEqual([]);
  });

  it("the booking overlap rule applies: a tentative overlap warns, a confirmed one is refused without a reason from someone with site-conflict authority", async () => {
    SHOW = (await call<Row>(U.pm, `proj_save_site_activity('${P}', null, ${j({ activity_kind: "show", title: "Show (day 1)", location: "Hall 3", start_date: day(5), end_date: day(5), starts_local: dayAt(5, "12:00"), ends_local: dayAt(5, "20:00"), activity_state: "tentative" })})`)).id;
    const warn = await call<Row>(U.pm, `proj_set_site_crew('${SHOW}', ${j([{ user_id: U.tech1, role: "standby" }])}, null)`);
    expect(warn).toMatchObject({ added: 1, overlaps: 1 });                                                           // tentative: saved, with a warning
    // a confirmed activity that overlaps another confirmed commitment is refused
    const CONF = (await call<Row>(U.pm, `proj_save_site_activity('${P}', null, ${j({ activity_kind: "dismantling", title: "Dismantling overlap", location: "Hall 3", start_date: day(5), end_date: day(5), starts_local: dayAt(5, "10:00"), ends_local: dayAt(5, "16:00"), activity_state: "confirmed" })})`)).id;
    await expect(call(U.pm, `proj_set_site_crew('${CONF}', ${j([{ user_id: U.tech1, role: "dismantling" }])}, null)`)).rejects.toThrow(/already has a confirmed commitment/);
    await expect(call(U.pm, `proj_set_site_crew('${CONF}', ${j([{ user_id: U.tech1, role: "dismantling" }])}, 'Covering a gap')`)).rejects.toThrow(/site-conflict authority|founder/);
    expect(await count(`select 1 from proj_site_crew where plan_item_id = '${CONF}'`)).toBe(0);
    const sched = await call<Row>(U.pm, `proj_site_schedule('${P}')`);
    expect(sched.activities.find((a: Row) => a.id === SETUP).crew.find((c: Row) => c.site_only).overlaps).toBe(0);     // the standby place is on a TENTATIVE show
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------ Operations review
  it("a version the PM submits goes to Operations (two eligible: it waits in their queue); the team lead, the PM and the assignee cannot decide it", async () => {
    const t = await createTask(U.pm, P, { title: "Logo reveal", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Logo reveal");
    const f = await link(P, "Logo reveal v1", U.pm);
    const v1 = await submit(U.pm, t, f, "ops-v1-attempt");
    expect(v1).toMatchObject({ version_no: 1, review_route: "operations" });
    const cur = (await register(U.pm, P, t)).rows[0].current;
    expect(cur).toMatchObject({ route: "operations", reviewer_id: null, needs_reviewer: false, can_decide: false });
    expect(cur.eligible_reviewers.map((r: Row) => r.name).length).toBe(3);                                            // ops1, ops2, opsDual (not the PM, not the assignee)
    await expect(decide(U.head, v1.id, "approved")).rejects.toThrow(/Operations Manager/);                           // the team lead is not the reviewer here
    await expect(decide(U.pm, v1.id, "approved")).rejects.toThrow(/cannot review your own work/);
    await expect(decide(U.design, v1.id, "approved")).rejects.toThrow(/cannot review your own work/);
    await expect(decide(U.outsiderOps, v1.id, "approved")).rejects.toThrow();                                          // another company's Operations Manager
    expect((await register(U.ops1, P, t)).rows[0].current).toMatchObject({ can_decide: true });
    expect((await register(U.head, P, t)).rows[0].current).toMatchObject({ can_decide: false });
    const approved = await decide(U.ops1, v1.id, "approved");
    expect(approved).toMatchObject({ decision: "approved" });
    expect((await register(U.pm, P, t)).rows[0].current).toMatchObject({ status: "approved", reviewer_name: expect.any(String) });
  });

  it("the review lands in the Operations decision queue; a normal (non-PM) submission keeps the team review", async () => {
    const t = await createTask(U.pm, P, { title: "Teaser", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Teaser");
    const v = await submit(U.pm, t, await link(P, "Teaser v1", U.pm), "ops-teaser-attempt-1");
    const ov = await call<Row>(U.ops2, `ops_overview('${CO.a}')`);
    const item = ov.output_reviews.find((x: Row) => x.version_id === v.id);
    expect(item).toMatchObject({ task: "Teaser", version_no: 1, needs_reviewer: false, reviewer_id: null, project_id: P });
    expect(ov.output_reviews.every((x: Row) => x.project_id !== PB)).toBe(true);
    await expect(call(U.pm, `ops_overview('${CO.a}')`)).rejects.toThrow();                                           // not an Operations Manager
    expect((await call<Row>(U.outsiderOps, `ops_overview('${CO.b}')`)).output_reviews).toEqual([]);                    // another company sees none
    // the assignee's own submission stays with the team lead
    const t2 = await createTask(U.pm, P, { title: "Poster", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t2, "Poster");
    const own = await submit(U.design, t2, await link(P, "Poster v1", U.design), "poster-attempt-1");
    expect(own).toMatchObject({ review_route: "team" });
    expect((await call<Row>(U.ops1, `ops_overview('${CO.a}')`)).output_reviews.some((x: Row) => x.version_id === own.id)).toBe(false);
    expect((await register(U.head, P, t2)).rows[0].current).toMatchObject({ can_decide: true });
    // a restricted file cannot be the evidence of a version that goes to Operations
    await expect(submit(U.pm, t, await link(P, "Secret", U.pm, true))).rejects.toThrow(/Operations cannot open restricted files/);
  });

  it("assignment: one eligible reviewer is assigned automatically, only they can decide, and the PM or Operations can reassign", async () => {
    await admin(`update proj_company_grants set revoked_at = now() where user_id in ('${U.ops2}', '${U.opsDual}') and company_id = '${CO.a}'`);
    const t = await createTask(U.pm, P, { title: "Trailer", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Trailer");
    const v = await submit(U.pm, t, await link(P, "Trailer v1", U.pm), "trailer-attempt-1");
    const cur = (await register(U.pm, P, t)).rows[0].current;
    expect(cur).toMatchObject({ reviewer_id: U.ops1, reviewer_name: expect.any(String), needs_reviewer: false });
    await admin(`update proj_company_grants set revoked_at = null where user_id = '${U.ops2}' and company_id = '${CO.a}'`);
    await expect(decide(U.ops2, v.id, "approved")).rejects.toThrow(/assigned to/);                                    // not theirs
    await expect(call(U.design, `proj_assign_output_reviewer('${v.id}', '${U.ops2}')`)).rejects.toThrow(/Project Manager or an Operations Manager/);
    expect(await call<Row>(U.pm, `proj_assign_output_reviewer('${v.id}', '${U.ops2}')`)).toMatchObject({ reviewer_id: U.ops2 });
    await expect(call(U.pm, `proj_assign_output_reviewer('${v.id}', '${U.design}')`)).rejects.toThrow(/cannot review this version/);      // the assignee is never eligible
    await expect(call(U.pm, `proj_assign_output_reviewer('${v.id}', '${U.pm}')`)).rejects.toThrow(/cannot review this version/);          // nor the submitter
    expect(await decide(U.ops2, v.id, "changes_requested", "Tighten the ending")).toMatchObject({ decision: "changes_requested" });
  });

  it("dual role: an Operations Manager who submitted it, or who is the task's assignee, is refused; with nobody else eligible the version needs a reviewer", async () => {
    await admin(`update proj_company_grants set revoked_at = now() where user_id in ('${U.ops1}', '${U.ops2}') and company_id = '${CO.a}'`);
    // opsDual is the only Operations Manager and is ALSO the assignee of the task
    await admin(`update proj_company_grants set revoked_at = null where user_id = '${U.opsDual}' and company_id = '${CO.a}'`);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${P}', '${U.opsDual}', 'member') on conflict do nothing`);
    const t = await createTask(U.pm, P, { title: "Opening titles", assignee_id: U.opsDual, requires_review: true });
    await setOutput(U.pm, t, "Opening titles");
    const v = await submit(U.pm, t, await link(P, "Titles v1", U.pm), "titles-attempt-1");
    const cur = (await register(U.pm, P, t)).rows[0].current;
    expect(cur).toMatchObject({ needs_reviewer: true, eligible_reviewers: [], can_assign: true });
    await expect(decide(U.opsDual, v.id, "approved")).rejects.toThrow(/cannot review your own work/);                 // holds the Operations role, but it is their task
    expect((await register(U.opsDual, P, t)).rows[0].current).toMatchObject({ can_decide: false });
    const ov = await call<Row>(U.opsDual, `ops_overview('${CO.a}')`);
    expect(ov.output_reviews.find((x: Row) => x.version_id === v.id)).toMatchObject({ needs_reviewer: true });
    const work = await call<Row>(U.pm, `proj_work_overview('${P}')`);
    const line = work.attention.find((a: Row) => a.kind === "ops_reviewer_needed");
    expect(line).toMatchObject({ task_id: t });
    expect(line.who).toHaveLength(1);                                                                                  // the responsible person: the Project Manager
    // an Operations Manager who is the SUBMITTER (a PM holding the role) cannot decide their own submission either
    await admin(`update proj_company_grants set revoked_at = null where user_id in ('${U.ops1}', '${U.ops2}') and company_id = '${CO.a}'`);
    await admin(`update proj_company_grants set capabilities = '{operations}' where user_id = '${U.pm}' and company_id = '${CO.a}'`);
    const t2 = await createTask(U.pm, P, { title: "End card", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t2, "End card");
    const v2 = await submit(U.pm, t2, await link(P, "End card v1", U.pm), "endcard-attempt-1");
    await expect(decide(U.pm, v2.id, "approved")).rejects.toThrow(/cannot review your own work/);
    expect((await register(U.pm, P, t2)).rows[0].current.eligible_reviewers.map((r: Row) => r.id)).not.toContain(U.pm);
    await admin(`update proj_company_grants set capabilities = '{}' where user_id = '${U.pm}' and company_id = '${CO.a}'`);
  });

  it("a new version has its own review and an old version can never approve the newer one; the task moves with an Operations decision", async () => {
    const t = await createTask(U.pm, P, { title: "Sizzle reel", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Sizzle reel");
    await call(U.design, `proj_set_task_status('${t}', 'in_progress', null)`);
    const v1 = await submit(U.pm, t, await link(P, "Reel v1", U.pm), "reel-attempt-1");
    await call(U.ops1, `proj_decide_task_output('${v1.id}', 'changes_requested', 'Too long')`);
    const v2 = await submit(U.pm, t, await link(P, "Reel v2", U.pm), "reel-attempt-2");
    expect(v2).toMatchObject({ version_no: 2, review_route: "operations" });
    const rows = (await register(U.pm, P, t)).rows[0];
    expect(rows.versions.map((x: Row) => [x.version_no, x.status])).toEqual([[2, "awaiting"], [1, "changes_requested"]]);   // v1 keeps its own decision
    await expect(decide(U.ops1, v1.id, "approved")).rejects.toThrow(/no longer the current one|already decided/);        // the old link cannot approve
    // a task waiting for review is completed by the Operations approval, and the assignee is told
    await call(U.design, `proj_set_task_status('${t}', 'ready_for_review', null)`);
    await decide(U.ops1, v2.id, "approved");
    expect((await admin<{ status: string }>(`select status from proj_tasks where id = '${t}'`))[0]!.status).toBe("done");
    expect(await count(`select 1 from notifications where user_id = '${U.design}' and type = 'project_review_result' and payload->>'task_id' = '${t}'`)).toBeGreaterThan(0);
    // history says who reviewed
    expect(await count(`select 1 from proj_change_log where project_id = '${P}' and entity_id = '${t}' and field = 'review route'`)).toBeGreaterThan(0);
  });

  it("an Operations Manager is notified with a direct link to the version, once", async () => {
    const t = await createTask(U.pm, P, { title: "Bumper", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Bumper");
    const v = await submit(U.pm, t, await link(P, "Bumper v1", U.pm), "bumper-attempt-1");
    await submit(U.pm, t, await link(P, "Bumper v1", U.pm), "bumper-attempt-1");                                               // a retry makes no second notice
    const n = await admin<{ payload: Row }>(`select payload from notifications where user_id = '${U.ops1}' and type = 'project_review_requested' and payload->>'version_id' = '${v.id}'`);
    expect(n).toHaveLength(1);
    expect(n[0]!.payload).toMatchObject({ task_id: t, version_id: v.id, operations: true });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------ owner packs (last: it rolls the migration back and applies it again)
  it("the owner packs: preflight has no STOP, verify says OK, rollback refuses while data exists and, once it is cleared, restores the previous behaviour; applying again works", async () => {
    const pre = (await admin<{ item: string; result: string }>(manual("proj_phase2_teams_crew_ops_review_00_preflight_readonly.sql")));
    expect(pre.filter((r) => /^STOP/.test(r.result))).toEqual([]);
    const verify = async () => await admin<{ item: string; result: string }>(manual("proj_phase2_teams_crew_ops_review_20_verify_readonly.sql"));
    const v1 = await verify();
    expect(v1.filter((r) => r.result === "FAIL" || r.result.startsWith("FAIL"))).toEqual([]);
    expect(v1).toHaveLength(9);
    // the Phase 2 verify script, run by the owner before, still passes after this migration
    const phase2 = await admin<{ item: string; result: string }>(manual("proj_phase2_deliverables_site_20_verify_readonly.sql"));
    expect(phase2.filter((r) => r.result.startsWith("FAIL"))).toEqual([]);
    await expect(db.seed(manual("proj_phase2_teams_crew_ops_review_90_rollback.sql"))).rejects.toThrow(/STOP/);              // data exists
    await admin(`delete from proj_site_crew; delete from proj_task_output_versions where review_route = 'operations'; delete from proj_change_log where entity_type = 'team';
                 update proj_teams set head_user_id = '${U.head}' where head_user_id is null;
                 update proj_plan_items set ready_hardware = 'unknown', ready_content = 'unknown', ready_app = 'unknown', ready_note = null, crew_instructions = null`);
    await db.seed(manual("proj_phase2_teams_crew_ops_review_90_rollback.sql"));
    await db.seed(manual("proj_phase2_teams_crew_ops_review_90_rollback.sql"));                                              // safe twice
    expect((await admin<{ is_nullable: string }>(`select is_nullable from information_schema.columns where table_name = 'proj_teams' and column_name = 'head_user_id'`))[0]!.is_nullable).toBe("NO");
    expect(await count(`select 1 from information_schema.columns where table_name = 'proj_task_output_versions' and column_name = 'review_route'`)).toBe(0);
    expect(await count(`select 1 from pg_proc where proname = 'proj_my_site_assignments'`)).toBe(0);
    expect(await count(`select 1 from pg_proc where proname = 'ops_overview_base'`)).toBe(0);
    expect((await call<Row>(U.ops1, `ops_overview('${CO.a}')`)).output_reviews).toBeUndefined();                              // the original read
    const old = await call<Row>(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.eng, role: "installation" }])})`);   // the two-argument function is the original again
    expect(old).toMatchObject({ added: 1, removed: 0 });
    await expect(call(U.pm, `proj_set_site_crew('${SETUP}', ${j([{ user_id: U.tech1, role: "installation" }])})`)).rejects.toThrow(/active members/);   // site-only crew is not possible again
    // applying the migration again restores everything
    await db.seed(migrationSql());
    const v2 = await verify();
    expect(v2.filter((r) => r.result.startsWith("FAIL"))).toEqual([]);
    expect((await call<Row>(U.ops1, `ops_overview('${CO.a}')`)).output_reviews).toBeDefined();
    expect(await call<Row[]>(U.tech1, "proj_my_site_assignments()")).toEqual([]);
  });
});
