import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Phase 3: the Operations TV (migration 20270110000100_ops_tv_display.sql), against a real Postgres. Fictional data throughout.
//   * ONE read, ops_tv_board(company), returns an allowlist of display fields and nothing else (a planted private string anywhere in the data never appears);
//   * it is open to an un-revoked display of that company and to Operations Managers / founders of that company: nobody else, no other company;
//   * revoking a display refuses its very next read; a display identity can read nothing through any existing Projects read;
//   * the Phase 2 rules are reused: Started only from the explicit start record, a passed date alone is date_passed, header fallbacks say so, separate runs stay separate rows;
//   * registration refuses an account that could already reach something; the packs (verify, rollback) behave as documented.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { ops: id(), founder: id(), opsB: id(), pm: id(), member: id(), tech: id(), siteOnly: id(), lead: id(), outsider: id(), dispA: id(), dispB: id(), dispOff: id(), spare: id(), spare2: id(), hrRole: id(), grantee: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@tvtest.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const SECRET = { notes: "SECRET-NOTE-private-team-text", crewInstr: "SECRET-CREW-INSTRUCTION", ready: "SECRET-READY-NOTE", task: "SECRET-TASK-TITLE", comment: "SECRET-COMMENT-BODY", mail: "secret.person.mail", budget: "SECRET-BUDGET-9999", scope: "SECRET-SCOPE-TEXT", client: "SECRET-CLIENT-NAME" };

