import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Project Plan usability follow-up (migration 20270105000100_proj_plan_quick_add_reorder.sql), against a real Postgres. Fictional data throughout.
//   * Quick add (proj_dp_add_lines): many requirements in one call, each through proj_dp_save_line, so the same permission and the same "same name in the same section is the
//     same line" rule apply. A retried or double-submitted save adds nothing. One refused row refuses the whole batch and names the row; nothing is half-saved.
//   * Reorder (proj_dp_reorder_lines): the order persists, a subset keeps every other line where it was, resending the same order changes nothing, released lines can be
//     reordered without a proposal, a task or an equipment line being touched, and the section rules decide who may.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), design: id(), eng: id(), member: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@plan-order.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

describe("Project Plan: Quick add and persisted order", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const count = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0]!.n);
  const plan = (user: string, project: string) => call<Row>(user, `proj_dp_plan('${project}')`);
  const saveItem = (user: string, project: string, fields: Row) => call<Row>(user, `proj_dp_save_item('${project}', null, ${j(fields)})`);
  const quick = (user: string, item: string, section: string, rows: Row[], chain = false) => call<Row>(user, `proj_dp_add_lines('${item}', '${section}', ${j(rows)}, ${chain})`);
  const reorder = (user: string, item: string, ids: string[]) => call<Row>(user, `proj_dp_reorder_lines('${item}', array[${ids.map((x) => `'${x}'`).join(", ")}]::uuid[])`);
  const names = (p: Row, itemId: string, section?: string) => p.items.find((i: Row) => i.id === itemId).lines.filter((l: Row) => !section || l.section === section).map((l: Row) => l.description);
  const lineIds = (p: Row, itemId: string, section?: string): string[] => p.items.find((i: Row) => i.id === itemId).lines.filter((l: Row) => !section || l.section === section).map((l: Row) => l.id);

  let P = "", OTHER = "", BATAK = "", WALL = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.a}', '{}'), ('${U.design}', '${CO.a}', '{}'), ('${U.eng}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.b}', '{}');
    `);
    const proj = async (co: string, ref: string, name: string, pm: string) => (await admin<{ id: string }>(
      `insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${co}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    P = await proj(CO.a, "UAE-P-2027-0201", "Fictional Order Project", U.pm);
    OTHER = await proj(CO.b, "OTH-P-2027-0002", "Fictional other company job", U.outsider);
    await db.seed(`
      insert into proj_project_details (project_id, location, site_timezone, scope, technologies) values
        ('${P}', 'Fictional Hall', 'Asia/Dubai', null, '[]'::jsonb), ('${OTHER}', 'Elsewhere', 'Asia/Dubai', null, '[]'::jsonb);
      insert into proj_project_members (project_id, user_id, role) values
        ('${P}', '${U.pm}', 'pm'), ('${P}', '${U.design}', 'member'), ('${P}', '${U.eng}', 'member'), ('${P}', '${U.member}', 'member'), ('${OTHER}', '${U.outsider}', 'pm');
    `);
    BATAK = (await saveItem(U.pm, P, { title: "Batak wall", owner_id: U.eng, needed_by: "2027-06-01" })).id;
    WALL = (await saveItem(U.pm, P, { title: "Welcome wall", owner_id: U.design, needed_by: "2027-06-02" })).id;
    await call(U.pm, `proj_dp_delegate('${P}', 'content', '${U.design}')`);
  });
  afterAll(async () => db.teardown());

  const HARDWARE = [
    { description: "Batak unit", qty: 4 }, { description: "Power distribution box", qty: 2 }, { description: "Network switch", qty: 1 },
    { description: "Spare sensors", qty: 12 }, { description: "Flight case", qty: 3 },
  ];

  it("Quick add enters a list of requirements in one save, in the order given, each with its own owner, dates and quantity", async () => {
    const rows = HARDWARE.map((r, n) => ({ ...r, assignee_id: n === 0 ? U.eng : null, start_date: n === 0 ? "2027-05-20" : null, needed_by: n === 0 ? "2027-05-25" : null }));
    const res = await quick(U.pm, BATAK, "hardware", rows);
    expect(res).toMatchObject({ created: 5, existing: 0 });
    expect(res.lines).toHaveLength(5);
    const p = await plan(U.pm, P);
    expect(names(p, BATAK)).toEqual(HARDWARE.map((r) => r.description));
    const first = p.items.find((i: Row) => i.id === BATAK).lines[0];
    expect(first).toMatchObject({ qty: 4, assignee_id: U.eng, start_date: "2027-05-20", needed_by: "2027-05-25", section: "hardware", supply_route: "inventory", released_at: null });
    // nothing was released or sent anywhere by adding rows
    expect(await count(`select 1 from proj_tasks where project_id = '${P}'`)).toBe(0);
  });

  it("retrying the same save (a double click, a reload, a dropped connection) adds nothing: the rows that exist are reported as existing and left exactly as they are", async () => {
    await admin(`update proj_dp_lines set notes = 'edited later' where description = 'Network switch'`);
    const before = await count(`select 1 from proj_dp_lines where item_id = '${BATAK}'`);
    const rev = (await plan(U.pm, P)).rev;
    const again = await quick(U.pm, BATAK, "hardware", HARDWARE);
    expect(again).toMatchObject({ created: 0, existing: 5 });
    expect(await count(`select 1 from proj_dp_lines where item_id = '${BATAK}'`)).toBe(before);
    expect((await plan(U.pm, P)).rev).toBe(rev);                                              // nothing changed, so the plan revision did not move
    expect((await admin(`select notes from proj_dp_lines where description = 'Network switch'`))[0]!.notes).toBe('edited later');
    // a partly new list adds only what is new; the same name twice in one list is one line
    const mixed = await quick(U.pm, BATAK, "hardware", [...HARDWARE.slice(3), { description: "Cable ties", qty: 100 }, { description: "cable ties ", qty: 1 }]);
    expect(mixed).toMatchObject({ created: 1, existing: 3 });
    expect(await count(`select 1 from proj_dp_lines where item_id = '${BATAK}'`)).toBe(before + 1);
    // two saves at the same time still make one of each
    const [x, y] = await Promise.all([quick(U.pm, BATAK, "hardware", [{ description: "Gaffer tape", qty: 5 }]), quick(U.pm, BATAK, "hardware", [{ description: "Gaffer tape", qty: 5 }])]);
    expect(x.created + y.created).toBe(1);
    expect(await count(`select 1 from proj_dp_lines where item_id = '${BATAK}' and description = 'Gaffer tape'`)).toBe(1);
  });

  it("one refused row refuses the whole batch and names the row; nothing is half saved", async () => {
    const before = await count(`select 1 from proj_dp_lines where item_id = '${BATAK}'`);
    const bad = [{ description: "Good row one", qty: 1 }, { description: "Good row two", qty: 1 }, { description: "Row for a stranger", assignee_id: U.outsider }];
    await expect(quick(U.pm, BATAK, "hardware", bad)).rejects.toThrow(/Row 3: .*active member/);
    await expect(quick(U.pm, BATAK, "hardware", [{ description: "Fine" }, { description: "Zero", qty: 0 }])).rejects.toThrow(/Row 2: .*more than zero/);
    await expect(quick(U.pm, BATAK, "hardware", [{ description: "Fine" }, { description: "  " }])).rejects.toThrow(/Row 2: Describe the line/);
    await expect(quick(U.pm, BATAK, "hardware", [{ description: "Late", start_date: "2027-06-10", needed_by: "2027-06-01" }])).rejects.toThrow(/Row 1: .*before the start/);
    await expect(quick(U.pm, BATAK, "bogus", [{ description: "x" }])).rejects.toThrow(/Choose the section/);
    await expect(quick(U.pm, BATAK, "hardware", [])).rejects.toThrow(/at least one row/);
    await expect(quick(U.pm, BATAK, "hardware", Array.from({ length: 51 }, (_, n) => ({ description: `r${n}` })))).rejects.toThrow(/at most 50/);
    expect(await count(`select 1 from proj_dp_lines where item_id = '${BATAK}'`)).toBe(before);
    expect(await count(`select 1 from proj_dp_lines where description in ('Good row one', 'Good row two', 'Fine')`)).toBe(0);
  });

  it("who can Quick add follows the section rules: the Project Manager, or the person the section was delegated to, and nobody outside the company", async () => {
    await expect(quick(U.member, WALL, "content", [{ description: "Not allowed" }])).rejects.toThrow(/Only the Project Manager/);
    await expect(quick(U.design, WALL, "hardware", [{ description: "Wrong section" }])).rejects.toThrow(/Only the Project Manager/);
    await expect(quick(U.outsider, WALL, "content", [{ description: "Stranger" }])).rejects.toThrow(/not found|permission denied|Only |member/i);
    const ok = await quick(U.design, WALL, "content", [{ description: "Moodboard" }, { description: "Storyboard" }], true);
    expect(ok.created).toBe(2);
    expect(await count(`select 1 from proj_dp_lines where description = 'Not allowed' or description = 'Wrong section' or description = 'Stranger'`)).toBe(0);
  });

  it("with the chain on, each row waits for the one above it (Moodboard then Storyboard then First draft); a retry keeps the same chain", async () => {
    const res = await quick(U.design, WALL, "content", [{ description: "Moodboard" }, { description: "Storyboard" }, { description: "First draft" }], true);
    expect(res).toMatchObject({ created: 1, existing: 2 });
    const p = await plan(U.pm, P);
    const byName = Object.fromEntries(p.items.find((i: Row) => i.id === WALL).lines.map((l: Row) => [l.description, l]));
    expect(byName["Storyboard"].plan_depends_on.map((d: Row) => d.line_id)).toEqual([byName["Moodboard"].id]);
    expect(byName["First draft"].plan_depends_on.map((d: Row) => d.line_id)).toEqual([byName["Storyboard"].id]);
    expect(byName["Moodboard"].plan_depends_on).toEqual([]);
  });

  it("reordering persists, keeps every line it was not asked about where it was, and resending the same order changes nothing", async () => {
    const p0 = await plan(U.pm, P);
    const hw = lineIds(p0, BATAK, "hardware");
    expect(names(p0, BATAK, "hardware").slice(0, 5)).toEqual(HARDWARE.map((r) => r.description));
    // swap the second and fourth of the list (Power distribution box <-> Spare sensors)
    const swapped = [hw[0]!, hw[3]!, hw[2]!, hw[1]!, ...hw.slice(4)];
    const res = await reorder(U.pm, BATAK, swapped);
    expect(res.moved).toBeGreaterThan(0);
    const p1 = await plan(U.pm, P);
    expect(names(p1, BATAK, "hardware").slice(0, 4)).toEqual(["Batak unit", "Spare sensors", "Network switch", "Power distribution box"]);
    expect(p1.rev).toBeGreaterThan(p0.rev);
    // the same order again: nothing moves, the revision does not change
    expect(await reorder(U.pm, BATAK, swapped)).toMatchObject({ moved: 0 });
    expect((await plan(U.pm, P)).rev).toBe(p1.rev);
    // a subset: only the two named swap places; the rest do not move
    const sub = [hw[4]!, hw[0]!];                                                         // Flight case, Batak unit
    const before = lineIds(await plan(U.pm, P), BATAK);
    await reorder(U.pm, BATAK, sub);
    const after = lineIds(await plan(U.pm, P), BATAK);
    const posBefore = [before.indexOf(hw[0]!), before.indexOf(hw[4]!)], posAfter = [after.indexOf(hw[0]!), after.indexOf(hw[4]!)];
    expect(posAfter).toEqual([posBefore[1], posBefore[0]]);                                // the two exchanged places
    expect(after.filter((x) => !sub.includes(x))).toEqual(before.filter((x) => !sub.includes(x)));
    // the order survives a fresh read, and lines added afterwards go to the end
    await quick(U.pm, BATAK, "hardware", [{ description: "Last addition" }]);
    const end = names(await plan(U.pm, P), BATAK);
    expect(end[end.length - 1]).toBe("Last addition");
  });

  it("reordering never changes a line's own content or version, so an open edit dialog is not invalidated", async () => {
    const p0 = await plan(U.pm, P);
    const l0 = p0.items.find((i: Row) => i.id === BATAK).lines;
    await reorder(U.pm, BATAK, [...lineIds(p0, BATAK, "hardware")].reverse());
    const l1 = (await plan(U.pm, P)).items.find((i: Row) => i.id === BATAK).lines;
    for (const a of l0) {
      const b = l1.find((x: Row) => x.id === a.id);
      expect({ ...b }).toMatchObject({ description: a.description, qty: a.qty, assignee_id: a.assignee_id, needed_by: a.needed_by, start_date: a.start_date, version: a.version, key: a.key });
    }
  });

  it("released work can be reordered: no proposal, no task change, no equipment change", async () => {
    const wall = lineIds(await plan(U.pm, P), WALL, "content");
    await admin(`update proj_dp_items set owner_id = '${U.design}' where id = '${WALL}'`);
    await call(U.pm, `proj_dp_release('${P}', array['${WALL}']::uuid[])`);
    const tasks = await admin(`select id, title, assignee_id, due_date, status from proj_tasks where project_id = '${P}' order by title`);
    expect(tasks.length).toBe(wall.length);
    const proposals = await count(`select 1 from proj_dp_changes where project_id = '${P}'`);
    const released = await plan(U.pm, P);
    expect(released.items.find((i: Row) => i.id === WALL).lines.every((l: Row) => l.released_at)).toBe(true);
    const res = await reorder(U.design, WALL, [...wall].reverse());                       // the delegate reorders her own section
    expect(res.moved).toBeGreaterThan(0);
    expect(names(await plan(U.pm, P), WALL, "content")).toEqual(names(released, WALL, "content").reverse());
    expect(await count(`select 1 from proj_dp_changes where project_id = '${P}'`)).toBe(proposals);
    expect(await admin(`select id, title, assignee_id, due_date, status from proj_tasks where project_id = '${P}' order by title`)).toEqual(tasks);
  });

  it("who can reorder follows the section rules, and a bad list is refused whole", async () => {
    const p = await plan(U.pm, P);
    const hw = lineIds(p, BATAK, "hardware"), wall = lineIds(p, WALL, "content");
    const order = (itemId: string) => lineIds(p, itemId);
    await expect(reorder(U.member, WALL, [...wall].reverse())).rejects.toThrow(/Only the Project Manager/);
    await expect(reorder(U.design, BATAK, [...hw].reverse())).rejects.toThrow(/Only the Project Manager/);          // delegated Content, not Hardware
    await expect(reorder(U.outsider, BATAK, [...hw].reverse())).rejects.toThrow(/not found|permission denied|Only |member/i);
    await expect(reorder(U.pm, BATAK, [hw[0]!, hw[0]!])).rejects.toThrow(/listed twice/);
    await expect(reorder(U.pm, BATAK, [hw[0]!, wall[0]!])).rejects.toThrow(/Line not found/);                       // a line of another technology
    await expect(reorder(U.pm, BATAK, [hw[0]!, randomUUID()])).rejects.toThrow(/Line not found/);
    await expect(reorder(U.pm, BATAK, [])).rejects.toThrow(/Nothing to reorder/);
    await expect(call(U.pm, `proj_dp_reorder_lines('${randomUUID()}', array['${hw[0]}']::uuid[])`)).rejects.toThrow(/not found/);
    // nothing above changed the order
    expect(lineIds(await plan(U.pm, P), BATAK)).toEqual(order(BATAK));
  });

  it("a read-only project (completed) refuses both", async () => {
    const done = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.a}', 'UAE-P-2027-0203', 'Fictional finished job', 'internal', 'completed', '${U.pm}', '${U.pm}') returning id`))[0]!.id;
    await admin(`insert into proj_project_details (project_id, location, site_timezone, technologies) values ('${done}', 'x', 'Asia/Dubai', '[]'::jsonb); insert into proj_project_members (project_id, user_id, role) values ('${done}', '${U.pm}', 'pm');`);
    const it = (await admin<{ id: string }>(`insert into proj_dp_items (project_id, item_key, zone, title) values ('${done}', 'D001', '', 'Old wall') returning id`))[0]!.id;
    await expect(quick(U.pm, it, "hardware", [{ description: "x" }])).rejects.toThrow();
    await expect(reorder(U.pm, it, [randomUUID()])).rejects.toThrow();
  });

  it("the owner packs: preflight has no STOP, verify says OK on every row, rollback drops only the two functions and leaves the rows and their order", async () => {
    expect((await admin(pack("proj_plan_quick_add_reorder_00_preflight_readonly.sql"))).filter((r) => String(r.result).startsWith("STOP"))).toEqual([]);
    const rows = await admin(pack("proj_plan_quick_add_reorder_20_verify_readonly.sql"));
    expect(rows.filter((r) => r.result !== "OK")).toEqual([]);
    expect(rows.length).toBe(4);
    const order = names(await plan(U.pm, P), BATAK);
    await admin(pack("proj_plan_quick_add_reorder_90_rollback.sql"));
    await admin(pack("proj_plan_quick_add_reorder_90_rollback.sql"));                    // safe to run twice
    await expect(quick(U.pm, BATAK, "hardware", [{ description: "x" }])).rejects.toThrow(/does not exist|Could not find/i);
    expect(names(await plan(U.pm, P), BATAK)).toEqual(order);
    // and the migration applies again
    await admin(readFileSync(path.join(__dirname, "../../../supabase/migrations/20270105000100_proj_plan_quick_add_reorder.sql"), "utf8"));
    expect((await quick(U.pm, BATAK, "hardware", [{ description: "x" }])).created).toBe(1);
  });
});
