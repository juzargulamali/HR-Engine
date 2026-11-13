import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects Release 1: the Project Plan (migration 20270104000100_proj_project_plan_r1.sql), against a real Postgres. Fictional data throughout.
//   * a plan made before this release (legacy sections, no new fields) still loads and releases exactly as before;
//   * the accepted handover's technologies are brought in ONCE, and the Project Manager's edits survive reopening or a retry;
//   * Kids Photobooth: hardware (stock-matched, one item missing from Inventory), creative tasks, one app on six devices, integration and site work, a storyboard dependency
//     and a "Ready for mockup" milestone; release twice (and at the same time) makes one task / one equipment line per line; unmatched hardware stays visible and is
//     added once when matched; the assignee updates the task and the plan shows it; an approved owner/date change reaches the task, or is flagged as pending;
//   * Simple supply-and-install: hardware + installation only;
//   * another company's project is not readable or callable.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), design: id(), dev: id(), eng: id(), site: id(), outsider: id(), other: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@plan-r1.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const DENIED = /Only |not found|permission denied/i;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

describe("Project Plan, Release 1", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const count = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0]!.n);
  const plan = (user: string, project: string) => call<Row>(user, `proj_dp_plan('${project}')`);
  const saveItem = (user: string, project: string, fields: Row, itemId: string | null = null) => call<Row>(user, `proj_dp_save_item('${project}', ${itemId ? `'${itemId}'` : "null"}, ${j(fields)})`);
  const saveLine = (user: string, itemId: string, fields: Row, lineId: string | null = null) => call<Row>(user, `proj_dp_save_line('${itemId}', ${lineId ? `'${lineId}'` : "null"}, ${j(fields)})`);
  const release = (user: string, project: string) => call<Row>(user, `proj_dp_release('${project}')`);
  const lineOf = (p: Row, lineId: string): Row => p.items.flatMap((i: Row) => i.lines).find((l: Row) => l.id === lineId);

  let SIMPLE = "", KIDS = "", LEGACY = "", OTHER = "", LED = "", TABLET = "", MS = "";
  const K = {} as { booth: string; printer: string; led: string; manual: string; rent: string; client: string; moodboard: string; storyboard: string; draft: string; app: string; integ: string; install: string; final: string };

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.a}', '{}'), ('${U.design}', '${CO.a}', '{}'), ('${U.dev}', '${CO.a}', '{}'), ('${U.eng}', '${CO.a}', '{}'), ('${U.site}', '${CO.a}', '{}'),
        ('${U.outsider}', '${CO.b}', '{}'), ('${U.other}', '${CO.b}', '{}');
      insert into inv_items (company_id, name, tracking, status) values ('${CO.a}', 'LED screen 55 in', 'quantity', 'active'), ('${CO.a}', 'Tablet 11 in', 'quantity', 'active');
    `);
    LED = (await admin<{ id: string }>(`select id from inv_items where name = 'LED screen 55 in'`))[0]!.id;
    TABLET = (await admin<{ id: string }>(`select id from inv_items where name = 'Tablet 11 in'`))[0]!.id;
    const proj = async (co: string, ref: string, name: string, pm: string) => (await admin<{ id: string }>(
      `insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${co}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    KIDS = await proj(CO.a, "UAE-P-2027-0101", "Fictional Kids Photobooth", U.pm);
    SIMPLE = await proj(CO.a, "UAE-P-2027-0102", "Fictional supply and install", U.pm);
    LEGACY = await proj(CO.a, "UAE-P-2027-0103", "Fictional pre-change project", U.pm);
    OTHER = await proj(CO.b, "OTH-P-2027-0001", "Fictional other company job", U.outsider);
    await db.seed(`
      insert into proj_project_details (project_id, location, site_timezone, scope, technologies, install_start, event_start, event_end) values
        ('${KIDS}', 'Fictional Mall', 'Asia/Dubai', 'Kids photobooth with a cartoon app, printed on the spot.', '[{"name":"Photobooth","qty":2},{"name":"Cartoon app","qty":1}]'::jsonb, '2027-05-01', '2027-05-03', '2027-05-04'),
        ('${SIMPLE}', 'Fictional Office', 'Asia/Dubai', 'Supply and install three displays.', '[]'::jsonb, null, null, null),
        ('${LEGACY}', 'Fictional Hall', 'Asia/Dubai', null, '[]'::jsonb, null, null, null),
        ('${OTHER}', 'Elsewhere', 'Asia/Dubai', null, '[]'::jsonb, null, null, null);
      insert into proj_project_members (project_id, user_id, role) values
        ('${KIDS}', '${U.pm}', 'pm'), ('${KIDS}', '${U.design}', 'member'), ('${KIDS}', '${U.dev}', 'member'), ('${KIDS}', '${U.eng}', 'member'), ('${KIDS}', '${U.site}', 'member'),
        ('${SIMPLE}', '${U.pm}', 'pm'), ('${SIMPLE}', '${U.site}', 'member'),
        ('${LEGACY}', '${U.pm}', 'pm'), ('${LEGACY}', '${U.dev}', 'member'), ('${LEGACY}', '${U.site}', 'member'),
        ('${OTHER}', '${U.outsider}', 'pm');
    `);
    MS = (await admin<{ id: string }>(`insert into proj_milestones (project_id, title, due_date, created_by) values ('${KIDS}', 'Ready for mockup', '2027-04-20', '${U.pm}') returning id`))[0]!.id;
  });
  afterAll(async () => db.teardown());

  it("a plan made before this release (legacy sections, none of the new fields) loads and releases exactly as before", async () => {
    const it0 = (await saveItem(U.pm, LEGACY, { zone: "Hall", title: "Old style wall", owner_id: U.dev, needed_by: "2027-06-01" })).id;
    await call(U.pm, `proj_dp_delegate('${LEGACY}', 'programming', '${U.dev}')`);
    const prog = (await saveLine(U.dev, it0, { section: "programming", description: "Touch app" })).id;
    await saveLine(U.pm, it0, { section: "installation", description: "Rig it", assignee_id: U.site });
    await saveLine(U.pm, it0, { section: "testing", description: "Soak test", assignee_id: U.site });
    // the old delegation still lets this person edit the matching new section, and nothing else
    const apps = await saveLine(U.dev, it0, { section: "apps", description: "Kiosk app" });
    expect(apps.created).toBe(true);
    await expect(saveLine(U.dev, it0, { section: "site", description: "Not theirs" })).rejects.toThrow(/delegated/);
    const p0 = await plan(U.site, LEGACY);
    expect(p0.items[0].qty).toBeNull();
    expect(lineOf(p0, prog)).toMatchObject({ section: "programming", start_date: null, supply_route: null, detail: {}, milestone_id: null, task_pending: null, plan_depends_on: [] });
    expect(p0.scope.pending).toEqual([]);
    expect(await release(U.pm, LEGACY)).toMatchObject({ tasks: 4, equipment: 0, external: 0, dependencies: 0, skipped: [] });
    expect(await release(U.pm, LEGACY)).toMatchObject({ tasks: 0, already: 4 });
  });

  it("brings the accepted technologies in once, keeps the Project Manager's edits, and never duplicates on reopen or retry", async () => {
    const before = await plan(U.pm, KIDS);
    expect(before.scope.pending.map((t: Row) => t.name)).toEqual(["Photobooth", "Cartoon app"]);
    expect(before.scope.brief).toMatch(/cartoon app/);
    expect(before.site_dates).toMatchObject({ install_start: "2027-05-01", event_start: "2027-05-03" });
    await expect(call(U.design, `proj_dp_seed_scope('${KIDS}')`)).rejects.toThrow(/Only the Project Manager/);
    await expect(call(U.outsider, `proj_dp_seed_scope('${KIDS}')`)).rejects.toThrow(DENIED);
    expect(await call<Row>(U.pm, `proj_dp_seed_scope('${KIDS}')`)).toEqual({ added: 2, existing: 0 });
    const p = await plan(U.pm, KIDS);
    expect(p.items.map((i: Row) => [i.key, i.zone, i.title, i.qty])).toEqual([["D001", "", "Photobooth", 2], ["D002", "", "Cartoon app", 1]]);
    expect(p.scope.pending).toEqual([]);
    // the PM edits one and removes none; a retry changes nothing
    await saveItem(U.pm, KIDS, { owner_id: U.design, qty: 3, needed_by: "2027-04-25" }, p.items[0].id);
    expect(await call<Row>(U.pm, `proj_dp_seed_scope('${KIDS}')`)).toEqual({ added: 0, existing: 2 });
    expect(await call<Row>(U.pm, `proj_dp_seed_scope('${KIDS}')`)).toEqual({ added: 0, existing: 2 });
    const again = await plan(U.pm, KIDS);
    expect(again.items.map((i: Row) => [i.title, i.qty, i.owner_name])).toEqual([["Photobooth", 3, "design"], ["Cartoon app", 1, null]]);
    // removed rows (never released) stay removed: they are not brought back
    await call(U.pm, `proj_dp_remove_item('${p.items[1].id}')`);
    expect(await call<Row>(U.pm, `proj_dp_seed_scope('${KIDS}')`)).toEqual({ added: 0, existing: 2 });
    expect((await plan(U.pm, KIDS)).items).toHaveLength(1);
    // a technology added to the handover later is the only thing offered
    await admin(`update proj_project_details set technologies = technologies || '[{"name":"Photo printer","qty":2}]'::jsonb where project_id = '${KIDS}'`);
    expect((await plan(U.pm, KIDS)).scope.pending.map((t: Row) => t.name)).toEqual(["Photo printer"]);
    expect(await call<Row>(U.pm, `proj_dp_seed_scope('${KIDS}')`)).toEqual({ added: 1, existing: 2 });
    K.booth = p.items[0].id;
    K.printer = (await plan(U.pm, KIDS)).items.find((i: Row) => i.title === "Photo printer").id;
    // a no-zone plan works like any other
    expect((await plan(U.pm, KIDS)).items.every((i: Row) => i.zone === "")).toBe(true);
  });

  it("requirements are captured once, with section details checked: hardware route, content type and count, one app on six devices, engineering and site work", async () => {
    await call(U.pm, `proj_dp_delegate('${KIDS}', 'content', '${U.design}')`);
    await call(U.pm, `proj_dp_delegate('${KIDS}', 'apps', '${U.dev}')`);
    await call(U.pm, `proj_dp_delegate('${KIDS}', 'engineering', '${U.eng}')`);
    await call(U.pm, `proj_dp_delegate('${KIDS}', 'site', '${U.site}')`);
    await call(U.pm, `proj_dp_delegate('${KIDS}', 'hardware', '${U.eng}')`);
    // hardware: one stock-matched, one missing from Inventory, one rented, one supplied by the client
    K.led = (await saveLine(U.eng, K.booth, { section: "hardware", description: "Booth screen", qty: 2, inv_item_id: LED, notes: "55 in, portrait", needed_by: "2027-04-28" })).id;
    K.manual = (await saveLine(U.eng, K.booth, { section: "hardware", description: "Ring light", qty: 2, notes: "", needed_by: "2027-04-28" })).id;
    K.rent = (await saveLine(U.eng, K.booth, { section: "hardware", description: "Backdrop frame", qty: 1, supply_route: "rent", assignee_id: U.eng, detail: { source: "Fictional Hire Ltd", expected_date: "2027-04-27" } })).id;
    K.client = (await saveLine(U.eng, K.booth, { section: "hardware", description: "Printer paper", supply_route: "client" })).id;
    let p = await plan(U.pm, KIDS);
    expect(lineOf(p, K.led).supply_route).toBe("inventory");
    expect(lineOf(p, K.manual)).toMatchObject({ supply_route: "inventory", inv_item_id: null });
    expect(lineOf(p, K.rent)).toMatchObject({ supply_route: "rent", detail: { source: "Fictional Hire Ltd", expected_date: "2027-04-27" }, assignee_name: "eng" });
    await expect(saveLine(U.eng, K.booth, { section: "hardware", description: "Bad route", supply_route: "lend" })).rejects.toThrow(/Inventory, Buy, Rent or Client/);
    await expect(saveLine(U.eng, K.booth, { section: "hardware", description: "Bad pair", supply_route: "buy", inv_item_id: LED })).rejects.toThrow(/supplied from Inventory/);
    await expect(saveLine(U.eng, K.booth, { section: "hardware", description: "Bad detail", detail: { count: 3 } })).rejects.toThrow(/Unknown detail/);
    await expect(saveLine(U.design, K.booth, { section: "content", description: "Wrong route", supply_route: "buy" })).rejects.toThrow(/Only a Hardware line has a supply route/);
    // content
    K.moodboard = (await saveLine(U.design, K.booth, { section: "content", description: "Moodboard", assignee_id: U.design, start_date: "2027-04-01", needed_by: "2027-04-03", milestone_id: MS })).id;
    K.storyboard = (await saveLine(U.design, K.booth, { section: "content", description: "Storyboard", assignee_id: U.design, start_date: "2027-04-04", needed_by: "2027-04-08", milestone_id: MS, depends_on: [K.moodboard],
      detail: { deliverable_type: "Storyboard", count: 1, format: "PDF" } })).id;
    K.draft = (await saveLine(U.design, K.booth, { section: "content", description: "First draft", assignee_id: U.design, start_date: "2027-04-09", needed_by: "2027-04-15", milestone_id: MS, depends_on: [K.storyboard],
      detail: { deliverable_type: "Animation", count: 4, format: "MP4", resolution: "1080x1920", orientation: "portrait" } })).id;
    p = await plan(U.pm, KIDS);
    expect(lineOf(p, K.draft)).toMatchObject({ detail: { deliverable_type: "Animation", count: 4, resolution: "1080x1920", orientation: "portrait" }, milestone_id: MS });
    expect(lineOf(p, K.draft).plan_depends_on).toEqual([expect.objectContaining({ line_key: lineOf(p, K.storyboard).key, title: "Storyboard", task_id: null })]);
    await expect(saveLine(U.design, K.booth, { section: "content", description: "Too many", detail: { count: 0 } })).rejects.toThrow(/whole number/);
    await expect(saveLine(U.design, K.booth, { section: "content", description: "Bad dates", start_date: "2027-04-10", needed_by: "2027-04-01" })).rejects.toThrow(/before the start date/);
    await expect(saveLine(U.design, K.booth, { section: "content", description: "Bad milestone", milestone_id: id() })).rejects.toThrow(/Unknown milestone/);
    // a loop between lines is refused; a line cannot wait for itself or for another project's line
    await expect(saveLine(U.design, K.booth, { depends_on: [K.draft] }, K.moodboard)).rejects.toThrow(/loop/);
    await expect(saveLine(U.design, K.booth, { depends_on: [K.moodboard] }, K.moodboard)).rejects.toThrow(/cannot wait for itself/);
    // apps: one app on six devices = one app + six devices
    K.app = (await saveLine(U.dev, K.booth, { section: "apps", description: "Cartoon photo app", assignee_id: U.dev, needed_by: "2027-04-22", detail: { purpose: "Take and cartoonise a photo", app_count: 1, platform: "Android tablet", device_count: 6 } })).id;
    expect(lineOf(await plan(U.pm, KIDS), K.app).detail).toEqual({ purpose: "Take and cartoonise a photo", app_count: 1, platform: "Android tablet", device_count: 6 });
    // engineering and site work
    K.integ = (await saveLine(U.eng, K.booth, { section: "engineering", description: "Printer integration and test", assignee_id: U.eng, needed_by: "2027-04-26", detail: { kind: "Integration / test" } })).id;
    K.install = (await saveLine(U.site, K.booth, { section: "site", description: "Installation", assignee_id: U.site, start_date: "2027-05-01", needed_by: "2027-05-02", detail: { kind: "Installation" } })).id;
    // each person edits only their own section
    await expect(saveLine(U.design, K.booth, { section: "apps", description: "Not theirs" })).rejects.toThrow(/delegated/);
    await expect(saveLine(U.site, K.booth, { section: "engineering", description: "Not theirs" })).rejects.toThrow(/delegated/);
  });

  it("an editable sequence adds a chain of lines with their own owners and dates, and repeating it adds nothing", async () => {
    const steps = [
      { description: "Final export", assignee_id: U.design, start_date: "2027-04-16", needed_by: "2027-04-17", milestone_id: MS },
      { description: "On-device test", assignee_id: U.dev, start_date: "2027-04-18", needed_by: "2027-04-19", milestone_id: MS },
    ];
    await expect(call(U.dev, `proj_dp_add_sequence('${K.booth}', 'content', ${j(steps)})`)).rejects.toThrow(/delegated/);
    const first = await call<Row>(U.design, `proj_dp_add_sequence('${K.booth}', 'content', ${j(steps)})`);
    expect(first.created).toBe(2);
    expect(await call<Row>(U.design, `proj_dp_add_sequence('${K.booth}', 'content', ${j(steps)})`)).toMatchObject({ created: 0 });
    const p = await plan(U.pm, KIDS);
    const [exp, test] = first.lines;
    expect(lineOf(p, test).plan_depends_on.map((d: Row) => d.line_id)).toEqual([exp]);
    expect(lineOf(p, exp).start_date).toBe("2027-04-16");
    // chain it onto the draft by hand: First draft -> Final export
    await saveLine(U.design, K.booth, { depends_on: [K.draft] }, exp);
    K.final = exp;
    await expect(call(U.design, `proj_dp_add_sequence('${K.booth}', 'content', '[]')`)).rejects.toThrow(/at least one step/);
    await expect(call(U.design, `proj_dp_add_sequence('${K.booth}', 'content', ${j(Array.from({ length: 13 }, (_, n) => ({ description: `s${n}` })))})`)).rejects.toThrow(/at most 12/);
  });

  it("release twice (and at the same time) gives one task per work line and one draft equipment line per matched hardware line; the rest stays visible", async () => {
    const [a, b] = await Promise.all([release(U.pm, KIDS), release(U.pm, KIDS)]);
    const r1 = a.tasks + a.equipment > 0 ? a : b;
    const r2 = a.tasks + a.equipment > 0 ? b : a;
    expect(r1).toMatchObject({ tasks: 8, equipment: 1, external: 2 });
    expect(r1.skipped).toEqual([{ line: expect.any(String), reason: "Choose the stock item for this hardware line first" }]);
    expect(r2).toMatchObject({ tasks: 0, equipment: 0 });
    expect(await release(U.pm, KIDS)).toMatchObject({ tasks: 0, equipment: 0 });
    expect(await count(`select 1 from proj_tasks where project_id = '${KIDS}'`)).toBe(8);
    expect(await count(`select 1 from inv_request_lines l join inv_requests r on r.id = l.request_id where r.project_id = '${KIDS}'`)).toBe(1);
    expect(await count(`select 1 from proj_dp_lines where project_id = '${KIDS}' and task_id is not null group by task_id having count(*) > 1`)).toBe(0);
    const p = await plan(U.pm, KIDS);
    expect(lineOf(p, K.led).equipment).toMatchObject({ request_status: "draft", qty: 2 });
    expect(await count(`select 1 from inv_requests where project_id = '${KIDS}' and status = 'draft' and submitted_at is null`)).toBe(1);
    expect(lineOf(p, K.manual)).toMatchObject({ released_at: null, inv_item_id: null, equipment: null });          // still visible, still editable
    expect(lineOf(p, K.rent).released_at).toBeNull();                                                              // outside supply is followed, not requested
    expect(lineOf(p, K.client).released_at).toBeNull();
    // the task carries owner, planned start, due date, milestone and a way back to the activation
    expect(lineOf(p, K.storyboard).task).toMatchObject({ assignee_name: "design", start_date: "2027-04-04", due_date: "2027-04-08", milestone_id: MS, status: "todo" });
    const t = (await admin<Row>(`select description from proj_tasks where id = '${lineOf(p, K.storyboard).task.id}'`))[0]!;
    expect(t.description).toMatch(/Project Plan D001 \/ L\d{4} \(Content\)/);
    expect(lineOf(p, K.integ).task.assignee_name).toBe("eng");
    expect(lineOf(p, K.app).task.due_date).toBe("2027-04-22");
  });

  it("dependencies between released lines are ordinary task dependencies, and the milestone lists what is outstanding", async () => {
    const p = await plan(U.pm, KIDS);
    const story = lineOf(p, K.storyboard), draft = lineOf(p, K.draft);
    expect(draft.task.depends_on).toEqual([expect.objectContaining({ task_id: story.task.id, title: "Photobooth: Storyboard", line_key: story.key })]);
    expect(await count(`select 1 from proj_task_dependencies where task_id = '${draft.task.id}' and depends_on_task_id = '${story.task.id}'`)).toBe(1);
    const m = p.milestones.find((x: Row) => x.id === MS);
    expect(m.tasks.map((t: Row) => t.title).sort()).toEqual(["Photobooth: Final export", "Photobooth: First draft", "Photobooth: Moodboard", "Photobooth: On-device test", "Photobooth: Storyboard"]);
    expect(m.planned).toEqual([]);
    expect(m.status).toBe("planned");                                                                               // readiness is not confirmation
    // a dependency added to a released line applies to the task through the existing dependency rules
    await expect(saveLine(U.design, K.booth, { depends_on: [K.final] }, K.moodboard)).rejects.toThrow(/loop/);
    await saveLine(U.dev, K.booth, { depends_on: [K.draft] }, K.app);
    expect(await count(`select 1 from proj_task_dependencies where task_id = '${lineOf(await plan(U.pm, KIDS), K.app).task.id}' and depends_on_task_id = '${draft.task.id}'`)).toBe(1);
  });

  it("an assignee updates a task once, and the plan, the milestone and the task agree; another person cannot", async () => {
    const p0 = await plan(U.pm, KIDS);
    const mood = lineOf(p0, K.moodboard).task.id;
    await expect(call(U.dev, `proj_set_task_status('${mood}', 'in_progress')`)).rejects.toThrow(/Only the assignee/);
    await call(U.design, `proj_set_task_status('${mood}', 'in_progress')`);
    await call(U.design, `proj_set_task_status('${mood}', 'done')`);
    const story = lineOf(p0, K.storyboard).task.id;
    await call(U.design, `proj_set_task_status('${story}', 'in_progress')`);
    const p = await plan(U.site, KIDS);                                                                              // a member with no section reads the same
    expect(lineOf(p, K.moodboard).task.status).toBe("done");
    expect(lineOf(p, K.storyboard).task.status).toBe("in_progress");
    const done = p.milestones.find((x: Row) => x.id === MS).tasks.filter((t: Row) => t.status === "done").length;
    expect(done).toBe(1);
    // a blocker the assignee records is what the plan shows
    await call(U.design, `proj_block_task('${story}', 'Waiting for the client script', null, 'Chase the client for the script')`).catch(async () => {
      await admin(`update proj_tasks set blocked_at = now(), blocked_reason = 'Waiting for the client script', unblock_action = 'Chase the client for the script' where id = '${story}'`);
    });
    const blocked = lineOf(await plan(U.pm, KIDS), K.storyboard).task;
    expect(blocked).toMatchObject({ blocked: true, blocked_reason: "Waiting for the client script", unblock_action: "Chase the client for the script" });
  });

  it("an approved owner or date change reaches the task through the existing task rules; if the task cannot take it, the line says so and a manager reconciles", async () => {
    let p = await plan(U.pm, KIDS);
    const taskOf = (lineId: string) => lineOf(p, lineId).task.id as string;
    // owner + due date of the app line, proposed by its delegate, approved by the PM
    const res = await saveLine(U.dev, K.booth, { assignee_id: U.eng, needed_by: "2027-04-24" }, K.app);
    expect(res.proposed).toBeTruthy();
    expect(lineOf(await plan(U.pm, KIDS), K.app).task).toMatchObject({ assignee_name: "dev", due_date: "2027-04-22" });  // nothing moves before approval
    await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved', 'Dev is on leave')`);
    p = await plan(U.pm, KIDS);
    expect(lineOf(p, K.app).task).toMatchObject({ assignee_name: "eng", due_date: "2027-04-24" });
    expect(lineOf(p, K.app).task_pending).toBeNull();
    expect(await count(`select 1 from proj_task_events where task_id = '${taskOf(K.app)}' and kind = 'reassigned'`)).toBeGreaterThan(0);
    // the integration task is finished; a later date change cannot be applied to it
    const integ = taskOf(K.integ);
    await call(U.eng, `proj_set_task_status('${integ}', 'in_progress')`);
    await call(U.eng, `proj_set_task_status('${integ}', 'done')`);
    const res2 = await saveLine(U.eng, K.booth, { needed_by: "2027-04-30", assignee_id: U.dev }, K.integ);
    await call(U.pm, `proj_dp_decide_change('${res2.proposed}', 'approved')`);
    p = await plan(U.pm, KIDS);
    expect(lineOf(p, K.integ)).toMatchObject({ needed_by: "2027-04-30", assignee_name: "dev" });                         // the plan holds the decision
    expect(lineOf(p, K.integ).task).toMatchObject({ status: "done", assignee_name: "eng", due_date: "2027-04-26" });       // the finished task is untouched
    expect(lineOf(p, K.integ).task_pending.fields).toMatchObject({ assignee_id: U.dev, due_date: "2027-04-30" });
    expect(lineOf(p, K.integ).task_pending.reason).toMatch(/done|cannot|finished/i);
    // only a manager reconciles; retry keeps it pending; keeping the task clears the flag and the plan follows the task
    await expect(call(U.eng, `proj_dp_reconcile_task('${K.integ}', 'retry')`)).rejects.toThrow(/Only the Project Manager/);
    expect(await call<Row>(U.pm, `proj_dp_reconcile_task('${K.integ}', 'retry')`)).toEqual({ status: "pending" });
    expect(await call<Row>(U.pm, `proj_dp_reconcile_task('${K.integ}', 'keep_task')`)).toEqual({ status: "kept_task" });
    p = await plan(U.pm, KIDS);
    expect(lineOf(p, K.integ)).toMatchObject({ task_pending: null, needed_by: "2027-04-26", assignee_name: "eng" });
    expect(await call<Row>(U.pm, `proj_dp_reconcile_task('${K.integ}', 'retry')`)).toEqual({ status: "nothing_pending" });
    // the deliverable's own owner / date change reaches the lines that follow it (the draft line has its own, so is left alone)
    const item = await saveItem(U.pm, KIDS, { needed_by: "2027-04-29" }, K.booth);
    await call(U.pm, `proj_dp_decide_change('${item.proposed}', 'approved')`);
    expect((await plan(U.pm, KIDS)).items.find((i: Row) => i.id === K.booth).needed_by).toBe("2027-04-29");
  });

  it("unmatched hardware: matching it later adds it to the draft request once; a booked line is governed by Equipment", async () => {
    // the manual line stayed out of the request; the PM now finds the item in Inventory and matches it
    expect(await count(`select 1 from inv_request_lines l join inv_requests r on r.id = l.request_id where r.project_id = '${KIDS}'`)).toBe(1);
    await saveLine(U.eng, K.booth, { inv_item_id: TABLET, notes: "Ring light panel, tablet mount" }, K.manual);
    expect(await release(U.pm, KIDS)).toMatchObject({ tasks: 0, equipment: 1, skipped: [] });
    expect(await release(U.pm, KIDS)).toMatchObject({ tasks: 0, equipment: 0 });
    expect(await count(`select 1 from inv_request_lines l join inv_requests r on r.id = l.request_id where r.project_id = '${KIDS}'`)).toBe(2);
    expect(await count(`select 1 from inv_requests where project_id = '${KIDS}'`)).toBe(1);
    // an outside-supply line cannot be switched to Warehouse after release; and a booked line cannot be changed from the plan
    await admin(`update inv_requests set status = 'submitted', submitted_at = now() where project_id = '${KIDS}'`);
    await expect(saveLine(U.eng, K.booth, { qty: 5 }, K.led)).rejects.toThrow(/already with the warehouse/);
    await expect(saveLine(U.eng, K.booth, { supply_route: "buy" }, K.led)).rejects.toThrow(/supplied from Inventory|Equipment tab/);
    // a line matched to stock cannot be sent to another route until the stock item is cleared (unreleased lines only)
    await saveLine(U.eng, K.booth, { supply_route: "buy", inv_item_id: null }, K.rent);
    expect(lineOf(await plan(U.pm, KIDS), K.rent).supply_route).toBe("buy");
  });

  it("Simple supply-and-install: hardware and installation only, no Content, Apps or Engineering details, still releases cleanly", async () => {
    const it0 = (await saveItem(U.pm, SIMPLE, { zone: "Reception", title: "Wall displays", qty: 3, owner_id: U.site, needed_by: "2027-06-10" })).id;
    await saveLine(U.pm, it0, { section: "hardware", description: "Display 55 in", qty: 3, inv_item_id: LED });
    await saveLine(U.pm, it0, { section: "site", description: "Install and test", needed_by: "2027-06-09" });
    const r = await release(U.pm, SIMPLE);
    expect(r).toMatchObject({ tasks: 1, equipment: 1, skipped: [], external: 0, dependencies: 0 });
    const p = await plan(U.site, SIMPLE);
    expect(p.items[0].qty).toBe(3);
    expect(p.items[0].lines.map((l: Row) => l.section).sort()).toEqual(["hardware", "site"]);
    expect(p.milestones).toEqual([]);
    expect(p.items[0].lines.find((l: Row) => l.section === "site").task).toMatchObject({ assignee_name: "site", due_date: "2027-06-09" });
    expect(p.scope.pending).toEqual([]);
  });

  it("another company cannot read or call anything of this project, and the plan columns are read-only through the tables", async () => {
    await expect(plan(U.outsider, KIDS)).rejects.toThrow(/not found/);
    await expect(call(U.outsider, `proj_dp_seed_scope('${KIDS}')`)).rejects.toThrow(DENIED);
    await expect(call(U.outsider, `proj_dp_release('${KIDS}')`)).rejects.toThrow(DENIED);
    await expect(call(U.outsider, `proj_dp_reconcile_task('${K.integ}', 'retry')`)).rejects.toThrow(DENIED);
    await expect(call(U.outsider, `proj_dp_add_sequence('${K.booth}', 'content', ${j([{ description: "x" }])})`)).rejects.toThrow(DENIED);
    await expect(saveLine(U.outsider, K.booth, { section: "content", description: "x" })).rejects.toThrow(DENIED);
    expect(await db.asUser(U.outsider, async (query) => (await query(`select id from proj_dp_lines where project_id = '${KIDS}'`)).rows)).toHaveLength(0);
    await expect(plan(U.outsider, OTHER)).resolves.toMatchObject({ items: [] });
    // internal helpers are not callable by a signed-in user
    await expect(call(U.pm, `proj_dp_sync_task('${K.led}', array['due'])`)).rejects.toThrow(/permission denied/);
    await expect(call(U.pm, `proj_dp_clean_detail('content', '{}')`)).rejects.toThrow(/permission denied/);
    // a finished project's plan is read-only
    await admin(`update proj_projects set status = 'completed' where id = '${SIMPLE}'`);
    await expect(call(U.pm, `proj_dp_seed_scope('${SIMPLE}')`)).rejects.toThrow();
    await expect(release(U.pm, SIMPLE)).rejects.toThrow();
  });

  it("the owner packs: preflight has no STOP, verify says OK on every row, rollback removes what it added and the old behaviour returns", async () => {
    expect((await admin(pack("proj_project_plan_r1_00_preflight_readonly.sql"))).filter((r) => String(r.result).startsWith("STOP"))).toEqual([]);
    const rows = (await admin(pack("proj_project_plan_r1_20_verify_readonly.sql"))).filter((r) => !String(r.item).startsWith("signed-in users can only READ"));
    expect(rows.filter((r) => r.result !== "OK" && r.result !== "INFO")).toEqual([]);
    expect(rows.length).toBeGreaterThan(5);
  });

  describe("synchronisation regressions", () => {
    let REG = "", MS2 = "";
    const L = {} as { story: string; mood: string; draft: string; a: string; b: string; c: string; d: string };
    const taskOf = async (lineId: string) => (await admin<{ task_id: string }>(`select task_id from proj_dp_lines where id = '${lineId}'`))[0]!.task_id;
    const depsOf = async (taskId: string) => (await admin<{ d: string }>(`select depends_on_task_id d from proj_task_dependencies where task_id = '${taskId}'`)).map((r) => r.d).sort();

    beforeAll(async () => {
      REG = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.a}', 'UAE-P-2027-0110', 'Fictional sync regressions', 'internal', 'in_progress', '${U.pm}', '${U.pm}') returning id`))[0]!.id;
      await db.seed(`
        insert into proj_project_details (project_id, location, site_timezone) values ('${REG}', 'Hall', 'Asia/Dubai');
        insert into proj_project_members (project_id, user_id, role) values ('${REG}', '${U.pm}', 'pm'), ('${REG}', '${U.design}', 'member'), ('${REG}', '${U.dev}', 'member'), ('${REG}', '${U.site}', 'member');
      `);
      MS2 = (await admin<{ id: string }>(`insert into proj_milestones (project_id, title, due_date, created_by) values ('${REG}', 'Ready for mockup', '2027-07-20', '${U.pm}') returning id`))[0]!.id;
    });

    it("a prerequisite released AFTER its dependent task is connected by that release, whichever activation is selected, and direct task dependencies are kept", async () => {
      const early = (await saveItem(U.pm, REG, { title: "Early activation", owner_id: U.design })).id;       // released first
      const late = (await saveItem(U.pm, REG, { title: "Late activation", owner_id: U.dev })).id;            // released second
      L.story = (await saveLine(U.pm, late, { section: "content", description: "Storyboard", assignee_id: U.dev })).id;
      L.mood = (await saveLine(U.pm, late, { section: "content", description: "Moodboard", assignee_id: U.dev })).id;
      L.draft = (await saveLine(U.pm, early, { section: "content", description: "First draft", assignee_id: U.design, depends_on: [L.story] })).id;
      // a task nobody planned: a dependency added directly to the task
      const brief = await call<string>(U.pm, `proj_create_task('${REG}', ${j({ title: "Client brief (not in the plan)", assignee_id: U.design })})`);

      // 1. release ONLY the early activation: the dependent task exists, its prerequisite does not yet
      expect(await call<Row>(U.pm, `proj_dp_release('${REG}', array['${early}']::uuid[])`)).toMatchObject({ tasks: 1, dependencies: 0 });
      const draftTask = await taskOf(L.draft);
      await admin(`insert into proj_task_dependencies (task_id, depends_on_task_id, project_id) values ('${draftTask}', '${brief}', '${REG}')`);
      expect(await depsOf(draftTask)).toEqual([brief]);

      // 2. release ONLY the late activation: its tasks are created and the dependent task (in the other activation, not selected) is connected
      const r = await call<Row>(U.pm, `proj_dp_release('${REG}', array['${late}']::uuid[])`);
      expect(r).toMatchObject({ tasks: 2, dependencies: 1, skipped: [] });
      const storyTask = await taskOf(L.story);
      expect(await depsOf(draftTask)).toEqual([brief, storyTask].sort());                                   // the direct dependency survived
      expect((await plan(U.pm, REG)).items.flatMap((i: Row) => i.lines).find((l: Row) => l.id === L.draft).task.depends_on.map((d: Row) => d.task_id).sort()).toEqual([brief, storyTask].sort());
      // repeating connects nothing new
      expect(await call<Row>(U.pm, `proj_dp_release('${REG}')`)).toMatchObject({ tasks: 0, dependencies: 0 });
      expect(await call<Row>(U.pm, `proj_dp_release('${REG}', array['${early}']::uuid[])`)).toMatchObject({ tasks: 0, dependencies: 0 });

      // 3. editing the plan dependency takes off only what the plan line no longer names; the direct ones (even on a plan line's task) stay
      const moodTask = await taskOf(L.mood);
      await admin(`insert into proj_task_dependencies (task_id, depends_on_task_id, project_id) values ('${draftTask}', '${moodTask}', '${REG}')`);
      await saveLine(U.pm, early, { depends_on: [] }, L.draft);
      expect(await depsOf(draftTask)).toEqual([brief, moodTask].sort());
      await saveLine(U.pm, early, { depends_on: [L.story] }, L.draft);
      expect(await depsOf(draftTask)).toEqual([brief, moodTask, storyTask].sort());
    });

    it("an approved change that CLEARS a start date, due date or milestone clears it on the task (the effective value), through the existing task rules", async () => {
      const item = (await saveItem(U.pm, REG, { title: "Clearing activation", owner_id: U.design, needed_by: "2027-08-30" })).id;
      L.a = (await saveLine(U.pm, item, { section: "content", description: "Clear all three", assignee_id: U.design, start_date: "2027-08-01", needed_by: "2027-08-05", milestone_id: MS2 })).id;
      L.b = (await saveLine(U.pm, item, { section: "content", description: "Clear own due date only", assignee_id: U.design, start_date: "2027-08-02", needed_by: "2027-08-06" })).id;
      await call(U.pm, `proj_dp_release('${REG}', array['${item}']::uuid[])`);
      const ta = await taskOf(L.a), tb = await taskOf(L.b);
      expect((await admin<Row>(`select start_date::text s, due_date::text d, milestone_id m from proj_tasks where id = '${ta}'`))[0]).toMatchObject({ s: "2027-08-01", d: "2027-08-05", m: MS2 });

      // clear start, due and milestone of line a: the activation keeps its own date, so the task falls back to it for the due date and to nothing for the rest
      const res = await saveLine(U.pm, item, { start_date: null, needed_by: null, milestone_id: null }, L.a);
      expect(res.proposed).toBeTruthy();
      expect((await admin<Row>(`select start_date::text s, due_date::text d from proj_tasks where id = '${ta}'`))[0]).toMatchObject({ s: "2027-08-01", d: "2027-08-05" });   // nothing before approval
      await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved')`);
      expect((await admin<Row>(`select start_date::text s, due_date::text d, milestone_id m from proj_tasks where id = '${ta}'`))[0]).toEqual({ s: null, d: "2027-08-30", m: null });
      let p = await plan(U.pm, REG);
      expect(p.items.flatMap((i: Row) => i.lines).find((l: Row) => l.id === L.a)).toMatchObject({ start_date: null, needed_by: null, milestone_id: null, task_pending: null });
      expect(p.milestones.find((m: Row) => m.id === MS2).tasks.map((t: Row) => t.task_id)).not.toContain(ta);
      // with no activation date either, the due date clears completely
      await admin(`update proj_dp_items set needed_by = null where id = '${item}'`);
      const res2 = await saveLine(U.pm, item, { needed_by: null }, L.b);
      await call(U.pm, `proj_dp_decide_change('${res2.proposed}', 'approved')`);
      expect((await admin<Row>(`select start_date::text s, due_date::text d from proj_tasks where id = '${tb}'`))[0]).toEqual({ s: "2027-08-02", d: null });
    });

    it("where the task rules refuse the cleared value (finished task) the line shows Task update pending with the cleared value, and a manager can retry or keep the task", async () => {
      const item = (await saveItem(U.pm, REG, { title: "Refusing activation", owner_id: U.design })).id;
      L.c = (await saveLine(U.pm, item, { section: "content", description: "Finished then cleared", assignee_id: U.design, start_date: "2027-09-01", needed_by: "2027-09-04", milestone_id: MS2 })).id;
      await call(U.pm, `proj_dp_release('${REG}', array['${item}']::uuid[])`);
      const tc = await taskOf(L.c);
      await call(U.design, `proj_set_task_status('${tc}', 'in_progress')`);
      await call(U.design, `proj_set_task_status('${tc}', 'done')`);
      const res = await saveLine(U.pm, item, { start_date: null, needed_by: null, milestone_id: null }, L.c);
      await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved')`);
      const line = (await plan(U.pm, REG)).items.flatMap((i: Row) => i.lines).find((l: Row) => l.id === L.c);
      expect(line).toMatchObject({ start_date: null, needed_by: null, milestone_id: null });                       // the plan holds the decision
      expect(line.task).toMatchObject({ status: "done", start_date: "2027-09-01", due_date: "2027-09-04", milestone_id: MS2 });   // the finished task is untouched
      expect(line.task_pending.fields).toEqual({ start_date: null, due_date: null, milestone_id: null });
      expect(line.task_pending.reason).toMatch(/done|edited|finished/i);
      expect(await call<Row>(U.pm, `proj_dp_reconcile_task('${L.c}', 'retry')`)).toEqual({ status: "pending" });     // still refused, still flagged
      expect(await call<Row>(U.pm, `proj_dp_reconcile_task('${L.c}', 'keep_task')`)).toEqual({ status: "kept_task" });
      const kept = (await plan(U.pm, REG)).items.flatMap((i: Row) => i.lines).find((l: Row) => l.id === L.c);
      expect(kept).toMatchObject({ task_pending: null, start_date: "2027-09-01", needed_by: "2027-09-04", milestone_id: MS2 });
    });

    it("a cleared milestone the existing rules do not let the actor change is flagged, not silently dropped", async () => {
      const item = (await saveItem(U.pm, REG, { title: "Role activation", owner_id: U.design })).id;
      L.d = (await saveLine(U.pm, item, { section: "content", description: "Cancelled then cleared", assignee_id: U.design, milestone_id: MS2, needed_by: "2027-09-10" })).id;
      await call(U.pm, `proj_dp_release('${REG}', array['${item}']::uuid[])`);
      const td = await taskOf(L.d);
      await call(U.pm, `proj_set_task_status('${td}', 'cancelled', 'Scope dropped')`);
      const res = await saveLine(U.pm, item, { milestone_id: null }, L.d);
      await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved')`);
      const line = (await plan(U.pm, REG)).items.flatMap((i: Row) => i.lines).find((l: Row) => l.id === L.d);
      expect(line.task_pending.fields).toEqual({ milestone_id: null });
      expect((await admin<Row>(`select milestone_id m from proj_tasks where id = '${td}'`))[0]!.m).toBe(MS2);
    });
  });

  it("rollback: refuses while Release 1 data exists; once it is cleared it restores the previous behaviour, keeps tasks and equipment, and the migration applies again", async () => {
    const tasks = await count(`select 1 from proj_tasks where project_id = '${KIDS}'`);
    const eq = await count(`select 1 from inv_request_lines`);
    await expect(db.seed(pack("proj_project_plan_r1_90_rollback.sql"))).rejects.toThrow(/STOP: the plan holds Release 1 data/);
    expect(await count(`select 1 from information_schema.columns where table_name = 'proj_dp_lines' and column_name = 'supply_route'`)).toBe(1);   // nothing was changed
    await admin(`delete from proj_dp_changes; delete from proj_dp_lines; delete from proj_dp_items; delete from proj_dp_delegations`);
    await db.seed(pack("proj_project_plan_r1_90_rollback.sql"));
    await db.seed(pack("proj_project_plan_r1_90_rollback.sql"));                       // safe to run twice
    expect(await count(`select 1 from information_schema.columns where table_name = 'proj_dp_lines' and column_name in ('supply_route', 'detail', 'depends_on', 'milestone_id', 'start_date', 'task_pending')`)).toBe(0);
    expect(await count(`select 1 from pg_proc where proname in ('proj_dp_seed_scope', 'proj_dp_reconcile_task', 'proj_dp_add_sequence', 'proj_dp_sync_task', 'proj_dp_clean_detail')`)).toBe(0);
    expect(await count(`select 1 from proj_tasks where project_id = '${KIDS}'`)).toBe(tasks);
    expect(await count(`select 1 from inv_request_lines`)).toBe(eq);
    // the Delivery Plan works as before: an original section, the original release
    const it0 = (await call<Row>(U.pm, `proj_dp_save_item('${LEGACY}', null, ${j({ zone: "Hall", title: "After rollback", owner_id: U.dev })})`)).id;
    await call(U.pm, `proj_dp_save_line('${it0}', null, ${j({ section: "installation", description: "Rig it" })})`);
    await expect(call(U.pm, `proj_dp_save_line('${it0}', null, ${j({ section: "site", description: "New section" })})`)).rejects.toThrow(/Choose the section/);
    expect(await call<Row>(U.pm, `proj_dp_release('${LEGACY}')`)).toMatchObject({ tasks: 1, equipment: 0 });
    await db.applyMigration("20270104000100_proj_project_plan_r1.sql");
    expect((await plan(U.pm, LEGACY)).scope).toBeDefined();
  });
});
