import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects Phase 2 follow-up 3 (migration 20270109000100_proj_phase2_site_state.sql), against a real Postgres. Fictional data throughout.
//   * a suggested project date, a scheduled activity and an ACTUAL START are different facts: started only with an explicit record, never because a date passed;
//   * readiness is scoped (project-wide counts apart from a run's own evidence) and a finished task alone proves neither an approved output nor equipment readiness;
//   * the Project Manager's preview of a briefing IS the technician's own read; a tentative assignment stays visible; the contact is named;
//   * the dated activities of a company's live projects are readable once each, under the reader's own access;
//   * crew are told when a CONFIRMED date or venue moves, or a call time moves, previous and new values, affected assignments only.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), member: id(), tech: id(), tech2: id(), lead: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@sitestate.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe("Projects Phase 2 follow-up 3: one site activity, told the same way everywhere", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const proj = async (ref: string, name: string, extra: { install?: string | null; ev1?: string | null; ev2?: string | null; location?: string | null } = {}, company = CO.a, pm = U.pm) => {
    const p = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${company}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    await admin(`insert into proj_project_details (project_id, location, site_timezone, scope, technologies, install_start, event_start, event_end) values ('${p}', ${extra.location ? `'${extra.location}'` : "null"}, 'Asia/Dubai', null, '[]'::jsonb, ${extra.install ? `'${extra.install}'` : "null"}, ${extra.ev1 ? `'${extra.ev1}'` : "null"}, ${extra.ev2 ? `'${extra.ev2}'` : "null"})`);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${pm}', 'pm')${company === CO.a ? `, ('${p}', '${U.member}', 'member')` : ""}`);
    return p;
  };
  const activity = (user: string, p: string, f: Row) => call<Row>(user, `proj_save_site_activity('${p}', null, ${j(f)})`).then((r) => r.id as string);
  const crew = (act: string, rows: Row[]) => call<Row>(U.pm, `proj_set_site_crew('${act}', ${j(rows)}, null)`);
  const phase = async (act: string) => (await call<Row>(U.pm, `proj_site_phase_json('${act}')`).catch(() => null)) ?? (await admin<{ j: Row }>(`select proj_site_phase_json('${act}') as j`))[0]!.j;
  const notes = (user: string) => admin<{ type: string; payload: Row }>(`select type, payload from notifications where user_id = '${user}' and type = 'project_site_change' order by created_at`);
  const mine = async (user: string, act: string) => (await call<Row[]>(user, "proj_my_site_assignments()")).find((r) => r.activity_id === act);

  let P = "", PB = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'), ('${U.lead}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.b}', '{}');
      insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${U.tech}', 'EMP-951', '${CO.a}', 'AE', 'Fictional', 'Tech', '2024-01-01'), ('${U.tech2}', 'EMP-952', '${CO.a}', 'AE', 'Fictional', 'Tech2', '2024-01-01');
    `);
    P = await proj("UAE-P-2027-0901", "Fictional state job", { install: day(-3), ev1: day(4), ev2: day(6), location: "Fictional Expo Centre, Hall 3" });
    PB = await proj("OTH-P-2027-0901", "Fictional other company job", {}, CO.b, U.outsider);
  });
  afterAll(async () => db.teardown());

  it("a passed project date alone is never an actual start; only the explicit record is; scheduled, due today and no date are told apart", async () => {
    const setup = await activity(U.pm, P, { activity_kind: "setup", title: "Setup", activity_state: "tentative" });             // the one setup: borrows the project's installation date (3 days ago)
    expect(await phase(setup)).toMatchObject({ phase: "date_passed", basis: "project_header", first_day: day(-3), started_at: null });
    await expect(call(U.member, `proj_record_site_start('${setup}', null, null)`)).rejects.toThrow();                                // a member who is not the manager
    await expect(call(U.pm, `proj_record_site_start('${setup}', '${new Date(Date.now() + 86400000).toISOString()}', null)`)).rejects.toThrow(/future/);
    expect(await call<Row>(U.pm, `proj_record_site_start('${setup}', null, 'Crew arrived at 09:00')`)).toMatchObject({ recorded: true });
    expect(await phase(setup)).toMatchObject({ phase: "started", basis: "project_header" });
    expect(await call<Row>(U.pm, `proj_clear_site_start('${setup}')`)).toMatchObject({ cleared: true });
    expect((await phase(setup)).phase).toBe("date_passed");
    const own = await activity(U.pm, P, { activity_kind: "show", title: "Show (own date)", activity_state: "tentative", start_date: day(2), end_date: day(2) });
    expect(await phase(own)).toMatchObject({ phase: "scheduled", basis: "activity", first_day: day(2) });
    await admin(`update proj_plan_items set start_date = current_date, end_date = current_date where id = '${own}'`);
    expect((await phase(own)).phase).toMatch(/due_today|date_passed/);                                                               // today in the project zone: never "started"
    await admin(`update proj_plan_items set start_date = '${day(-5)}', end_date = '${day(-4)}' where id = '${own}'`);
    expect(await phase(own)).toMatchObject({ phase: "date_passed", basis: "activity" });
    const none = await activity(U.pm, P, { activity_kind: "dismantling", title: "Dismantling", activity_state: "tentative" });
    expect(await phase(none)).toMatchObject({ phase: "no_date", basis: "none" });
    await admin(`delete from proj_plan_items where id in ('${setup}', '${own}', '${none}')`);
  });

  it("the technician's own read and the Project Manager's preview are the same record; a tentative assignment stays visible; the contact is named; missing reporting details are listed", async () => {
    const act = await activity(U.pm, P, { activity_kind: "setup", title: "Setup (preview)", activity_state: "tentative", start_date: day(-9), end_date: day(-9) });     // tentative and long past
    await crew(act, [{ user_id: U.tech, role: "installation" }]);
    const own = await mine(U.tech, act);
    expect(own).toBeTruthy();                                                                                                        // not silently dropped although the date passed
    expect(own!.phase).toMatchObject({ phase: "date_passed", basis: "activity" });
    expect(own!.contact).toMatchObject({ role: "Project Manager" });                                                                 // no site lead named: the PM is the contact
    expect(own!.reporting).toMatchObject({ complete: false });
    expect(own!.reporting.missing).toContain("call_time");
    const preview = await call<Row>(U.pm, `proj_preview_site_assignment('${act}', '${U.tech}')`);
    const { preview: p1, person, ...rest } = preview; void p1; void person;
    expect(rest).toEqual(own);                                                                                                       // exactly what the technician sees
    expect(preview.person).toBeTruthy();
    await expect(call(U.member, `proj_preview_site_assignment('${act}', '${U.tech}')`)).rejects.toThrow(/Project Manager/);
    await expect(call(U.outsider, `proj_preview_site_assignment('${act}', '${U.tech}')`)).rejects.toThrow();
    expect(await call(U.pm, `proj_preview_site_assignment('${act}', '${U.tech2}')`)).toBeNull();                                      // not on the crew: nothing to preview
    await admin(`update proj_plan_items set owner_id = '${U.lead}' where id = '${act}'`);
    expect((await mine(U.tech, act))!.contact).toMatchObject({ role: "Site lead" });
    // a CONFIRMED activity that ended days ago is dropped (as before); a tentative one is not
    await admin(`update proj_plan_items set activity_state = 'confirmed', confirmed_at = now(), confirmed_by = '${U.pm}' where id = '${act}'`);
    await admin(`update proj_plan_items set start_date = null, end_date = null, starts_at = ((current_date - 9)::timestamp at time zone 'Asia/Dubai'), ends_at = ((current_date - 8)::timestamp at time zone 'Asia/Dubai'), tz = 'Asia/Dubai' where id = '${act}'`);
    expect(await mine(U.tech, act)).toBeUndefined();
    await admin(`delete from proj_site_crew where plan_item_id = '${act}'; delete from proj_plan_items where id = '${act}'`);
  });

  it("readiness is scoped: project-wide counts are labelled and apart; a run's own readiness needs the PM or evidence linked to it; a finished task alone proves nothing", async () => {
    const ms = (await admin<{ id: string }>(`insert into proj_milestones (project_id, title, due_date, created_by) values ('${P}', 'Run 1 ready', '${day(3)}', '${U.pm}') returning id`))[0]!.id;
    const run1 = await activity(U.pm, P, { activity_kind: "show", title: "Show run 1", activity_state: "tentative", start_date: day(4), end_date: day(4), milestone_id: ms });
    const run2 = await activity(U.pm, P, { activity_kind: "show", title: "Show run 2", run_label: "Run 2", activity_state: "tentative", start_date: day(6), end_date: day(6) });
    const item = (await admin<{ id: string }>(`insert into proj_dp_items (project_id, item_key, zone, title, owner_id, sort_order, created_by) values ('${P}', 'D901', 'Hall', 'Fictional wall', '${U.pm}', 10, '${U.pm}') returning id`))[0]!.id;
    await admin(`insert into proj_dp_state (project_id, rev, next_item, next_line) values ('${P}', 1, 2, 5) on conflict do nothing`);
    await admin(`insert into proj_dp_lines (project_id, item_id, line_key, section, description, milestone_id, created_by) values
      ('${P}', '${item}', 'L9001', 'content', 'Secret film', '${ms}', '${U.pm}'), ('${P}', '${item}', 'L9002', 'hardware', 'Secret panels', '${ms}', '${U.pm}'), ('${P}', '${item}', 'L9003', 'content', 'Secret stills (no milestone)', null, '${U.pm}')`);
    const t = await call<string>(U.pm, `proj_create_task('${P}', ${j({ title: "Film", assignee_id: U.member })})`);
    await admin(`update proj_dp_lines set task_id = '${t}' where line_key = 'L9001' and project_id = '${P}'; update proj_tasks set status = 'done', completed_at = now() where id = '${t}'`);
    const row = async (a: string) => (await call<Row[]>(U.pm, `proj_site_briefing('${P}')`)).find((b) => b.id === a)!.ready;
    let r1 = await row(run1);
    expect(r1.content).toMatchObject({ state: "not_ready", source: "run" });                                                         // the task is done, but no output was approved
    expect(r1.content.detail).toBe("0 of 1 outputs approved");
    expect(r1.hardware).toMatchObject({ state: "not_ready", source: "run" });
    expect(r1.app).toMatchObject({ state: "not_applicable", source: "run" });                                                        // the run's scope has lines, none of this kind
    expect(r1.project.content).toMatchObject({ state: "not_ready", level: "project" });                                              // project-wide, kept apart
    expect(r1.project.content.detail).toBe("0 of 2 outputs approved");
    const r2 = await row(run2);                                                                                                        // no milestone, no shipment: no evidence for THIS run
    expect(r2.content).toMatchObject({ state: "not_recorded", source: null });
    expect(r2.hardware).toMatchObject({ state: "not_recorded" });
    expect(r2.project.content.state).toBe("not_ready");                                                                              // the project-wide figure does not become run 2's readiness
    // an approved output version establishes the content line
    await admin(`with f as (insert into proj_files (project_id, kind, purpose, label, url, uploaded_by) values ('${P}', 'link', 'document', 'film', 'https://docs.example.com/film', '${U.pm}') returning id)
                 insert into proj_task_output_versions (project_id, task_id, version_no, file_id, item_count, submitted_by, status, decided_by, decided_at, approved_by, approved_at)
                 select '${P}', '${t}', 1, f.id, 1, '${U.member}', 'approved', '${U.pm}', now(), '${U.pm}', now() from f`);
    r1 = await row(run1);
    expect(r1.content).toMatchObject({ state: "ready", detail: "1 of 1 outputs approved" });
    // the PM's own assessment wins and is labelled as such
    await call(U.pm, `proj_set_activity_readiness('${run2}', ${j({ hardware: "not_applicable" })})`);
    expect((await row(run2)).hardware).toMatchObject({ state: "not_applicable", source: "pm" });
    // the technician sees states and counts only
    await crew(run1, [{ user_id: U.tech, role: "installation" }]);
    expect(JSON.stringify(await mine(U.tech, run1))).not.toMatch(/Secret|Film|task_id|"file|budget/i);
    await admin(`delete from proj_site_crew where plan_item_id = '${run1}'; delete from proj_dp_lines where project_id = '${P}'; delete from proj_plan_items where id in ('${run1}', '${run2}')`);
  });

  it("the dated activities of a company's live projects are read once each, bounded, under the reader's own access", async () => {
    const a = await activity(U.pm, P, { activity_kind: "setup", title: "Setup A", run_label: "Run 1", activity_state: "tentative", start_date: day(5), end_date: day(5) });
    const b = await activity(U.pm, P, { activity_kind: "dismantling", title: "Dismantle A", activity_state: "tentative", start_date: day(7), end_date: day(7) });
    const c = await activity(U.pm, P, { activity_kind: "setup", title: "Setup B", run_label: "Run 2", activity_state: "tentative", start_date: day(9), end_date: day(9) });
    const rows = await call<Row[]>(U.pm, `proj_site_activities_read('${CO.a}', null, 300)`);
    const mine3 = rows.filter((r) => [a, b, c].includes(r.id));
    expect(mine3.map((r) => r.id).sort()).toEqual([a, b, c].sort());                                                                  // each once
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(mine3.find((r) => r.id === b)).toMatchObject({ kind: "dismantling", reference: "UAE-P-2027-0901", project_id: P });
    expect((await call<Row[]>(U.pm, `proj_site_activities_read('${CO.a}', '${P}', 2)`))).toHaveLength(2);                              // bounded
    expect(await call<Row[]>(U.outsider, `proj_site_activities_read('${CO.a}', null, 300)`)).toEqual([]);                              // another company's person reads nothing
    expect(await call<Row[]>(U.tech, `proj_site_activities_read('${CO.a}', null, 300)`)).toEqual([]);                                 // a site-only technician has no project view
    expect(await call<Row[]>(U.pm, `proj_site_activities_read('${CO.b}', null, 300)`)).toEqual([]);
    await admin(`delete from proj_plan_items where id in ('${a}', '${b}', '${c}')`);
  });

  it("crew are told when a CONFIRMED date or venue moves, or a call time moves: previous and new values, affected assignments only, nothing for tentative work or the actor", async () => {
    await admin(`delete from notifications where type = 'project_site_change'`);
    const act = await activity(U.pm, P, { activity_kind: "setup", title: "Setup (notice)", activity_state: "tentative", start_date: day(5), end_date: day(5), location: "Hall 1" });
    const other = await activity(U.pm, P, { activity_kind: "show", title: "Other activity", activity_state: "tentative", start_date: day(8), end_date: day(8) });
    await crew(act, [{ user_id: U.tech, role: "installation" }, { user_id: U.member, role: "standby" }]);
    await crew(other, [{ user_id: U.tech2, role: "installation" }]);
    // tentative changes: nobody is told
    await call(U.pm, `proj_save_site_activity('${P}', '${act}', ${j({ start_date: day(6), end_date: day(6), expected_version: (await admin<{ version: number }>(`select version from proj_plan_items where id = '${act}'`))[0]!.version })})`).catch(() => undefined);
    await admin(`update proj_plan_items set start_date = '${day(6)}', end_date = '${day(6)}' where id = '${act}'`);
    const early = await notes(U.tech);
    expect(early, JSON.stringify(early)).toHaveLength(0);
    // confirm, then move the date and the venue through the real save (as the Project Manager)
    await admin(`update proj_plan_items set activity_state = 'confirmed', confirmed_at = now(), confirmed_by = '${U.pm}' where id = '${act}'`);
    const ver = Number((await admin<{ version: number }>(`select version from proj_plan_items where id = '${act}'`))[0]!.version);
    await call(U.pm, `proj_save_site_activity('${P}', '${act}', ${j({ start_date: day(7), end_date: day(7), location: "Hall 2", reason: "The hall changed", expected_version: ver })})`);
    const n = await notes(U.tech);
    expect(n).toHaveLength(1);
    expect(n[0]!.payload).toMatchObject({ site_change: true, activity_id: act, title: "Setup (notice)" });
    const fields = Object.fromEntries((n[0]!.payload.changes as Row[]).map((c) => [c.field, c]));
    expect(fields.date).toMatchObject({ from: expect.stringContaining(day(6).slice(0, 4)), to: expect.stringContaining(day(7).slice(0, 4)) });
    expect(fields.venue).toMatchObject({ from: "Hall 1", to: "Hall 2" });
    expect((await notes(U.member))).toHaveLength(1);                                                                                  // the other person on THIS activity is told too
    expect(await notes(U.tech2)).toHaveLength(0);                                                                                     // not on this activity: not told
    expect(await notes(U.pm)).toHaveLength(0);                                                                                        // never the actor
    // a personal call time: only that person; it is merged into the notice they have not read yet
    await call(U.pm, `proj_set_site_crew('${act}', ${j([{ user_id: U.tech, role: "installation", call_local: `${day(7)}T07:30` }, { user_id: U.member, role: "standby" }])}, null)`);
    const afterFirst = await notes(U.tech);
    expect(afterFirst).toHaveLength(1);                                                                                              // one unread notice per person per activity
    const call1 = (afterFirst[0]!.payload.changes as Row[]).find((c) => c.field === "call time")!;
    expect(call1).toMatchObject({ from: "not set" });
    expect(call1.to).toContain("07:30");
    expect((afterFirst[0]!.payload.changes as Row[]).map((c) => c.field).sort()).toEqual(["call time", "date", "venue"]);
    expect((await notes(U.member))).toHaveLength(1);                                                                                  // the member's own call time did not move
    expect(((await notes(U.member))[0]!.payload.changes as Row[]).map((c) => c.field)).not.toContain("call time");
    // once read, the next move is a new notice
    await admin(`update notifications set read_at = now() where user_id = '${U.tech}' and type = 'project_site_change'`);
    await call(U.pm, `proj_set_site_crew('${act}', ${j([{ user_id: U.tech, role: "installation", call_local: `${day(7)}T08:15` }, { user_id: U.member, role: "standby" }])}, null)`);
    expect(await notes(U.tech)).toHaveLength(2);
    await admin(`delete from proj_site_crew where plan_item_id in ('${act}', '${other}'); delete from proj_plan_items where id in ('${act}', '${other}'); delete from notifications where type = 'project_site_change'`);
  });

  it("another company cannot record a start or read this project's activities", async () => {
    const a = await activity(U.pm, P, { activity_kind: "setup", title: "Setup (guard)", activity_state: "tentative", start_date: day(5), end_date: day(5) });
    await expect(call(U.outsider, `proj_record_site_start('${a}', null, null)`)).rejects.toThrow();
    await expect(call(U.pm, `proj_site_briefing('${PB}')`)).rejects.toThrow();
    await admin(`delete from proj_plan_items where id = '${a}'`);
    void PB;
  });

  it("the owner packs: verify passes, rollback restores the applied bodies and refuses while start records exist, applying again works", async () => {
    const verify = await admin<{ item: string; result: string }>(manual("proj_phase2_site_state_20_verify_readonly.sql"));
    expect(verify.filter((r) => r.result.startsWith("FAIL"))).toEqual([]);
    const pre = await admin<{ item: string; result: string }>(manual("proj_phase2_site_state_00_preflight_readonly.sql"));
    expect(pre.filter((r) => /^STOP/.test(r.result))).toEqual([]);
    const a = await activity(U.pm, P, { activity_kind: "setup", title: "Setup (rollback)", activity_state: "tentative", start_date: day(-1), end_date: day(-1) });
    await call(U.pm, `proj_record_site_start('${a}', null, null)`);
    await expect(db.seed(manual("proj_phase2_site_state_90_rollback.sql"))).rejects.toThrow(/STOP/);
    await call(U.pm, `proj_clear_site_start('${a}')`);
    await admin(`delete from proj_plan_items where id = '${a}'`);
    await db.seed(manual("proj_phase2_site_state_90_rollback.sql"));
    await db.seed(manual("proj_phase2_site_state_90_rollback.sql"));                                                                  // safe twice
    expect(await admin(`select 1 from pg_proc where proname = 'proj_preview_site_assignment'`)).toHaveLength(0);
    expect(await admin(`select 1 from information_schema.columns where table_name = 'proj_plan_items' and column_name = 'actual_started_at'`)).toHaveLength(0);
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/migrations/20270109000100_proj_phase2_site_state.sql"), "utf8"));
    expect(await admin(`select 1 from pg_proc where proname = 'proj_preview_site_assignment'`)).toHaveLength(1);
  });
});
