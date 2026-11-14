import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects Phase 2 follow-up 2 (migration 20270108000100_proj_phase2_crew_briefing.sql), against a real Postgres. Fictional data throughout.
// A crew card must show a date, a venue, a personal call time and readiness without anyone typing them twice:
//   * venue: the activity's own, else the project's recorded venue;
//   * date: the activity's own, else the project's committed date, ONLY when exactly one activity of that kind exists; with several runs nothing is guessed and the Project Manager is asked to choose;
//   * readiness: the Project Manager's own value, else derived from the Project Plan (counts only); Not applicable and Not recorded are different states;
//   * call time stays personal; the Project Manager sees what is still missing; a site-only technician still reads nothing but their own assignment.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), member: id(), tech: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@briefing.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe("Projects Phase 2 follow-up 2: the crew card and the briefing", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const proj = async (ref: string, name: string, extra: { location?: string | null; install?: string | null; ev1?: string | null; ev2?: string | null } = {}, company = CO.a, pm = U.pm) => {
    const p = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${company}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    await admin(`insert into proj_project_details (project_id, location, site_timezone, scope, technologies, install_start, event_start, event_end) values ('${p}', ${extra.location ? `'${extra.location}'` : "null"}, 'Asia/Dubai', null, '[]'::jsonb, ${extra.install ? `'${extra.install}'` : "null"}, ${extra.ev1 ? `'${extra.ev1}'` : "null"}, ${extra.ev2 ? `'${extra.ev2}'` : "null"})`);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${pm}', 'pm')${company === CO.a ? `, ('${p}', '${U.member}', 'member')` : ""}`);
    return p;
  };
  const activity = (p: string, f: Row) => call<Row>(U.pm, `proj_save_site_activity('${p}', null, ${j(f)})`).then((r) => r.id as string);
  const briefing = async (user: string, p: string): Promise<Row[]> => call<Row[]>(user, `proj_site_briefing('${p}')`);
  const mineOf = async (user: string, activityId: string) => (await call<Row[]>(user, "proj_my_site_assignments()")).find((r) => r.activity_id === activityId);

  let P = "", PB = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.b}', '{}');
      insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values ('${U.tech}', 'EMP-901', '${CO.a}', 'AE', 'Fictional', 'Tech', '2024-01-01');
    `);
    P = await proj("UAE-P-2027-0801", "Fictional briefing job", { location: "Fictional Expo Centre, Hall 3", install: day(10), ev1: day(12), ev2: day(14) });
    PB = await proj("OTH-P-2027-0801", "Fictional other company job", {}, CO.b, U.outsider);
  });
  afterAll(async () => db.teardown());

  it("venue: an activity without its own venue uses the project's recorded venue (and says so); its own venue wins", async () => {
    const setup = await activity(P, { activity_kind: "setup", title: "Setup", activity_state: "tentative" });
    await call(U.pm, `proj_set_site_crew('${setup}', ${j([{ user_id: U.tech, role: "installation" }])}, null)`);
    const mine = await mineOf(U.tech, setup);
    expect(mine!.effective).toMatchObject({ venue: "Fictional Expo Centre, Hall 3", venue_source: "project" });
    await admin(`update proj_plan_items set location = 'Loading bay 2' where id = '${setup}'`);
    expect((await mineOf(U.tech, setup))!.effective).toMatchObject({ venue: "Loading bay 2", venue_source: "activity" });
    await admin(`update proj_plan_items set location = null where id = '${setup}'`);
  });

  it("date: with exactly one setup the project's installation date is used and labelled; with a second run nothing is guessed and the PM is asked to choose; choosing copies the date", async () => {
    const [only] = (await briefing(U.pm, P)).filter((b) => b.effective.date_source === "project");
    expect(only!.effective).toMatchObject({ start_date: day(10), end_date: day(10), date_source: "project", choice_pending: false });
    const setup = only!.id as string;
    expect((await mineOf(U.tech, setup))!.effective).toMatchObject({ start_date: day(10), date_source: "project" });             // the technician sees it too
    // a second run makes the link ambiguous
    const run2 = await activity(P, { activity_kind: "setup", title: "Setup run 2", run_label: "Run 2", activity_state: "tentative" });
    const b = await briefing(U.pm, P);
    for (const id of [setup, run2]) {
      const row = b.find((x) => x.id === id)!;
      expect(row.effective).toMatchObject({ start_date: null, date_source: null, choice_pending: true });
      expect(row.gaps).toContain("choose_run");
      expect(row.candidates.map((c: Row) => c.id).sort()).toEqual([setup, run2].sort());
    }
    expect((await mineOf(U.tech, setup))!.effective).toMatchObject({ start_date: null, date_source: null });                      // not guessed for the technician either
    await expect(call(U.member, `proj_apply_project_dates('${run2}')`)).rejects.toThrow();                                           // not a manager
    await expect(call(U.outsider, `proj_apply_project_dates('${run2}')`)).rejects.toThrow();
    expect(await call<Row>(U.pm, `proj_apply_project_dates('${run2}')`)).toMatchObject({ applied: true });
    expect(await call<Row>(U.pm, `proj_apply_project_dates('${run2}')`)).toMatchObject({ unchanged: true });                      // clicking twice is harmless
    const after = await briefing(U.pm, P);
    expect(after.find((x) => x.id === run2)!.effective).toMatchObject({ start_date: day(10), date_source: "activity" });
    expect(after.find((x) => x.id === setup)!.gaps).toContain("choose_run");                                                          // the other run still has to be chosen
    expect(Number((await admin<{ n: string }>(`select count(*) n from proj_change_log where entity_id = '${run2}' and field = 'date'`))[0]!.n)).toBeGreaterThan(0);
    await admin(`delete from proj_site_crew where plan_item_id = '${setup}'; delete from proj_plan_items where id in ('${setup}', '${run2}')`);
  });

  it("an activity kind with no recorded project date is never guessed (a dismantling stays undated and says so)", async () => {
    const dism = await activity(P, { activity_kind: "dismantling", title: "Dismantling", activity_state: "tentative" });
    const row = (await briefing(U.pm, P)).find((x) => x.id === dism)!;
    expect(row.effective).toMatchObject({ start_date: null, date_source: null, choice_pending: false });
    expect(row.gaps).toContain("date");
    await expect(call(U.pm, `proj_apply_project_dates('${dism}')`)).rejects.toThrow(/no recorded date/);
    await admin(`delete from proj_plan_items where id = '${dism}'`);
  });

  it("readiness: Not recorded when nothing is recorded; the PM's own value (including Not applicable) wins; otherwise it comes from the Project Plan, as counts only", async () => {
    const show = await activity(P, { activity_kind: "show", title: "Show", activity_state: "tentative", start_date: day(12), end_date: day(14) });
    let row = (await briefing(U.pm, P)).find((x) => x.id === show)!;
    expect(row.ready.hardware.state).toBe("not_recorded");
    expect(row.ready.content.state).toBe("not_recorded");
    expect(row.gaps).toContain("readiness");
    // the PM marks the app as Not applicable, the content as ready
    await call(U.pm, `proj_set_activity_readiness('${show}', ${j({ app: "not_applicable", content: "ready" })})`);
    row = (await briefing(U.pm, P)).find((x) => x.id === show)!;
    expect(row.ready.app).toMatchObject({ state: "not_applicable", source: "pm" });
    expect(row.ready.content).toMatchObject({ state: "ready", source: "pm" });
    // the Project Plan: a hardware line (no task or request yet) and two content lines, one with a finished task; nothing for apps
    const item = (await admin<{ id: string }>(`insert into proj_dp_items (project_id, item_key, zone, title, owner_id, sort_order, created_by) values ('${P}', 'D001', 'Hall', 'Fictional wall', '${U.pm}', 10, '${U.pm}') returning id`))[0]!.id;
    await admin(`insert into proj_dp_state (project_id, rev, next_item, next_line) values ('${P}', 1, 2, 4) on conflict do nothing`);
    await admin(`insert into proj_dp_lines (project_id, item_id, line_key, section, description, created_by) values
      ('${P}', '${item}', 'L0001', 'hardware', 'Secret LED wall panels', '${U.pm}'), ('${P}', '${item}', 'L0002', 'content', 'Secret intro film', '${U.pm}'), ('${P}', '${item}', 'L0003', 'content', 'Secret stills', '${U.pm}')`);
    await call(U.pm, `proj_set_activity_readiness('${show}', ${j({ content: "unknown", app: "unknown" })})`);                         // back to "not recorded": the plan now speaks
    row = (await briefing(U.pm, P)).find((x) => x.id === show)!;
    // 20270109000100: the Project Plan's counts are PROJECT-WIDE and stay apart; the run itself has no evidence yet, so it is Not recorded
    expect(row.ready.hardware).toMatchObject({ state: "not_recorded" });
    expect(row.ready.content).toMatchObject({ state: "not_recorded" });
    expect(row.ready.project!.hardware).toMatchObject({ state: "not_ready", detail: "0 of 1 equipment lines reserved or sent" });
    expect(row.ready.project!.content).toMatchObject({ state: "not_ready", detail: "0 of 2 outputs approved" });
    expect(row.ready.project!.app).toMatchObject({ state: "not_applicable" });
    const t = await call<string>(U.pm, `proj_create_task('${P}', ${j({ title: "Intro film", assignee_id: U.member })})`);
    await admin(`update proj_dp_lines set task_id = '${t}' where line_key = 'L0002' and project_id = '${P}'; update proj_tasks set status = 'done', completed_at = now() where id = '${t}'`);
    row = (await briefing(U.pm, P)).find((x) => x.id === show)!;
    expect(row.ready.content).toMatchObject({ state: "not_recorded" });                                                                // a finished task alone is not an approved output
    expect(row.ready.project!.content.state).not.toBe("ready");
    // a technician sees states for their own activity, never a line, task or file name
    await call(U.pm, `proj_set_site_crew('${show}', ${j([{ user_id: U.tech, role: "installation" }])}, null)`);
    const mine = await mineOf(U.tech, show);
    expect(mine!.ready_effective.content).toMatchObject({ state: "not_recorded" });
    expect(JSON.stringify(mine)).not.toMatch(/Secret|Intro film|task_id|file|budget|scope/i);
    await expect(call(U.tech, `proj_site_briefing('${P}')`)).rejects.toThrow();                                                       // the PM view is not a technician read
    await admin(`delete from proj_dp_lines where project_id = '${P}'; delete from proj_site_crew where plan_item_id = '${show}'; delete from proj_plan_items where id = '${show}'`);
  });

  it("call time stays personal and explicit: the PM sees how many people have none, and the gap closes when each has one", async () => {
    const show = await activity(P, { activity_kind: "show", title: "Show run", activity_state: "tentative", start_date: day(12), end_date: day(12), starts_local: `${day(12)}T10:00`, ends_local: `${day(12)}T18:00` });
    await call(U.pm, `proj_set_site_crew('${show}', ${j([{ user_id: U.tech, role: "installation" }, { user_id: U.member, role: "standby", call_local: `${day(12)}T08:30` }])}, null)`);
    let row = (await briefing(U.pm, P)).find((x) => x.id === show)!;
    expect(row).toMatchObject({ crew_total: 2, call_missing: 1 });
    expect(row.gaps).toContain("call_time");
    expect((await mineOf(U.tech, show))!.call_at).toBeNull();                                                                         // explicit: nothing is invented for the technician
    await call(U.pm, `proj_set_site_crew('${show}', ${j([{ user_id: U.tech, role: "installation", call_local: `${day(12)}T08:00` }, { user_id: U.member, role: "standby", call_local: `${day(12)}T08:30` }])}, null)`);
    row = (await briefing(U.pm, P)).find((x) => x.id === show)!;
    expect(row.call_missing).toBe(0);
    expect(row.gaps).not.toContain("call_time");
    expect((await mineOf(U.tech, show))!.call_at).toBeTruthy();
    await admin(`delete from proj_site_crew where plan_item_id = '${show}'; delete from proj_plan_items where id = '${show}'`);
  });

  it("another company reads nothing: no briefing, no assignment, no date to apply", async () => {
    const other = (await call<Row>(U.outsider, `proj_save_site_activity('${PB}', null, ${j({ activity_kind: "setup", title: "Other setup", activity_state: "tentative" })})`)).id as string;
    await expect(call(U.pm, `proj_site_briefing('${PB}')`)).rejects.toThrow();
    await expect(call(U.pm, `proj_apply_project_dates('${other}')`)).rejects.toThrow();
    expect(await call<Row[]>(U.pm, "proj_my_site_assignments()")).toEqual([]);
  });

  it("the owner packs: verify still passes with the new migration, and rollback restores the previous read", async () => {
    const verify = await admin<{ item: string; result: string }>(manual("proj_phase2_crew_briefing_20_verify_readonly.sql"));
    // row 3 describes the body of proj_my_site_assignments that 20270109000100 deliberately replaced (the site-state verify pack checks the new one)
    expect(verify.filter((r) => r.result.startsWith("FAIL") && !r.item.startsWith("the technician read carries"))).toEqual([]);
    const pre = await admin<{ item: string; result: string }>(manual("proj_phase2_crew_briefing_00_preflight_readonly.sql"));
    expect(pre.filter((r) => /^STOP/.test(r.result))).toEqual([]);
    await admin(`update proj_plan_items set ready_app = 'unknown' where ready_app = 'not_applicable'`);
    await db.seed(manual("proj_phase2_site_state_90_rollback.sql"));                                                                  // later migrations are rolled back first
    await db.seed(manual("proj_phase2_crew_briefing_90_rollback.sql"));
    await db.seed(manual("proj_phase2_crew_briefing_90_rollback.sql"));                                                               // safe twice
    expect(await admin(`select 1 from pg_proc where proname = 'proj_site_briefing'`)).toHaveLength(0);
    const mine = await call<Row[]>(U.tech, "proj_my_site_assignments()");
    expect(mine.every((r) => r.effective === undefined)).toBe(true);                                                                  // the applied read is back
    await expect(admin(`update proj_plan_items set ready_app = 'not_applicable' where false; insert into proj_plan_items (project_id, plan, title, start_date, end_date, status, activity_kind, ready_app, created_by) values ('${P}', 'site', 'x', current_date, current_date, 'planned', 'setup', 'not_applicable', '${U.pm}')`)).rejects.toThrow();   // the narrower check is back
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/migrations/20270108000100_proj_phase2_crew_briefing.sql"), "utf8"));   // applying again works
    expect(await admin(`select 1 from pg_proc where proname = 'proj_site_briefing'`)).toHaveLength(1);
  });
});