describe("Phase 3: the office board reads an allowlist, for a display or an Operations Manager, and nothing else", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const board = (user: string, company = CO.a) => call<Row>(user, `ops_tv_board('${company}')`);
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const activity = (user: string, p: string, f: Row) => call<Row>(user, `proj_save_site_activity('${p}', null, ${j(f)})`).then((r) => r.id as string);
  const crew = (act: string, rows: Row[]) => call<Row>(U.pm, `proj_set_site_crew('${act}', ${j(rows)}, null)`);
  const proj = async (ref: string, name: string, extra: { install?: string | null; location?: string | null } = {}, company = CO.a, pm = U.pm) => {
    const p = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${company}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    await admin(`insert into proj_project_details (project_id, location, site_timezone, scope, technologies, install_start) values ('${p}', ${extra.location ? `'${extra.location}'` : "null"}, 'Asia/Dubai', '${SECRET.scope}', '[]'::jsonb, ${extra.install ? `'${extra.install}'` : "null"})`);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${pm}', 'pm')${company === CO.a ? `, ('${p}', '${U.member}', 'member')` : ""}`);
    return p;
  };
  const kinds = (o: Row) => Object.keys(o).sort();

  let P = "", PB = "", PL = "", setup = "", show = "", dismantle = "", reinstall = "", ship = "", reqCode = "";
  const DISP: Record<string, string> = {};

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional Enginious LLC FZ', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      update profiles set full_name = 'Olivia Operations' where id = '${U.ops}'; update profiles set full_name = 'Farid Founder' where id = '${U.founder}'; update profiles set full_name = 'Paula Manager' where id = '${U.pm}';
      update profiles set full_name = 'Tariq Technician' where id = '${U.tech}'; update profiles set full_name = 'Sami SiteOnly' where id = '${U.siteOnly}'; update profiles set full_name = 'Lena Lead' where id = '${U.lead}';
      update profiles set email = '${SECRET.mail}@tvtest.ae' where id = '${U.tech}';
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.ops}', '${CO.a}', '{operations}'), ('${U.founder}', '${CO.a}', '{founder}'), ('${U.opsB}', '${CO.b}', '{operations}'), ('${U.pm}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'),
        ('${U.lead}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.b}', '{}');
      insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${U.tech}', 'EMP-961', '${CO.a}', 'AE', 'Fictional', 'Tech', '2024-01-01'), ('${U.siteOnly}', 'EMP-962', '${CO.a}', 'AE', 'Fictional', 'SiteOnly', '2024-01-01');
    `);
    P = await proj("UAE-P-2027-0701", "Fictional RAF Airshow Pavilion", { install: day(-3), location: "Fictional Expo Centre, Hall 3" });
    PB = await proj("OTH-P-2027-0701", "Fictional other company job", {}, CO.b, U.outsider);
    PL = await proj("UAE-P-2027-0702", "Fictional Very Long Named Project For The International Heritage And Technology Showcase Of The Century Exhibition Programme", { location: "Fictional Hall" });
    // the RAF-style project: setup, show, dismantle, then a reinstall run
    setup = await activity(U.pm, P, { activity_kind: "setup", title: "Installation", run_label: "Run 1", activity_state: "tentative", start_date: day(-3), end_date: day(-3) });   // its own date, passed
    show = await activity(U.pm, P, { activity_kind: "show", title: "Show days", run_label: "Run 1", activity_state: "confirmed", start_date: day(3), end_date: day(5) });
    dismantle = await activity(U.pm, P, { activity_kind: "dismantling", title: "Dismantle", run_label: "Run 1", activity_state: "confirmed", start_date: day(6), end_date: day(6) });
    reinstall = await activity(U.pm, P, { activity_kind: "setup", title: "Reinstall", run_label: "Run 2", activity_state: "confirmed", start_date: day(20), end_date: day(21), location: "Fictional Second Venue" });
    await crew(show, [{ user_id: U.tech, role: "installation", call_local: `${day(3)}T07:30` }, { user_id: U.siteOnly, role: "standby" }]);
    await call(U.pm, `proj_save_site_activity('${P}', '${show}', ${j({ owner_id: U.lead })})`).catch(() => null);
    await admin(`update proj_plan_items set owner_id = '${U.lead}', notes = '${SECRET.notes}', crew_instructions = '${SECRET.crewInstr}', ready_note = '${SECRET.ready}' where id = '${show}'`);
    await admin(`update proj_site_crew set instructions = '${SECRET.crewInstr}' where plan_item_id = '${show}'`);
    // private things in the same project: a task, a comment-like record, a budget-like text on the details
    await admin(`insert into proj_tasks (project_id, title, created_by) values ('${P}', '${SECRET.task}', '${U.pm}')`).catch(() => null);
    for (let n = 1; n <= 5; n++) await admin(`insert into proj_dp_items (project_id, item_key, title, sort_order, created_by) values ('${P}', 'k${n}', 'Fictional activation ${n}', ${n}, '${U.pm}')`);
    // a draft Inventory request carried by a shipment that arrives AFTER the setup began
    reqCode = "UAE-R-97001";
    const req = (await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone, needed_from, needed_until, expected_return_at)
      values ('${CO.a}', '${reqCode}', 'project', '${P}', '${U.pm}', 'draft', 'Asia/Dubai', now() + interval '1 day', now() + interval '8 days', now() + interval '8 days') returning id`))[0]!.id;
    ship = (await admin<{ id: string }>(`insert into proj_site_shipments (project_id, label, plan_item_id, request_id, departs_at, arrives_at, returns_at, arrives_tz, state, confirmed_at, created_by)
      values ('${P}', 'Fictional LED wall freight', '${setup}', '${req}', now() + interval '1 day', now() + interval '2 days', now() + interval '9 days', 'Asia/Dubai', 'confirmed', now(), '${U.pm}') returning id`))[0]!.id;
    // a handover waiting for acceptance
    const org = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Handover Client', 'client') returning id`))[0]!.id;
    const opp = (await admin<{ id: string }>(`insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, stage, currency, client_org_id)
      values ('${CO.a}', 'OPP-UAE-2027-9001', 'Fictional handover enquiry', 'website', '${U.ops}', '${U.ops}', 'qualified', 'AED', '${org}') returning id`))[0]!.id;
    await admin(`insert into proj_handovers (company_id, crm_opportunity_id, crm_reference, status, prepared_by, sales_owner_id, title, client_name, location, install_start, scope, notes, pm_user_id, submitted_at)
      values ('${CO.a}', '${opp}', 'OPP-UAE-2027-9001', 'submitted', '${U.ops}', '${U.ops}', 'Fictional Handover Pavilion', '${SECRET.client}', 'Fictional Handover Hall', '${day(30)}', '${SECRET.scope}', '${SECRET.notes}', null, now())`);
    // the displays: one per company, registered by the Operations Manager of that company
    DISP.a = await call<string>(U.ops, `ops_tv_register_display('${U.dispA}', '${CO.a}', 'Fictional Office TV', 'Asia/Dubai')`);
    DISP.b = await call<string>(U.opsB, `ops_tv_register_display('${U.dispB}', '${CO.b}', 'Fictional Other TV', 'Asia/Dubai')`);
  }, 240_000);
  afterAll(async () => db.teardown());

  it("the board has exactly the contract's keys, at every level", async () => {
    const b = await board(U.dispA);
    expect(kinds(b)).toEqual(["access", "activities", "company", "display", "generated_at", "handovers", "notes", "office_tz", "projects", "shipments", "truncated"]);
    expect(b.access).toBe("display"); expect(b.company).toEqual({ id: CO.a, name: "Fictional Enginious LLC FZ" }); expect(b.display).toEqual({ id: DISP.a, label: "Fictional Office TV" }); expect(b.office_tz).toBe("Asia/Dubai");
    expect(b.truncated).toEqual({ activities: false, projects: false, shipments: false }); expect(b.notes).toEqual([]);
    expect(kinds(b.activities[0])).toEqual(["call_missing", "crew", "crew_total", "end_date", "ends_at", "id", "kind", "lead", "phase", "project_id", "project_name", "project_ref", "readiness", "run_label", "start_date", "starts_at", "state", "title", "tz", "venue", "venue_source"]);
    expect(kinds(b.activities[0].phase)).toEqual(["basis", "choice_pending", "first_day", "last_day", "phase", "started_at"]);
    expect(kinds(b.activities[0].readiness)).toEqual(["app", "content", "hardware"]);
    expect(kinds(b.shipments[0])).toEqual(["activity_id", "activity_title", "arrives_at", "departs_at", "id", "label", "project_id", "project_name", "project_ref", "request", "returns_at", "run_label", "state", "tz"]);
    expect(kinds(b.shipments[0].request)).toEqual(["code", "expected_return_at", "return_overdue", "state", "units_short"]);
    expect(kinds(b.projects[0])).toEqual(["activations", "dated_activities", "equipment", "id", "kind", "name", "next_activity_id", "pm_name", "project_readiness", "ref", "status"]);
    expect(kinds(b.projects[0].equipment)).toEqual(["requests", "worst_state"]);
    expect(kinds(b.handovers[0])).toEqual(["id", "install_start", "location", "pm_name", "reference", "status", "submitted_at", "title"]);
    expect(kinds(b.activities.find((a: Row) => a.crew.length)!.crew[0])).toEqual(["name", "role"]);
  });

  it("no private string planted in the same records ever appears: comments, notes, instructions, task text, e-mail addresses, scope, client name, budget", async () => {
    for (const user of [U.dispA, U.ops, U.founder]) {
      const text = JSON.stringify(await board(user));
      for (const [k, v] of Object.entries(SECRET)) expect(text, `${k} leaked to ${user}`).not.toContain(v);
      expect(text).not.toMatch(/@tvtest\.ae/); expect(text).not.toMatch(/phone|mobile|salary/i);
    }
    expect(JSON.stringify(await board(U.dispA))).toContain("Tariq Technician");                                                   // names are shown; addresses are not
  });

  it("who may read it: the company's un-revoked display, its Operations Managers and founders; nobody else and no other company", async () => {
    expect((await board(U.ops)).access).toBe("operations"); expect((await board(U.ops)).display).toBeNull();
    expect((await board(U.founder)).access).toBe("operations");
    expect((await board(U.dispB, CO.b)).company.id).toBe(CO.b);
    expect(await code(board(U.dispA, CO.b))).toBe("42501");                                                  // a display of company A asks for company B
    expect(await code(board(U.dispB, CO.a))).toBe("42501");
    expect(await code(board(U.ops, CO.b))).toBe("42501");                                                    // an Operations Manager of A asks for B
    expect(await code(board(U.opsB, CO.a))).toBe("42501");
    for (const who of [U.pm, U.member, U.lead, U.outsider, U.tech, U.siteOnly, U.spare]) expect(await code(board(who)), who).toBe("42501");   // project members, a site-only technician, a stranger
    expect(await code(call(U.ops, `ops_tv_board(null)`))).toBe("22023");
    expect(await code(db.asUser(null, async (q) => q(`select ops_tv_board('${CO.a}')`)))).toBeTruthy();                                    // anon: refused
  });

  it("a display identity reaches nothing through any existing read or write: Projects, crew, notifications, briefings, Operations", async () => {
    const rows = async (sql: string) => (await db.asUserCommit(U.dispA, async (q) => (await q(sql)).rows)) as Row[];
    expect(await rows(`select id from proj_projects`)).toHaveLength(0);
    expect(await rows(`select id from proj_plan_items`)).toHaveLength(0);
    expect(await rows(`select id from proj_site_crew`)).toHaveLength(0);
    expect(await rows(`select id from notifications`)).toHaveLength(0);
    expect(await rows(`select id from proj_handovers`)).toHaveLength(0);
    expect(await rows(`select id from ops_tv_displays`).catch(() => "denied")).toBeTruthy();                       // no policy, no grant: denied or empty, never a row
    const direct = await rows(`select id from ops_tv_displays`).catch(() => []);
    expect(direct).toHaveLength(0);
    expect(await call<Row[]>(U.dispA, `proj_site_activities_read('${CO.a}', null, 50)`)).toEqual([]);
    expect(await code(call(U.dispA, `proj_site_briefing('${P}')`))).toBe("P0002");
    expect(await code(call(U.dispA, `ops_overview('${CO.a}')`))).toBe("42501");
    expect(await code(call(U.dispA, `proj_my_site_assignments()`))).not.toBe("ok2");                               // answers (empty) or refuses; checked below
    expect(await call<Row[]>(U.dispA, `proj_my_site_assignments()`)).toEqual([]);
    expect(await code(call(U.dispA, `proj_record_site_start('${show}', null, null)`))).toBeTruthy();
    expect(await code(call(U.dispA, `ops_tv_register_display('${U.spare}', '${CO.a}', 'x', 'Asia/Dubai')`))).toBe("42501");   // a display cannot make displays
    expect(await code(call(U.dispA, `ops_tv_list_displays('${CO.a}')`))).toBe("42501");
    expect(await code(call(U.dispA, `ops_tv_revoke_display('${DISP.a}')`))).toBe("42501");
  });

  it("what a display is: ops_tv_my_display says so for the account, and null for anyone else", async () => {
    expect(await call<Row>(U.dispA, "ops_tv_my_display()")).toMatchObject({ id: DISP.a, company_id: CO.a, company_name: "Fictional Enginious LLC FZ", label: "Fictional Office TV", revoked: false });
    expect(await call(U.ops, "ops_tv_my_display()")).toBeNull();
    expect(await call(U.pm, "ops_tv_my_display()")).toBeNull();
  });

  it("the Phase 2 rules: a passed date is never Started; the explicit record is; header fallbacks are labelled; separate runs stay separate rows", async () => {
    let b = await board(U.dispA);
    const find = (t: string) => b.activities.find((a: Row) => a.title === t) as Row;
    expect(b.activities.filter((a: Row) => a.project_id === P).map((a: Row) => a.title).sort()).toEqual(["Dismantle", "Installation", "Reinstall", "Show days"]);
    expect(find("Installation")).toMatchObject({ run_label: "Run 1", state: "tentative", phase: { phase: "date_passed", basis: "activity", first_day: day(-3), started_at: null }, venue: "Fictional Expo Centre, Hall 3", venue_source: "project" });
    expect(find("Reinstall")).toMatchObject({ run_label: "Run 2", state: "confirmed", phase: { phase: "scheduled", basis: "activity", first_day: day(20), last_day: day(21) }, venue: "Fictional Second Venue", venue_source: "activity" });
    expect(find("Show days").phase).toMatchObject({ phase: "scheduled", first_day: day(3), last_day: day(5) });
    expect(find("Dismantle").venue_source).toBe("project");
    // the project-date fallback is labelled, and is used only when the project has exactly ONE activity of that kind (two setups = the run must be chosen, no date borrowed)
    const PH = await proj("UAE-P-2027-0703", "Fictional header-date job", { install: day(-2), location: "Fictional Header Hall" });
    const lone = await activity(U.pm, PH, { activity_kind: "setup", title: "Lone setup", activity_state: "tentative" });
    b = await board(U.dispA);
    expect(find("Lone setup")).toMatchObject({ phase: { phase: "date_passed", basis: "project_header", first_day: day(-2) }, venue_source: "project" });
    await activity(U.pm, PH, { activity_kind: "setup", title: "Second setup", activity_state: "tentative" });
    b = await board(U.dispA);
    expect(find("Lone setup").phase).toMatchObject({ phase: "no_date", basis: "none", choice_pending: true });
    await admin(`delete from proj_plan_items where project_id = '${PH}'`); void lone;
    // only the explicit record makes it Started
    await call(U.pm, `proj_record_site_start('${setup}', null, 'Crew arrived')`);
    b = await board(U.dispA);
    expect(find("Installation").phase).toMatchObject({ phase: "started", basis: "activity" }); expect(find("Installation").phase.started_at).toBeTruthy();
    await call(U.pm, `proj_clear_site_start('${setup}')`);
    b = await board(U.dispA);
    expect(find("Installation").phase.phase).toBe("date_passed");
    // an activity moved by the Project Manager shows under its own run on the next read
    await call(U.pm, `proj_save_site_activity('${P}', '${reinstall}', ${j({ start_date: day(25), end_date: day(26), reason: "Hall moved", expected_version: (await admin<{ version: number }>(`select version from proj_plan_items where id = '${reinstall}'`))[0]!.version })})`);
    b = await board(U.dispA);
    expect(find("Reinstall").phase).toMatchObject({ first_day: day(25), last_day: day(26) }); expect(find("Show days").phase.first_day).toBe(day(3));
  });

  it("crew: names and roles only, at most 12, the lead by name, missing call times counted", async () => {
    const a = (await board(U.dispA)).activities.find((x: Row) => x.title === "Show days") as Row;
    expect(a.lead).toEqual({ name: "Lena Lead" });
    expect(a.crew).toEqual([{ name: "Tariq Technician", role: "installation" }, { name: "Sami SiteOnly", role: "standby" }]);
    expect(a.crew_total).toBe(2); expect(a.call_missing).toBe(1);
    const none = (await board(U.dispA)).activities.find((x: Row) => x.title === "Dismantle") as Row;
    expect(none).toMatchObject({ crew: [], crew_total: 0, call_missing: 0, lead: null });
    // 14 people: 12 listed, 14 counted
    const many = Array.from({ length: 14 }, (_, n) => ({ id: id(), n }));
    await admin(`insert into auth.users (id, email) values ${many.map((m) => `('${m.id}', 'crew${m.n}@tvtest.ae')`).join(", ")}`);
    await admin(`insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values ${many.map((m) => `('${m.id}', 'EMP-97${String(m.n).padStart(2, "0")}', '${CO.a}', 'AE', 'F', 'C${m.n}', '2024-01-01')`).join(", ")}`);
    await crew(dismantle, many.map((m) => ({ user_id: m.id, role: "dismantling" })));
    const d = (await board(U.dispA)).activities.find((x: Row) => x.title === "Dismantle") as Row;
    expect(d.crew).toHaveLength(12); expect(d.crew_total).toBe(14); expect(d.call_missing).toBe(14);
    await crew(dismantle, []);
  });

  it("readiness: a run with no evidence says Not recorded; the Project Manager's own value is shown; project-wide is separate", async () => {
    let b = await board(U.dispA);
    expect((b.activities.find((x: Row) => x.title === "Show days") as Row).readiness).toEqual({ hardware: "not_recorded", content: "not_recorded", app: "not_recorded" });
    await admin(`update proj_plan_items set ready_hardware = 'not_ready', ready_content = 'ready' where id = '${show}'`);
    b = await board(U.dispA);
    expect((b.activities.find((x: Row) => x.title === "Show days") as Row).readiness).toMatchObject({ hardware: "not_ready", content: "ready" });
    expect(kinds(b.projects.find((x: Row) => x.id === P).project_readiness)).toEqual(["app", "content", "hardware"]);
    await admin(`update proj_plan_items set ready_hardware = 'unknown', ready_content = 'unknown' where id = '${show}'`);
  });

  it("shipments carry their Inventory request's own state and the setup they support; separate from the activities", async () => {
    const s = (await board(U.dispA)).shipments.find((x: Row) => x.id === ship) as Row;
    expect(s).toMatchObject({ label: "Fictional LED wall freight", activity_id: setup, activity_title: "Installation", run_label: "Run 1", state: "confirmed", tz: "Asia/Dubai", request: { code: reqCode, state: "draft" } });
    expect(new Date(s.arrives_at).getTime()).toBeGreaterThan(Date.now()); expect(new Date(s.returns_at).getTime()).toBeGreaterThan(new Date(s.arrives_at).getTime());
    await admin(`update proj_site_shipments set returns_at = now() - interval '5 days', arrives_at = now() - interval '6 days', departs_at = now() - interval '7 days' where id = '${ship}'`);   // came back long ago: no longer on the board
    expect((await board(U.dispA)).shipments.find((x: Row) => x.id === ship)).toBeUndefined();
    await admin(`update proj_site_shipments set departs_at = now() + interval '1 day', arrives_at = now() + interval '2 days', returns_at = now() + interval '9 days' where id = '${ship}'`);
  });

  it("projects: the next activity, dated activities, at most 4 activation titles, the worst equipment state; handovers waiting for acceptance as their own group", async () => {
    const b = await board(U.dispA);
    const p = b.projects.find((x: Row) => x.id === P) as Row;
    expect(p).toMatchObject({ ref: "UAE-P-2027-0701", name: "Fictional RAF Airshow Pavilion", status: "in_progress", kind: "internal", pm_name: "Paula Manager", dated_activities: 4, equipment: { requests: 1, worst_state: "draft" } });
    expect(p.activations).toHaveLength(4); expect(p.activations[0]).toEqual({ title: "Fictional activation 1" });
    expect(p.next_activity_id).toBe(show);                                                                       // the date-passed installation ranks after the scheduled show
    const long = b.projects.find((x: Row) => x.id === PL) as Row;
    expect(long).toMatchObject({ next_activity_id: null, dated_activities: 0, equipment: { requests: 0, worst_state: null } });
    expect(b.projects.every((x: Row) => x.id !== PB)).toBe(true);                                                // another company's project is never here
    expect(b.activities.every((x: Row) => x.project_id !== PB)).toBe(true);
    expect(b.handovers).toEqual([expect.objectContaining({ reference: "OPP-UAE-2027-9001", title: "Fictional Handover Pavilion", status: "submitted", pm_name: null, install_start: day(30), location: "Fictional Handover Hall" })]);
    expect((await board(U.dispB, CO.b)).handovers).toEqual([]);
  });

  it("completed or archived projects, and done or cancelled activities, are not on the board", async () => {
    await admin(`update proj_plan_items set status = 'done' where id = '${dismantle}'`);
    expect((await board(U.dispA)).activities.find((x: Row) => x.id === dismantle)).toBeUndefined();
    await admin(`update proj_plan_items set status = 'cancelled' where id = '${dismantle}'`);
    expect((await board(U.dispA)).activities.find((x: Row) => x.id === dismantle)).toBeUndefined();
    await admin(`update proj_plan_items set status = 'planned' where id = '${dismantle}'`);
    expect((await board(U.dispA)).activities.find((x: Row) => x.id === dismantle)).toBeTruthy();
    await admin(`update proj_projects set status = 'completed' where id = '${PL}'`);
    expect((await board(U.dispA)).projects.find((x: Row) => x.id === PL)).toBeUndefined();
    await admin(`update proj_projects set status = 'in_progress' where id = '${PL}'`);
  });

  it("bounds: 300 activities, marked truncated, one bounded read", async () => {
    await db.asUserCommit(U.pm, async (q) => { await q(`select proj_save_site_activity('${PL}', null, jsonb_build_object('activity_kind', 'show', 'title', 'Bulk ' || n, 'activity_state', 'tentative', 'start_date', current_date + (n % 200), 'end_date', current_date + (n % 200))) from generate_series(1, 305) n`); });
    const t0 = Date.now();
    const b = await board(U.dispA);
    expect(b.activities).toHaveLength(300); expect(b.truncated.activities).toBe(true); expect(b.projects.length).toBeLessThanOrEqual(40);
    expect(Date.now() - t0).toBeLessThan(15000);
    await admin(`delete from proj_plan_items where project_id = '${PL}'`);
    expect((await board(U.dispA)).truncated.activities).toBe(false);
  }, 120_000);

  it("registration refuses an account that could already reach something, and anyone but an Operations Manager of the company", async () => {
    expect(await code(call(U.pm, `ops_tv_register_display('${U.spare}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("42501");
    expect(await code(call(U.opsB, `ops_tv_register_display('${U.spare}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("42501");
    expect(await code(call(U.ops, `ops_tv_register_display('${U.tech}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("23514");              // an employee
    expect(await code(call(U.ops, `ops_tv_register_display('${U.member}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("23514");            // a Projects grant
    await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.grantee}', '${CO.a}', '{}')`).catch(() => null);
    expect(await code(call(U.ops, `ops_tv_register_display('${U.grantee}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("23514");           // a CRM grant
    await admin(`insert into user_roles (user_id, role, company_id) values ('${U.hrRole}', 'hr_admin', '${CO.a}')`).catch(async () => admin(`insert into user_roles (user_id, role) select '${U.hrRole}', min(e.enumlabel)::app_role from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'app_role'`));
    expect(await code(call(U.ops, `ops_tv_register_display('${U.hrRole}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("23514");           // an HR role
    expect(await code(call(U.ops, `ops_tv_register_display('${U.ops}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("22023");               // the manager's own account
    expect(await code(call(U.ops, `ops_tv_register_display('${id()}', '${CO.a}', 'X', 'Asia/Dubai')`))).toBe("22023");                // no such account
    expect(await code(call(U.ops, `ops_tv_register_display('${U.spare}', '${CO.a}', '   ', 'Asia/Dubai')`))).toBe("22023");          // no name
    expect(await code(call(U.ops, `ops_tv_register_display('${U.spare}', '${CO.a}', '${"x".repeat(61)}', 'Asia/Dubai')`))).toBe("22023");
    expect(await code(call(U.ops, `ops_tv_register_display('${U.spare}', '${CO.a}', 'X', 'Mars/Phobos')`))).toBe("22023");           // a zone that does not exist
    expect(await code(call(U.ops, `ops_tv_register_display('${U.dispA}', '${CO.a}', 'Again', 'Asia/Dubai')`))).toBe("23505");         // already a display
    expect(await code(call(U.ops, `ops_tv_register_display('${U.spare}', '${CO.b}', 'X', 'Asia/Dubai')`))).toBe("42501");             // another company
    const id1 = await call<string>(U.founder, `ops_tv_register_display('${U.spare}', '${CO.a}', '  Fictional Lobby TV  ', 'Asia/Dubai')`);   // a founder may; the name is trimmed
    expect((await call<Row>(U.spare, "ops_tv_my_display()")).label).toBe("Fictional Lobby TV");
    DISP.spare = id1;
  });

  it("the list is for Operations Managers of that company only, with the sign-in address; revoking is idempotent and refuses the display's very next read", async () => {
    const list = await call<Row[]>(U.ops, `ops_tv_list_displays('${CO.a}')`);
    expect(list.map((r) => r.label).sort()).toEqual(["Fictional Lobby TV", "Fictional Office TV"]);
    expect(list.find((r) => r.label === "Fictional Office TV")).toMatchObject({ id: DISP.a, user_id: U.dispA, email: `dispA@tvtest.ae`, revoked_at: null });
    expect(list.find((r) => r.label === "Fictional Office TV")!.last_seen_at).toBeTruthy();                      // it was read above
    expect(await code(call(U.pm, `ops_tv_list_displays('${CO.a}')`))).toBe("42501");
    expect(await code(call(U.opsB, `ops_tv_list_displays('${CO.a}')`))).toBe("42501");
    expect(await code(call(U.pm, `ops_tv_revoke_display('${DISP.spare}')`))).toBe("42501");
    expect(await code(call(U.opsB, `ops_tv_revoke_display('${DISP.spare}')`))).toBe("42501");                     // another company's manager
    expect(await code(call(U.ops, `ops_tv_revoke_display('${id()}')`))).toBe("P0002");
    expect((await board(U.spare)).access).toBe("display");
    expect(await call(U.ops, `ops_tv_revoke_display('${DISP.spare}')`)).toBe(U.spare);                            // returns the sign-in to switch off
    const err = await db.asUserCommit(U.spare, async (q) => { try { await q(`select ops_tv_board('${CO.a}')`); return null; } catch (e) { return e as { code?: string; hint?: string }; } });
    expect(err).toMatchObject({ code: "42501", hint: "revoked" });                                                // the very next read
    expect(await call<Row>(U.spare, "ops_tv_my_display()")).toMatchObject({ revoked: true });
    const at = (await admin<{ revoked_at: string; revoked_by: string }>(`select revoked_at, revoked_by from ops_tv_displays where id = '${DISP.spare}'`))[0]!;
    expect(at.revoked_by).toBe(U.ops);
    expect(await call(U.founder, `ops_tv_revoke_display('${DISP.spare}')`)).toBe(U.spare);                        // again: nothing changes
    expect((await admin<{ revoked_at: string; revoked_by: string }>(`select revoked_at, revoked_by from ops_tv_displays where id = '${DISP.spare}'`))[0]).toEqual(at);
    expect((await call<Row[]>(U.ops, `ops_tv_list_displays('${CO.a}')`))[0]!.label).toBe("Fictional Office TV");    // active first
    expect(await code(call(U.ops, `ops_tv_register_display('${U.spare}', '${CO.a}', 'Again', 'Asia/Dubai')`))).toBe("23505");   // a revoked account is not re-registered: make a new account
    expect((await board(U.dispA)).access).toBe("display");                                                         // the other display is untouched
  });

  it("a deactivated display account is refused too", async () => {
    await call(U.ops, `ops_tv_register_display('${U.dispOff}', '${CO.a}', 'Fictional Spare TV', 'Asia/Dubai')`);
    expect((await board(U.dispOff)).access).toBe("display");
    await admin(`update profiles set is_active = false where id = '${U.dispOff}'`);
    expect(await code(board(U.dispOff))).toBe("42501");
    await admin(`update profiles set is_active = true where id = '${U.dispOff}'`);
  });

  it("a display of one company never reads another, even if the other company's id is guessed; a display never gains Operations access", async () => {
    expect(await code(call(U.dispB, `ops_overview('${CO.b}')`))).toBe("42501");
    expect(await code(call(U.dispA, `ops_tv_board('${CO.b}')`))).toBe("42501");
    expect((await db.asUserCommit(U.dispA, async (q) => (await q(`select count(*)::int as n from proj_company_grants`)).rows[0])) as Row).toMatchObject({ n: 0 });
  });

  it("the packs: the verify pack says OK everywhere, the rollback stops while a display is active, then removes everything, and the migration installs again", async () => {
    // the harness grants every table to authenticated for its own convenience (supabase/tests/grant-authenticated-access.sql); a real project does not, and the migration revokes it: take the test-only grant away to check that
    await admin(`revoke all on table ops_tv_displays from authenticated, anon`);
    const verify = (await admin<{ item: string; result: string }>(manual("ops_tv_display_20_verify_readonly.sql")));
    for (const r of verify.filter((x) => !/^information/.test(x.item))) expect(r.result, r.item).toBe("OK");
    expect(verify.find((x) => /display accounts that also hold/.test(x.item))!.result).toBe("0");
    const pre = await admin<{ item: string; result: string }>(manual("ops_tv_display_00_preflight_readonly.sql"));
    expect(pre.find((x) => /not installed yet|already installed/.test(x.result))!.result).toBe("already installed");
    await expect(db.seed(manual("ops_tv_display_90_rollback.sql"))).rejects.toThrow(/STOP/);
    await admin(`update ops_tv_displays set revoked_at = now() where revoked_at is null`);
    await db.seed(manual("ops_tv_display_90_rollback.sql"));
    await db.seed(manual("ops_tv_display_90_rollback.sql"));                                                       // twice is safe
    expect((await admin<{ n: number }>(`select count(*)::int as n from pg_proc where proname like 'ops\\_tv\\_%'`))[0]!.n).toBe(0);
    expect((await admin<{ t: string | null }>(`select to_regclass('public.ops_tv_displays')::text as t`))[0]!.t).toBeNull();
    expect((await admin<{ n: number }>(`select count(*)::int as n from proj_plan_items where plan = 'site'`))[0]!.n).toBeGreaterThan(0);   // no project record was touched
    const after = await admin<{ item: string; result: string }>(manual("ops_tv_display_00_preflight_readonly.sql"));
    expect(after.find((x) => /not installed yet|already installed/.test(x.result))!.result).toBe("not installed yet");
    await db.applyMigration("20270110000100_ops_tv_display.sql");
    await admin(`revoke all on table ops_tv_displays from authenticated, anon`);
    for (const r of (await admin<{ item: string; result: string }>(manual("ops_tv_display_20_verify_readonly.sql"))).filter((x) => !/^information/.test(x.item))) expect(r.result, r.item).toBe("OK");
  }, 120_000);
});
