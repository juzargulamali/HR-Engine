import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects Phase 2, part 1: the Delivery Plan (migration 20261231000100_proj_delivery_plan.sql). Proves, against a real Postgres:
//   * every project member reads the whole plan; someone outside the project reads nothing and can call nothing;
//   * the manager edits deliverable rows; a delegated member edits lines of THEIR section only; nobody else writes;
//   * release creates ONE task per work line and ONE draft equipment line per hardware line, and a second release, save or import creates none;
//   * the equipment request stays a Draft: submitting it is not done by the plan;
//   * a released row or line never changes silently: the difference becomes a proposal a manager approves or rejects; booked equipment cannot be changed from the plan;
//   * anyone on the project raises a correction, it is routed to a lead, the Project Manager is told, and the person who raised it sees the decision;
//   * an import is applied in one transaction, refused when the plan moved on since the preview, and cannot bypass any of the above.

const id = () => randomUUID();
const CO = { a: id() };
const U = { pm: id(), eng: id(), content: id(), prog: id(), tech: id(), outsider: id(), founder: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@dp-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const DENIED = /Only |not found|permission denied/i;

describe("Delivery Plan", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const count = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0]!.n);
  const plan = (user: string, project = P1) => call<Row>(user, `proj_dp_plan('${project}')`);
  const saveItem = (user: string, fields: Row, itemId: string | null = null, project = P1) => call<Row>(user, `proj_dp_save_item('${project}', ${itemId ? `'${itemId}'` : "null"}, ${j(fields)})`);
  const saveLine = (user: string, itemId: string, fields: Row, lineId: string | null = null) => call<Row>(user, `proj_dp_save_line('${itemId}', ${lineId ? `'${lineId}'` : "null"}, ${j(fields)})`);
  const release = (user: string, project = P1) => call<Row>(user, `proj_dp_release('${project}')`);
  let P1 = "", P2 = "", LED = "", SERVER = "", wall = "", kiosk = "", hw = "", content = "", prog = "", install = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE');
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO.a}', '{founder}');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.a}', '{}'), ('${U.eng}', '${CO.a}', '{}'), ('${U.content}', '${CO.a}', '{}'), ('${U.prog}', '${CO.a}', '{}'), ('${U.tech}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.a}', '{}');
      insert into inv_items (company_id, name, tracking, status) values ('${CO.a}', 'LED panel P2.6', 'quantity', 'active'), ('${CO.a}', 'Media server', 'quantity', 'active');
    `);
    LED = (await admin<{ id: string }>(`select id from inv_items where name = 'LED panel P2.6'`))[0]!.id;
    SERVER = (await admin<{ id: string }>(`select id from inv_items where name = 'Media server'`))[0]!.id;
    P1 = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.a}', 'UAE-P-2027-0001', 'Fictional Expo stand', 'internal', 'in_progress', '${U.pm}', '${U.pm}') returning id`))[0]!.id;
    P2 = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.a}', 'UAE-P-2027-0002', 'Fictional other job', 'internal', 'in_progress', '${U.outsider}', '${U.outsider}') returning id`))[0]!.id;
    await db.seed(`
      insert into proj_project_details (project_id, location, site_timezone) values ('${P1}', 'Hall 4', 'Asia/Dubai'), ('${P2}', 'Hall 9', 'Asia/Dubai');
      insert into proj_project_members (project_id, user_id, role) values ('${P1}', '${U.pm}', 'pm'), ('${P1}', '${U.eng}', 'member'), ('${P1}', '${U.content}', 'member'), ('${P1}', '${U.prog}', 'member'), ('${P1}', '${U.tech}', 'member'),
        ('${P2}', '${U.outsider}', 'pm');
    `);
  });
  afterAll(async () => db.teardown());

  it("the manager adds deliverable rows with stable keys; the same zone and name is the same row, not a second one", async () => {
    const a = await saveItem(U.pm, { zone: "Entrance", title: "Interactive LED welcome wall", specs: "6 x 4 m, touch", owner_id: U.eng, needed_by: "2027-03-01" });
    expect(a.created).toBe(true);
    wall = a.id;
    const again = await saveItem(U.pm, { zone: " entrance ", title: "interactive led welcome wall" });
    expect(again).toMatchObject({ id: wall, existing: true });
    kiosk = (await saveItem(U.pm, { zone: "Lounge", title: "Product kiosk" })).id;
    const p = await plan(U.tech);
    expect(p.items.map((i: Row) => [i.key, i.zone, i.title])).toEqual([["D001", "Entrance", "Interactive LED welcome wall"], ["D002", "Lounge", "Product kiosk"]]);
    expect(p.items[0].owner_name).toBe("eng");
    await expect(saveItem(U.tech, { zone: "x", title: "y" })).rejects.toThrow(/Only the Project Manager/);
    await expect(saveItem(U.pm, { zone: "x", title: "y", owner_id: U.outsider })).rejects.toThrow(/active member/);
    await expect(saveItem(U.pm, { zone: "Lounge", title: "Product kiosk" }, wall)).rejects.toThrow(/already has that name/);
  });

  it("sections are delegated: the delegate edits their section only; everyone on the project still reads all of it; an outsider reads and calls nothing", async () => {
    await expect(saveLine(U.content, wall, { section: "content", description: "Welcome loop video", qty: 3 })).rejects.toThrow(/delegated/);
    await call(U.pm, `proj_dp_delegate('${P1}', 'content', '${U.content}')`);
    await call(U.pm, `proj_dp_delegate('${P1}', 'programming', '${U.prog}')`);
    await call(U.pm, `proj_dp_delegate('${P1}', 'hardware', '${U.eng}')`);
    await expect(call(U.eng, `proj_dp_delegate('${P1}', 'testing', '${U.eng}')`)).rejects.toThrow(/Only the Project Manager/);
    await expect(call(U.pm, `proj_dp_delegate('${P1}', 'testing', '${U.outsider}')`)).rejects.toThrow(/active member/);
    content = (await saveLine(U.content, wall, { section: "content", description: "Welcome loop video", qty: 3, assignee_id: U.content })).id;
    prog = (await saveLine(U.prog, wall, { section: "programming", description: "Touch app and CMS integration", assignee_id: U.prog })).id;
    hw = (await saveLine(U.eng, wall, { section: "hardware", description: "LED panels", qty: 48, inv_item_id: LED })).id;
    install = (await saveLine(U.pm, wall, { section: "installation", description: "Build and rig the wall", assignee_id: U.tech, needed_by: "2027-02-27" })).id;
    await expect(saveLine(U.content, wall, { section: "programming", description: "Not my section" })).rejects.toThrow(/delegated/);
    await expect(saveLine(U.prog, wall, { description: "changed" }, content)).rejects.toThrow(/delegated/);
    await expect(saveLine(U.tech, wall, { section: "testing", description: "x" })).rejects.toThrow(/delegated/);
    await expect(saveLine(U.eng, wall, { section: "content", description: "x", inv_item_id: LED })).rejects.toThrow(/delegated|Hardware/);
    expect((await saveLine(U.content, wall, { section: "content", description: " welcome LOOP video " })).existing).toBe(true);   // the same line, not a second
    const seen = await plan(U.tech);                                                  // a member with no section sees every section
    expect(seen.items[0].lines.map((l: Row) => l.section).sort()).toEqual(["content", "hardware", "installation", "programming"]);
    expect(seen.can_manage).toBe(false);
    expect((await plan(U.content)).my_sections).toEqual(["content"]);
    // outside the project
    await expect(plan(U.outsider)).rejects.toThrow(/not found/);
    expect(await q(U.outsider, `select id from proj_dp_items where project_id = '${P1}'`)).toHaveLength(0);
    expect(await q(U.outsider, `select id from proj_dp_lines where project_id = '${P1}'`)).toHaveLength(0);
    await expect(saveItem(U.outsider, { zone: "x", title: "y" })).rejects.toThrow(DENIED);
    await expect(call(U.outsider, `proj_dp_release('${P1}')`)).rejects.toThrow(DENIED);
    await expect(call(U.outsider, `proj_dp_raise_correction('${P1}', 'scope', null, 'hello')`)).rejects.toThrow(DENIED);
    await expect(call(U.outsider, `proj_dp_apply_import('${P1}', 0, '[]', '[]')`)).rejects.toThrow(DENIED);
    await expect(db.asUser(null, async (query) => (await query(`select proj_dp_plan('${P1}')`)).rows)).rejects.toThrow(/permission denied/);
    // the tables cannot be written directly, even by the manager
    await q(U.pm, `update proj_dp_items set title = 'x' where id = '${wall}'`).catch(() => undefined);     // refused, or zero rows: there is no write policy
    expect(await count(`select 1 from proj_dp_items where id = '${wall}' and title = 'x'`)).toBe(0);
  });

  it("release: one task per work line, one DRAFT equipment line per hardware line; only the manager; a hardware line without a stock item waits", async () => {
    const noItem = (await saveLine(U.eng, kiosk, { section: "hardware", description: "Kiosk enclosure (to be chosen)" })).id;
    await expect(release(U.eng)).rejects.toThrow(/Only the Project Manager/);
    const r = await release(U.pm);
    expect(r).toMatchObject({ tasks: 3, equipment: 1, already: 0 });
    expect(r.skipped).toEqual([{ line: expect.stringMatching(/^L\d{4}$/), reason: "Choose the stock item for this hardware line first" }]);
    const p = await plan(U.pm);
    const lines: Row[] = p.items[0].lines;
    const byId = (x: string) => lines.find((l) => l.id === x)!;
    expect(byId(content).task).toMatchObject({ status: "todo", assignee_name: "content", title: "Interactive LED welcome wall: Welcome loop video" });
    expect(byId(install).task).toMatchObject({ due_date: "2027-02-27", assignee_name: "tech" });
    expect(byId(prog).task.due_date).toBe("2027-03-01");                              // the deliverable's date when the line has none
    expect(byId(hw).equipment).toMatchObject({ request_status: "draft", qty: 48, reserved: 0, dispatched: 0, returned: 0 });
    expect(p.items[0].released_at).not.toBeNull();
    expect(p.items[1].released_at).toBeNull();                                        // nothing of the kiosk was released
    expect(await count(`select 1 from inv_requests where project_id = '${P1}'`)).toBe(1);
    expect(await count(`select 1 from inv_requests where project_id = '${P1}' and status = 'draft' and submitted_at is null`)).toBe(1);   // never submitted by the plan
    // the tasks are ordinary tasks: the assignee was told through the existing task rules
    expect(await count(`select 1 from proj_tasks where project_id = '${P1}'`)).toBe(3);
    void noItem;
  });

  it("releasing, saving or importing again creates no second task and no second equipment line", async () => {
    const before = { tasks: await count(`select 1 from proj_tasks where project_id = '${P1}'`), eq: await count(`select 1 from inv_request_lines`) };
    expect(await release(U.pm)).toMatchObject({ tasks: 0, equipment: 0, already: 4 });
    expect(await release(U.pm)).toMatchObject({ tasks: 0, equipment: 0, already: 4 });
    await saveLine(U.content, wall, { section: "content", description: "Welcome loop video", qty: 3 });
    const rev = (await plan(U.pm)).rev;
    const same = await call<Row>(U.pm, `proj_dp_apply_import('${P1}', ${rev}, ${j([{ ref: "r1", fields: { zone: "Entrance", title: "Interactive LED welcome wall" } }])}, ${j([{ item_ref: "r1", fields: { section: "content", description: "Welcome loop video" } }])})`);
    expect(same).toMatchObject({ added: 0, updated: 0, proposed: 0, unchanged: 2 });
    expect({ tasks: await count(`select 1 from proj_tasks where project_id = '${P1}'`), eq: await count(`select 1 from inv_request_lines`) }).toEqual(before);
  });

  it("progress is read from the task and the equipment line, never stored: finishing the task shows in the plan", async () => {
    const task = (await admin<{ task_id: string }>(`select task_id from proj_dp_lines where id = '${install}'`))[0]!.task_id;
    await call(U.tech, `proj_set_task_status('${task}', 'in_progress')`);
    await call(U.tech, `proj_set_task_status('${task}', 'done')`);
    const p = await plan(U.content);
    expect(p.items[0].lines.find((l: Row) => l.id === install).task.status).toBe("done");
  });

  it("a released row or line does not change silently: the difference is a proposal; a manager approves or rejects; the proposer sees the decision", async () => {
    const res = await saveLine(U.content, wall, { qty: 5, needed_by: "2027-02-20" }, content);
    expect(res.proposed).toBeTruthy();
    let line = (await plan(U.pm)).items[0].lines.find((l: Row) => l.id === content);
    expect(line.qty).toBe(3);                                                          // unchanged until decided
    await expect(call(U.content, `proj_dp_decide_change('${res.proposed}', 'approved')`)).rejects.toThrow(/Only the Project Manager/);
    await expect(call(U.pm, `proj_dp_decide_change('${res.proposed}', 'rejected')`)).rejects.toThrow(/Say why/);
    await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved', 'Client asked for two more loops')`);
    await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved')`);         // a repeated click
    const p = await plan(U.content);
    line = p.items[0].lines.find((l: Row) => l.id === content);
    expect(line).toMatchObject({ qty: 5, needed_by: "2027-02-20" });
    expect(p.changes[0]).toMatchObject({ status: "approved", decided_by_name: "pm", decision_note: "Client asked for two more loops", proposed_by_name: "content" });
    // the deliverable row itself
    const item = await saveItem(U.pm, { needed_by: "2027-03-05", specs: "6 x 4 m, touch, 4K" }, wall);
    expect(item.proposed).toBeTruthy();
    expect((await plan(U.pm)).items[0].needed_by).toBe("2027-03-01");
    await call(U.pm, `proj_dp_decide_change('${item.proposed}', 'rejected', 'Date is fixed by the venue')`);
    expect((await plan(U.pm)).items[0]).toMatchObject({ needed_by: "2027-03-01", specs: "6 x 4 m, touch" });
    // a released row cannot be removed
    await expect(call(U.pm, `proj_dp_remove_item('${wall}')`)).rejects.toThrow(/released work/);
    await expect(call(U.content, `proj_dp_remove_line('${content}')`)).rejects.toThrow(/was released/);
  });

  it("a draft equipment line follows an approved quantity; once the request is with the warehouse the plan cannot change the booking, by screen or by import", async () => {
    const res = await saveLine(U.eng, wall, { qty: 50 }, hw);
    await call(U.pm, `proj_dp_decide_change('${res.proposed}', 'approved')`);
    expect((await plan(U.pm)).items[0].lines.find((l: Row) => l.id === hw).equipment.qty).toBe(50);
    await admin(`update inv_requests set status = 'submitted', submitted_at = now() where project_id = '${P1}'`);    // the PM submitted it on the Equipment tab
    const reqLine = (await admin<{ request_line_id: string }>(`select request_line_id from proj_dp_lines where id = '${hw}'`))[0]!.request_line_id;
    await expect(saveLine(U.eng, wall, { qty: 10 }, hw)).rejects.toThrow(/already with the warehouse/);
    const rev = (await plan(U.pm)).rev;
    await expect(call(U.pm, `proj_dp_apply_import('${P1}', ${rev}, '[]', ${j([{ item_id: wall, id: hw, fields: { qty: 10 } }])})`)).rejects.toThrow(/already with the warehouse/);
    expect(Number((await admin<{ qty: string }>(`select qty from inv_request_lines where id = '${reqLine}'`))[0]!.qty)).toBe(50);
    expect((await plan(U.pm)).items[0].lines.find((l: Row) => l.id === hw)).toMatchObject({ qty: 50, equipment: { request_status: "submitted" } });
    expect(await count(`select 1 from proj_dp_changes where line_id = '${hw}' and status = 'proposed'`)).toBe(0);
    // notes are not a commitment and may still be written
    expect((await saveLine(U.eng, wall, { notes: "Spare panels in case 12" }, hw)).unchanged).toBe(true);
  });

  it("anyone on the project raises a correction; it goes to the relevant lead, the Project Manager is told, and the person who raised it sees the decision", async () => {
    const c1 = await call<string>(U.tech, `proj_dp_raise_correction('${P1}', 'line', '${prog}', 'The CMS needs an offline mode')`);
    const row = (await admin<Row>(`select * from proj_dp_corrections where id = '${c1}'`))[0]!;
    expect(row.routed_to).toBe(U.prog);                                               // the section's delegate
    expect(await count(`select 1 from notifications where type = 'project_plan_correction' and user_id = '${U.prog}' and payload->>'correction_id' = '${c1}'`)).toBe(1);
    expect(await count(`select 1 from notifications where type = 'project_plan_correction' and user_id = '${U.pm}' and payload->>'fyi' = 'true' and payload->>'correction_id' = '${c1}'`)).toBe(1);
    expect(await count(`select 1 from notifications where payload::text like '%offline mode%'`)).toBe(0);       // the text is never copied into a notice
    await expect(call(U.content, `proj_dp_decide_correction('${c1}', 'accepted')`)).rejects.toThrow(/lead this correction was sent to/);
    await expect(call(U.prog, `proj_dp_decide_correction('${c1}', 'declined')`)).rejects.toThrow(/Say why/);
    await call(U.prog, `proj_dp_decide_correction('${c1}', 'accepted', 'Adding it to the app scope')`);
    const seen = (await plan(U.tech)).corrections.find((c: Row) => c.id === c1);
    expect(seen).toMatchObject({ status: "accepted", decided_by_name: "prog", decision_note: "Adding it to the app scope", routed_to_name: "prog" });
    expect(await count(`select 1 from notifications where type = 'project_plan_correction_decided' and user_id = '${U.tech}'`)).toBe(1);
    // on a deliverable it goes to the accountable owner; on the agreed scope, and when the lead is the person raising it, to the Project Manager
    const c2 = await call<string>(U.content, `proj_dp_raise_correction('${P1}', 'deliverable', '${wall}', 'Wall is 6.5 m on the drawing')`);
    const c3 = await call<string>(U.tech, `proj_dp_raise_correction('${P1}', 'scope', null, 'Scope says two kiosks')`);
    const c4 = await call<string>(U.eng, `proj_dp_raise_correction('${P1}', 'deliverable', '${wall}', 'Own deliverable')`);
    const routed = await admin<Row>(`select id, routed_to from proj_dp_corrections where id in ('${c2}', '${c3}', '${c4}')`);
    expect(routed.find((r) => r.id === c2)!.routed_to).toBe(U.eng);
    expect(routed.find((r) => r.id === c3)!.routed_to).toBe(U.pm);
    expect(routed.find((r) => r.id === c4)!.routed_to).toBe(U.pm);
    // a correction on a task of the project
    const task = (await admin<{ task_id: string }>(`select task_id from proj_dp_lines where id = '${content}'`))[0]!.task_id;
    await call<string>(U.prog, `proj_dp_raise_correction('${P1}', 'task', '${task}', 'Video count differs')`);
    await expect(call(U.tech, `proj_dp_raise_correction('${P1}', 'line', '${id()}', 'x')`)).rejects.toThrow(/not found/);
    // a correction changes nothing by itself
    expect((await plan(U.pm)).items[0].title).toBe("Interactive LED welcome wall");
  });

  it("an import is one transaction: refused when the plan moved on since the preview, refused whole when one row is not allowed, and it never releases anything", async () => {
    const rev = (await plan(U.pm)).rev;
    const items = [{ ref: "n1", fields: { zone: "Stage", title: "Holographic plinth", owner_id: U.eng } }];
    const lines = [{ item_ref: "n1", fields: { section: "hardware", description: "Plinth projector", qty: 1, inv_item_id: SERVER } }, { item_ref: "n1", fields: { section: "testing", description: "Soak test" } }];
    await expect(call(U.pm, `proj_dp_apply_import('${P1}', ${rev - 1}, ${j(items)}, ${j(lines)})`)).rejects.toThrow(/changed after this preview/);
    // a delegate of Content cannot import a Hardware line, and then nothing of the file is saved
    await expect(call(U.content, `proj_dp_apply_import('${P1}', ${rev}, '[]', ${j([{ item_id: kiosk, fields: { section: "content", description: "Kiosk screensaver" } }, { item_id: kiosk, fields: { section: "hardware", description: "Extra screen" } }])})`)).rejects.toThrow(/delegated/);
    expect(await count(`select 1 from proj_dp_lines where description = 'Kiosk screensaver'`)).toBe(0);
    const res = await call<Row>(U.pm, `proj_dp_apply_import('${P1}', ${rev}, ${j(items)}, ${j(lines)})`);
    expect(res).toMatchObject({ added: 3, updated: 0, proposed: 0 });
    const p = await plan(U.pm);
    const plinth = p.items.find((i: Row) => i.title === "Holographic plinth");
    expect(plinth.released_at).toBeNull();
    expect(plinth.lines.every((l: Row) => l.released_at === null && l.task === null && l.equipment === null)).toBe(true);
    // the same file again: nothing added (the old rev is refused; with the new rev everything is unchanged)
    await expect(call(U.pm, `proj_dp_apply_import('${P1}', ${rev}, ${j(items)}, ${j(lines)})`)).rejects.toThrow(/changed after this preview/);
    expect(await call<Row>(U.pm, `proj_dp_apply_import('${P1}', ${res.rev}, ${j(items)}, ${j(lines)})`)).toMatchObject({ added: 0, updated: 0, proposed: 0, unchanged: 3 });
    // an import that touches a released row proposes, it does not apply
    const r2 = await call<Row>(U.pm, `proj_dp_apply_import('${P1}', ${res.rev}, ${j([{ id: wall, fields: { needed_by: "2027-03-09" } }])}, '[]')`);
    expect(r2).toMatchObject({ proposed: 1, updated: 0 });
    expect((await plan(U.pm)).items[0].needed_by).toBe("2027-03-01");
    expect((await plan(U.pm)).changes[0]).toMatchObject({ source: "excel", status: "proposed" });
  });

  it("a finished project's plan is read-only, and another project's plan is its own", async () => {
    expect((await plan(U.outsider, P2)).items).toEqual([]);
    await expect(plan(U.pm, P2)).rejects.toThrow(/not found/);
    await admin(`update proj_projects set status = 'completed' where id = '${P1}'`);
    await expect(saveItem(U.pm, { zone: "x", title: "After the end" })).rejects.toThrow();
    await expect(release(U.pm)).rejects.toThrow();
    expect((await plan(U.tech)).items.length).toBe(3);
  });
});
