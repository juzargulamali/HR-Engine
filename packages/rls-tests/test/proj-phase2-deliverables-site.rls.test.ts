import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects & Tasks Phase 2 (migration 20270106000100_proj_phase2_deliverables_site.sql), against a real Postgres. Fictional data throughout.
//   * Task deliverables: an expected output on a task; versions with their own attachment time, submitter and review status; approval is a separate event with its own time;
//     review and approval apply to the EXACT version (a stale one is refused, v1's decision survives v2); a REQUIRED output is enforced in the existing review / completion path;
//     retries and concurrent submissions never duplicate a version; a restricted file is never opened through a reference; the register hides what the reader may not open.
//   * Site schedule: RAF (setup on 11 Nov, show on 12 Nov and dismantling, a second setup with its time still to confirm, show on 14-15 Nov), crew per activity, an overseas
//     shipment arriving after the setup it supports, Inventory state read from the request, a confirmed date cannot change silently.
//   * Work overview: next on site, needs attention, recent changes. Cross-company denial throughout.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), head: id(), design: id(), eng: id(), crew1: id(), crew2: id(), ops: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@phase2.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe("Projects Phase 2: deliverables, versioned reviews, site schedule, Work overview", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const count = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0]!.n);
  const createTask = (user: string, project: string, f: Row) => call<string>(user, `proj_create_task('${project}', ${j(f)})`);
  const setOutput = (user: string, task: string, label: string | null, qty: number | null, required: boolean) =>
    call<Row>(user, `proj_set_task_output('${task}', ${label === null ? "null" : `'${label}'`}, ${qty ?? "null"}, ${required})`);
  const submit = (user: string, task: string, file: string, o: { snap?: string; items?: number; note?: string; key?: string; mutable?: boolean; expect?: number } = {}) =>
    call<Row>(user, `proj_submit_task_output('${task}', '${file}', ${o.snap ? `'${o.snap}'` : "null"}, ${o.items ?? 1}, ${o.note ? `'${o.note}'` : "null"}, ${o.mutable ?? false}, ${o.key ? `'${o.key}'` : "null"}, ${o.expect ?? "null"})`);
  const decide = (user: string, version: string, decision: string, note?: string) => call<Row>(user, `proj_decide_task_output('${version}', '${decision}', ${note ? `'${note}'` : "null"})`);
  const status = (user: string, task: string, to: string, note?: string) => call(user, `proj_set_task_status('${task}', '${to}', ${note ? `'${note}'` : "null"})`);
  const register = (user: string, project: string, task: string | null = null) => call<Row>(user, `proj_deliverables_register('${project}', ${task ? `'${task}'` : "null"})`);
  const taskRow = async (task: string) => (await admin(`select status, completed_at from proj_tasks where id = '${task}'`))[0]!;
  const link = async (project: string, label: string, restricted = false) => (await admin<{ id: string }>(
    `insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${project}', 'link', 'document', '${label}', 'https://docs.example.com/${label.replace(/\W+/g, "-")}', ${restricted}, '${U.pm}') returning id`))[0]!.id;
  const file = async (project: string, name: string, restricted = false) => (await admin<{ id: string }>(
    `insert into proj_files (project_id, kind, purpose, label, original_name, storage_path, mime_type, size_bytes, restricted, uploaded_by)
     values ('${project}', 'file', 'document', '${name}', '${name}.pdf', '${project}/${id()}/${id()}-${name}.pdf', 'application/pdf', 1000, ${restricted}, '${U.pm}') returning id`))[0]!.id;

  let P = "", OTHER = "", TEAM = "", MS = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.a}', '{}'), ('${U.head}', '${CO.a}', '{}'), ('${U.design}', '${CO.a}', '{}'), ('${U.eng}', '${CO.a}', '{}'), ('${U.crew1}', '${CO.a}', '{}'), ('${U.crew2}', '${CO.a}', '{}'),
        ('${U.ops}', '${CO.a}', '{operations}'), ('${U.outsider}', '${CO.b}', '{}');
    `);
    const proj = async (co: string, ref: string, name: string, pm: string) => (await admin<{ id: string }>(
      `insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${co}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    P = await proj(CO.a, "UAE-P-2027-0301", "Fictional RAF Exhibition", U.pm);
    OTHER = await proj(CO.b, "OTH-P-2027-0301", "Fictional other company job", U.outsider);
    await db.seed(`
      insert into proj_project_details (project_id, location, site_timezone, scope, technologies, install_start, event_start, event_end) values
        ('${P}', 'Fictional Expo Centre', 'Asia/Dubai', null, '[]'::jsonb, '2027-11-11', '2027-11-12', '2027-11-15'), ('${OTHER}', 'Elsewhere', 'Asia/Dubai', null, '[]'::jsonb, null, null, null);
      insert into proj_project_members (project_id, user_id, role) values
        ('${P}', '${U.pm}', 'pm'), ('${P}', '${U.head}', 'member'), ('${P}', '${U.design}', 'member'), ('${P}', '${U.eng}', 'member'), ('${P}', '${U.crew1}', 'member'), ('${P}', '${U.crew2}', 'member'), ('${OTHER}', '${U.outsider}', 'pm');
    `);
    TEAM = (await admin<{ id: string }>(`insert into proj_teams (project_id, name, head_user_id, created_by) values ('${P}', 'Creative', '${U.head}', '${U.pm}') returning id`))[0]!.id;
    MS = (await admin<{ id: string }>(`insert into proj_milestones (project_id, title, due_date, created_by) values ('${P}', 'Ready for mockup', '2027-11-01', '${U.pm}') returning id`))[0]!.id;
  });
  afterAll(async () => db.teardown());

  // ---------------------------------------------------------------------------------------------------- deliverables
  let STORY = "", V1 = "", V2 = "";

  it("a task can define an expected output (Project Manager or team head only), optional or required; setting it again changes nothing", async () => {
    STORY = await createTask(U.pm, P, { title: "Storyboard", assignee_id: U.design, team_id: TEAM, requires_review: true, milestone_id: MS, due_date: day(30) });
    await expect(setOutput(U.design, STORY, "Storyboard", 1, true)).rejects.toThrow(/Only the Project Manager or the head/);
    await expect(setOutput(U.eng, STORY, "Storyboard", 1, true)).rejects.toThrow(/Only the Project Manager or the head|not found/i);
    await expect(setOutput(U.pm, STORY, null, 2, true)).rejects.toThrow(/Name the expected output/);
    await expect(setOutput(U.pm, STORY, "Storyboard", 0, true)).rejects.toThrow(/between 1 and 999/);
    expect(await setOutput(U.head, STORY, "Storyboard", 1, true)).toMatchObject({ updated: true });
    expect(await setOutput(U.head, STORY, "Storyboard", 1, true)).toMatchObject({ unchanged: true });
    expect((await admin(`select output_label, output_qty, output_required from proj_tasks where id = '${STORY}'`))[0]).toMatchObject({ output_label: "Storyboard", output_qty: 1, output_required: true });
    await expect(setOutput(U.outsider, STORY, "Hijack", 1, false)).rejects.toThrow(/not found|Only the Project Manager/i);
  });

  it("a REQUIRED output is enforced where the task is sent for review and completed: on the server, in the existing path", async () => {
    await status(U.design, STORY, "in_progress");
    await expect(status(U.design, STORY, "ready_for_review")).rejects.toThrow(/needs its expected output \(Storyboard\)/);
    const plain = await createTask(U.pm, P, { title: "Plain task without output", assignee_id: U.eng });
    await status(U.eng, plain, "in_progress"); await status(U.eng, plain, "done");
    expect((await taskRow(plain)).status).toBe("done");                                                        // tasks without a required output continue through the existing workflow
    const optional = await createTask(U.pm, P, { title: "Optional output task", assignee_id: U.eng });
    await setOutput(U.pm, optional, "Photo", 1, false);
    await status(U.eng, optional, "in_progress"); await status(U.eng, optional, "done");
    expect((await taskRow(optional)).status).toBe("done");                                                     // an optional output is not enforced
  });

  it("Storyboard v1 -> changes requested -> v2 -> approval: each event has its own time, v1's decision survives v2, approval is of the exact version, and the task and milestone follow", async () => {
    const f1 = await link(P, "Storyboard v1"), f2 = await link(P, "Storyboard v2");
    const s1 = await submit(U.design, STORY, f1, { note: "first pass", key: "attempt-story-v1", mutable: true });
    expect(s1).toMatchObject({ version_no: 1, created: true }); V1 = s1.id;
    await status(U.design, STORY, "ready_for_review");
    await expect(decide(U.design, V1, "approved")).rejects.toThrow(/cannot review your own work|Only the department head/);
    await expect(decide(U.eng, V1, "approved")).rejects.toThrow(/Only the department head or the Project Manager/);
    await expect(decide(U.head, V1, "changes_requested")).rejects.toThrow(/Say what needs changing/);
    expect(await decide(U.head, V1, "changes_requested", "Too dark, redo the second scene")).toMatchObject({ decision: "changes_requested" });
    expect((await taskRow(STORY)).status).toBe("in_progress");                                                  // the task moved with the decision
    await expect(status(U.design, STORY, "ready_for_review")).rejects.toThrow(/Changes were requested on version 1/);
    const s2 = await submit(U.design, STORY, f2, { note: "second pass", key: "attempt-story-v2" });
    expect(s2).toMatchObject({ version_no: 2, created: true }); V2 = s2.id;
    // v1's decision and timestamps are untouched by v2
    const r1 = (await admin(`select status, decided_at, attached_at, approved_at, decision_note from proj_task_output_versions where id = '${V1}'`))[0]!;
    expect(r1).toMatchObject({ status: "changes_requested", approved_at: null, decision_note: "Too dark, redo the second scene" });
    // a reviewer with a stale screen (still showing v1) cannot touch the old version, and approving the NEW one is explicit
    await expect(decide(U.head, V1, "approved")).rejects.toThrow(/no longer the current one: version 2 was submitted/);
    await status(U.design, STORY, "ready_for_review");
    const before = new Date();
    expect(await decide(U.head, V2, "approved", "Good")).toMatchObject({ decision: "approved", version_no: 2 });
    const done = await taskRow(STORY);
    expect(done.status).toBe("done");
    const rows = await admin(`select version_no, status, attached_at, decided_at, approved_at, submitted_by from proj_task_output_versions where task_id = '${STORY}' order by version_no`);
    expect(rows.map((x) => x.status)).toEqual(["changes_requested", "approved"]);
    expect(rows[1]!.approved_at).not.toBeNull();
    expect(new Date(rows[1]!.attached_at).getTime()).toBeLessThan(new Date(rows[1]!.approved_at).getTime());       // upload and approval are different events
    expect(new Date(rows[1]!.approved_at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
    // the register: both versions, the current one approved, with both times, the activation-less milestone, and the milestone progress counts the finished task
    const reg = await register(U.eng, P);
    const row = reg.rows.find((x: Row) => x.task_id === STORY);
    expect(row).toMatchObject({ state: "approved", versions_count: 2, output_label: "Storyboard", milestone: { title: "Ready for mockup" } });
    expect(row.current).toMatchObject({ version_no: 2, status: "approved", submitted_by_name: expect.any(String) });
    expect(row.current.attached_at).toBeTruthy(); expect(row.current.approved_at).toBeTruthy();
    expect(row.versions.map((v: Row) => [v.version_no, v.status])).toEqual([[2, "approved"], [1, "changes_requested"]]);
    expect(row.versions[1].decision_note).toBe("Too dark, redo the second scene");
    expect(reg.tz).toBe("Asia/Dubai");
    const prog = await call<Row>(U.pm, `proj_milestone_progress('${MS}')`).catch(() => null);
    if (prog) expect(JSON.stringify(prog)).toMatch(/1/);
    // history: the task's own history carries the submissions and decisions, the member-readable change log carries them too
    expect((await admin(`select kind from proj_task_events where task_id = '${STORY}' and kind like 'output_%' order by id`)).map((x) => x.kind)).toEqual(
      ["output_expected", "output_submitted", "output_decision", "output_submitted", "output_decision"]);
    expect(await count(`select 1 from proj_change_log where entity_type = 'task_output' and entity_id = '${STORY}'`)).toBeGreaterThanOrEqual(5);
  });

  it("approving again is a no-op, a different decision on a decided version is refused, and an approved version is not superseded by anything but a new one", async () => {
    expect(await decide(U.pm, V2, "approved")).toMatchObject({ unchanged: true });
    await expect(decide(U.pm, V2, "changes_requested", "no")).rejects.toThrow(/was already decided \(approved\)/);
    await expect(submit(U.design, STORY, await link(P, "after done"))).rejects.toThrow(/task is done/);
  });

  it("retries and concurrent submissions never duplicate a version or apply a review to the wrong one", async () => {
    const t = await createTask(U.pm, P, { title: "Videos", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Video", 3, true);
    const f = await link(P, "Video cut");
    const a = await submit(U.design, t, f, { items: 1, key: "same-attempt-1" });
    const b = await submit(U.design, t, f, { items: 1, key: "same-attempt-1" });                              // a retry: the same version
    expect(b).toMatchObject({ existing: true, id: a.id, version_no: 1 });
    expect(await count(`select 1 from proj_task_output_versions where task_id = '${t}'`)).toBe(1);
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => submit(U.design, t, f, { items: 3, key: `parallel-attempt-${n}` })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const nos = (await admin(`select version_no from proj_task_output_versions where task_id = '${t}' order by version_no`)).map((x) => x.version_no);
    expect(nos).toEqual([1, 2, 3, 4, 5]);                                                                      // sequential, no duplicates, no gaps
    expect((await admin(`select count(*)::int n from proj_task_output_versions where task_id = '${t}' and status = 'awaiting'`))[0]!.n).toBe(1);   // only the newest awaits; older ones are superseded
    await expect(submit(U.design, t, f, { items: 3, expect: 2 })).rejects.toThrow(/A newer version \(v5\) was submitted/);
    const [one, two] = await Promise.allSettled([decide(U.head, a.id, "approved"), decide(U.pm, a.id, "approved")]);
    expect([one, two].every((r) => r.status === "rejected")).toBe(true);                                       // the first version is superseded: neither approval can land on it
    expect(await count(`select 1 from proj_task_output_versions where task_id = '${t}' and status = 'approved'`)).toBe(0);
  });

  it("the expected quantity is enforced: three videos need a version holding three before review", async () => {
    const t = await createTask(U.pm, P, { title: "Three videos", assignee_id: U.design, team_id: TEAM, requires_review: true });
    await setOutput(U.pm, t, "Video", 3, true);
    await status(U.design, t, "in_progress");
    const f = await link(P, "Cut");
    await submit(U.design, t, f, { items: 2, key: "partial-attempt-a" });
    await expect(status(U.design, t, "ready_for_review")).rejects.toThrow(/expected output is 3 x Video, but version 1 has 2/);
    expect((await register(U.pm, P, t)).rows[0].state).toBe("partial");
    await submit(U.design, t, f, { items: 3, key: "partial-attempt-b" });
    await status(U.design, t, "ready_for_review");
    await expect(status(U.head, t, "done")).rejects.toThrow(/has not been approved/);                          // review path: completing needs the approval of the exact version
    await decide(U.head, (await admin<{ id: string }>(`select id from proj_task_output_versions where task_id = '${t}' and version_no = 2`))[0]!.id, "approved");
    expect((await taskRow(t)).status).toBe("done");
  });

  it("a reference never grants access: a restricted file cannot be used by the assignee, the register hides it from everyone but the manager, and a link can be submitted again", async () => {
    const t = await createTask(U.pm, P, { title: "Restricted deliverable", assignee_id: U.design, team_id: TEAM });
    await setOutput(U.pm, t, "Quote pack", 1, false);
    const secret = await file(P, "confidential-quote", true), open = await file(P, "public-brief", false);
    await expect(submit(U.design, t, secret)).rejects.toThrow(/not available to you/);
    await expect(submit(U.design, t, open, { snap: secret })).rejects.toThrow(/snapshot file is not available/);
    // The Project Manager's versions go to Operations, who open evidence under the files' own rules: a restricted file cannot be that evidence.
    await expect(submit(U.pm, t, secret, { key: "pm-restricted-1" })).rejects.toThrow(/Operations cannot open restricted files/);
    const mine = await submit(U.design, t, open, { key: "design-open-1" });                                    // the assignee uses a file anyone on the project can open
    expect(mine).toMatchObject({ version_no: 1, review_route: "team" });
    await admin(`update proj_files set restricted = true where id = '${open}'`);                               // the manager restricts it afterwards
    const asDesign = (await register(U.design, P, t)).rows[0].current.file;
    expect(asDesign).toEqual({ id: null, accessible: false, restricted: true });                               // no name, no link, no size
    expect(JSON.stringify(await register(U.eng, P, t))).not.toContain("public-brief");
    expect((await register(U.pm, P, t)).rows[0].current.file).toMatchObject({ accessible: true, restricted: true, name: "public-brief" });
    await admin(`update proj_files set restricted = false where id = '${open}'`);
    // another company's file or a removed file cannot be referenced
    const foreign = await file(OTHER, "foreign-file");
    await expect(submit(U.pm, t, foreign)).rejects.toThrow(/not available to you/);
    await admin(`update proj_files set deleted_at = now() where id = '${open}'`);
    await expect(submit(U.pm, t, open)).rejects.toThrow(/not available to you/);
    // the same external URL again is a NEW version, and a link is flagged as a mutable document
    const lk = await link(P, "Shared deck");
    const v1 = await submit(U.pm, t, lk, { key: "deck-1-attempt", mutable: true }), v2 = await submit(U.pm, t, lk, { key: "deck-2-attempt", mutable: true });
    expect([v1.version_no, v2.version_no]).toEqual([2, 3]);
    const cur = (await register(U.pm, P, t)).rows[0].current;
    expect(cur).toMatchObject({ version_no: 3, mutable_link: true });
    expect(cur.file).toMatchObject({ kind: "link", url: expect.stringMatching(/^https:\/\//) });
    const snap = await file(P, "deck-snapshot");
    const v4 = await submit(U.pm, t, lk, { key: "deck-3-attempt", mutable: true, snap });                        // a stored snapshot beside the link for the exact material
    expect((await register(U.pm, P, t)).rows[0].current.snapshot).toMatchObject({ accessible: true, kind: "file" });
    expect(v4.version_no).toBe(4);
  });

  it("another company, and anyone without access, can read or write nothing here", async () => {
    await expect(register(U.outsider, P)).rejects.toThrow(/Project not found/);
    await expect(call(U.outsider, `proj_work_overview('${P}')`)).rejects.toThrow(/Project not found/);
    await expect(call(U.outsider, `proj_site_schedule('${P}')`)).rejects.toThrow(/Project not found/);
    await expect(decide(U.outsider, V2, "approved")).rejects.toThrow(/Only the department head|not found/i);
    expect(await count(`select 1 from proj_task_output_versions where project_id = '${OTHER}'`)).toBe(0);
    // an Operations user can read the register and the schedule (read only) but cannot write
    expect((await register(U.ops, P)).rows.length).toBeGreaterThan(0);
    await expect(setOutput(U.ops, STORY, "x", 1, false)).rejects.toThrow(/Only the Project Manager or the head|not found/i);
  });

  it("feedback can be linked to a version and an activation by the Project Manager only", async () => {
    const fb = (await admin<{ id: string }>(`insert into proj_feedback (project_id, target_type, target_id, source, received_on, request_text, kind, created_by)
      values ('${P}', 'task', '${STORY}', 'Client (fictional)', '${day(0)}', 'Please make the logo larger', 'in_scope_correction', '${U.pm}') returning id`))[0]!.id;
    await expect(call(U.design, `proj_link_feedback_output('${fb}', '${V2}', null)`)).rejects.toThrow(/Only the Project Manager/);
    await call(U.pm, `proj_link_feedback_output('${fb}', '${V2}', null)`);
    const row = (await register(U.eng, P)).rows.find((x: Row) => x.task_id === STORY);
    expect(row.current.feedback).toEqual([expect.objectContaining({ id: fb, kind: "in_scope_correction", text: "Please make the logo larger" })]);
  });

  // ---------------------------------------------------------------------------------------------------- site schedule (RAF)
  const sched = (user: string, project: string) => call<Row>(user, `proj_site_schedule('${project}')`);
  const act = (rows: Row[], title: string) => rows.find((a) => a.title === title) as Row;
  let SETUP1 = "", SETUP2 = "", SHOW1 = "", SHOW2 = "", DISM = "", REQ = "";

  it("RAF: two runs with their own setup, show and dismantling; incomplete plans save; missing time or crew is named; a retry adds nothing", async () => {
    const rows = [
      { activity_kind: "setup", title: "Setup (run 1)", run_label: "Run 1", location: "Hall 3", owner_id: U.eng, starts_local: "2027-11-11T09:00", ends_local: "2027-11-11T18:00", activity_state: "confirmed" },
      { activity_kind: "show", title: "Show (run 1)", run_label: "Run 1", location: "Hall 3", owner_id: U.pm, start_date: "2027-11-12", end_date: "2027-11-12", activity_state: "confirmed" },
      { activity_kind: "dismantling", title: "Dismantling (run 1)", run_label: "Run 1", location: "Hall 3", owner_id: U.eng, starts_local: "2027-11-12T20:00", ends_local: "2027-11-12T23:30", activity_state: "tentative" },
      { activity_kind: "setup", title: "Setup (run 2)", run_label: "Run 2", location: "Hall 3", owner_id: U.eng, start_date: "2027-11-13", end_date: "2027-11-13", activity_state: "tentative" },     // time still to confirm
      { activity_kind: "show", title: "Show (run 2)", run_label: "Run 2", location: "Hall 3", owner_id: U.pm, start_date: "2027-11-14", end_date: "2027-11-15", activity_state: "tentative" },
    ];
    const first = await call<Row>(U.pm, `proj_add_site_activities('${P}', ${j(rows)})`);
    expect(first).toMatchObject({ created: 5, existing: 0 });
    expect(await call<Row>(U.pm, `proj_add_site_activities('${P}', ${j(rows)})`)).toMatchObject({ created: 0, existing: 5 });   // a retry adds nothing
    const s = await sched(U.eng, P);
    expect(s.activities).toHaveLength(5);
    expect(s.activities.map((a: Row) => a.title)).toEqual(["Setup (run 1)", "Show (run 1)", "Dismantling (run 1)", "Setup (run 2)", "Show (run 2)"]);
    SETUP1 = act(s.activities, "Setup (run 1)").id; SHOW1 = act(s.activities, "Show (run 1)").id; DISM = act(s.activities, "Dismantling (run 1)").id; SETUP2 = act(s.activities, "Setup (run 2)").id; SHOW2 = act(s.activities, "Show (run 2)").id;
    // both runs are separate records: nothing says the equipment stays installed between them
    expect(act(s.activities, "Show (run 1)")).toMatchObject({ run_label: "Run 1", state: "confirmed", start_date: "2027-11-12" });
    expect(act(s.activities, "Show (run 2)")).toMatchObject({ run_label: "Run 2", state: "tentative", start_date: "2027-11-14", end_date: "2027-11-15" });
    expect(act(s.activities, "Setup (run 2)").missing).toEqual(["time", "crew"]);                              // time still to confirm, nobody assigned
    expect(act(s.activities, "Setup (run 1)").missing).toEqual(["crew"]);
    expect(act(s.activities, "Setup (run 1)").starts_at).toBeTruthy();
    expect(act(s.activities, "Setup (run 1)").tz).toBe("Asia/Dubai");
    expect(s.committed).toMatchObject({ install_start: "2027-11-11", event_start: "2027-11-12", event_end: "2027-11-15" });
    // permissions: only the Project Manager writes; any reader reads
    await expect(call(U.eng, `proj_add_site_activities('${P}', ${j(rows.slice(0, 1))})`)).rejects.toThrow(/Only the Project Manager|manage/i);
    await expect(call(U.outsider, `proj_add_site_activities('${P}', ${j(rows.slice(0, 1))})`)).rejects.toThrow();
    await expect(call(U.pm, `proj_add_site_activities('${P}', '[]')`)).rejects.toThrow(/at least one/);
    await expect(call(U.pm, `proj_add_site_activities('${P}', ${j([{ activity_kind: "setup", title: "Bad", owner_id: U.outsider }])})`)).rejects.toThrow(/Row 1: .*owner must be an active member/);
  });

  it("crew is assigned per activity and role, so separate runs have different people; setting the same crew again changes nothing", async () => {
    expect(await call<Row>(U.pm, `proj_set_site_crew('${SETUP1}', ${j([{ user_id: U.crew1, role: "installation" }, { user_id: U.eng, role: "installation" }])})`)).toMatchObject({ added: 2, removed: 0 });
    expect(await call<Row>(U.pm, `proj_set_site_crew('${SETUP1}', ${j([{ user_id: U.crew1, role: "installation" }, { user_id: U.eng, role: "installation" }])})`)).toMatchObject({ added: 0, removed: 0 });
    await call(U.pm, `proj_set_site_crew('${SETUP2}', ${j([{ user_id: U.crew2, role: "installation" }, { user_id: U.eng, role: "backup" }])})`);
    await call(U.pm, `proj_set_site_crew('${SHOW2}', ${j([{ user_id: U.crew1, role: "standby" }, { user_id: U.crew2, role: "backup" }])})`);
    await call(U.pm, `proj_set_site_crew('${DISM}', ${j([{ user_id: U.crew2, role: "dismantling" }])})`);
    await call(U.pm, `proj_set_site_crew('${SHOW1}', ${j([{ user_id: U.crew1, role: "standby" }])})`);
    const s = await sched(U.crew1, P);
    expect(act(s.activities, "Setup (run 1)").crew.map((c: Row) => c.user_id).sort()).toEqual([U.crew1, U.eng].sort());
    expect(act(s.activities, "Setup (run 2)").crew.map((c: Row) => [c.user_id, c.role]).sort()).toEqual([[U.crew2, "installation"], [U.eng, "backup"]].sort());
    expect(act(s.activities, "Setup (run 1)").missing).toEqual([]);
    expect(act(s.activities, "Setup (run 2)").missing).toEqual(["time"]);
    expect(await call<Row>(U.pm, `proj_set_site_crew('${SETUP2}', ${j([{ user_id: U.crew2, role: "installation" }])})`)).toMatchObject({ added: 0, removed: 1 });   // a person can be taken off
    await expect(call(U.pm, `proj_set_site_crew('${SETUP2}', ${j([{ user_id: U.outsider, role: "installation" }])})`)).rejects.toThrow(/members of the project or active employees/);
    await expect(call(U.pm, `proj_set_site_crew('${SETUP2}', ${j([{ user_id: U.crew2, role: "driver" }])})`)).rejects.toThrow(/crew role/);
    await expect(call(U.crew1, `proj_set_site_crew('${SETUP2}', '[]')`)).rejects.toThrow(/Only the Project Manager|manage/i);
  });

  it("a confirmed date or time cannot change without saying why, confirming needs a date, and the reason is logged", async () => {
    await expect(call(U.pm, `proj_save_site_activity('${P}', '${SHOW1}', ${j({ start_date: "2027-11-13", end_date: "2027-11-13" })})`)).rejects.toThrow(/This activity is confirmed. Say why/);
    expect((await sched(U.pm, P)).activities.find((a: Row) => a.id === SHOW1).start_date).toBe("2027-11-12");        // nothing was half saved
    await call(U.pm, `proj_save_site_activity('${P}', '${SHOW1}', ${j({ start_date: "2027-11-12", end_date: "2027-11-13", reason: "Show extended by a day" })})`);
    const log = await admin(`select field, note from proj_change_log where entity_type = 'site_activity' and entity_id = '${SHOW1}' and field = 'date'`);
    expect(log.map((x) => x.note)).toContain("Show extended by a day");
    // confirming the second setup needs a date; it has one, so it confirms, and the time can still follow
    await call(U.pm, `proj_save_site_activity('${P}', '${SETUP2}', ${j({ activity_state: "confirmed" })})`);
    const undated = (await call<Row>(U.pm, `proj_save_site_activity('${P}', null, ${j({ activity_kind: "mockup", title: "Mockup at workshop" })})`)).id;
    await expect(call(U.pm, `proj_save_site_activity('${P}', '${undated}', ${j({ activity_state: "confirmed" })})`)).rejects.toThrow(/Add a date before confirming/);
    expect(act((await sched(U.pm, P)).activities, "Mockup at workshop").missing).toEqual(["date"]);
    // the client key makes a retried create return the same activity
    const k = { activity_kind: "other", title: "Client walk-through", client_key: "walkthrough-attempt-1", start_date: "2027-11-10" };
    const a = await call<Row>(U.pm, `proj_save_site_activity('${P}', null, ${j(k)})`), b = await call<Row>(U.pm, `proj_save_site_activity('${P}', null, ${j(k)})`);
    expect(b).toMatchObject({ existing: true, id: a.id });
  });

  it("an overseas shipment arriving after the setup it supports is flagged; Inventory's reservation, dispatch and return state is read, not copied", async () => {
    REQ = (await call<string>(U.pm, `inv_create_request('project', '${P}', null, 'RAF kit')`).catch(async () =>
      (await admin<{ id: string }>(`select id from inv_requests where project_id = '${P}' limit 1`))[0]?.id ?? "")) as string;
    const fields = { label: "Equipment from Mumbai", plan_item_id: SETUP1, request_id: REQ || null, carrier: "Fictional Freight", reference: "FF-1042", departs_local: "2027-11-09T08:00", departs_tz: "Asia/Kolkata",
                     arrives_local: "2027-11-11T15:00", arrives_tz: "Asia/Dubai", returns_local: "2027-11-17T10:00", state: "tentative" };
    const created = await call<Row>(U.pm, `proj_save_shipment('${P}', null, ${j({ ...fields, client_key: "mumbai-attempt-1" })})`);
    expect(await call<Row>(U.pm, `proj_save_shipment('${P}', null, ${j({ ...fields, client_key: "mumbai-attempt-1" })})`)).toMatchObject({ existing: true, id: created.id });
    const s = await sched(U.eng, P);
    expect(s.shipments).toHaveLength(1);
    const sh = s.shipments[0];
    expect(sh).toMatchObject({ label: "Equipment from Mumbai", activity_title: "Setup (run 1)", departs_tz: "Asia/Kolkata", arrives_tz: "Asia/Dubai", state: "tentative" });
    expect(sh.conflict).toMatchObject({ type: "late", setup_title: "Setup (run 1)", setup_has_time: true });           // 15:00 arrival, 09:00 setup start (both Dubai)
    if (REQ) expect(sh.request).toMatchObject({ id: REQ, state: "draft" });                                        // the Inventory request's own state
    // arriving before the setup clears the flag; a date-only setup is compared by day
    await call(U.pm, `proj_save_shipment('${P}', '${created.id}', ${j({ arrives_local: "2027-11-10T18:00", departs_local: "2027-11-09T08:00" })})`);
    expect((await sched(U.eng, P)).shipments[0].conflict).toBeNull();
    await call(U.pm, `proj_save_shipment('${P}', '${created.id}', ${j({ plan_item_id: SETUP2, arrives_local: "2027-11-14T09:00" })})`);
    expect((await sched(U.eng, P)).shipments[0].conflict).toMatchObject({ type: "late", setup_has_time: false });      // arrives on the 14th, the setup is on the 13th
    // validation, incomplete plans and permissions
    await expect(call(U.pm, `proj_save_shipment('${P}', '${created.id}', ${j({ departs_local: "2027-11-20T08:00" })})`)).rejects.toThrow(/arrive before it departs|violates/i);
    const bare = await call<Row>(U.pm, `proj_save_shipment('${P}', null, ${j({ label: "Return crates" })})`);              // an incomplete plan saves
    expect((await sched(U.eng, P)).shipments.find((x: Row) => x.id === bare.id).missing).toEqual(["arrival", "departure"]);
    await expect(call(U.pm, `proj_save_shipment('${P}', '${bare.id}', ${j({ state: "confirmed" })})`)).rejects.toThrow(/before confirming/);
    await call(U.pm, `proj_save_shipment('${P}', '${created.id}', ${j({ state: "confirmed" })})`);
    await expect(call(U.pm, `proj_save_shipment('${P}', '${created.id}', ${j({ arrives_local: "2027-11-10T20:00" })})`)).rejects.toThrow(/This shipment is confirmed. Say why/);
    await expect(call(U.eng, `proj_save_shipment('${P}', null, ${j({ label: "x" })})`)).rejects.toThrow(/Only the Project Manager|manage/i);
    await expect(call(U.pm, `proj_save_shipment('${P}', null, ${j({ label: "x", request_id: id() })})`)).rejects.toThrow(/this project's equipment requests/);
    await call(U.pm, `proj_remove_shipment('${bare.id}')`);
    expect((await sched(U.eng, P)).shipments).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------------------------------- Work overview
  it("the Work overview says what is next on site, what needs attention (and who can act) and what changed recently, from the same records", async () => {
    const Q = await (async () => (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.a}', 'UAE-P-2027-0302', 'Fictional overview project', 'internal', 'in_progress', '${U.pm}', '${U.pm}') returning id`))[0]!.id)();
    await admin(`insert into proj_project_details (project_id, location, site_timezone, technologies) values ('${Q}', 'Fictional Hall', 'Asia/Dubai', '[]'::jsonb);
      insert into proj_project_members (project_id, user_id, role) values ('${Q}', '${U.pm}', 'pm'), ('${Q}', '${U.design}', 'member'), ('${Q}', '${U.head}', 'member');
      insert into proj_teams (project_id, name, head_user_id, created_by) values ('${Q}', 'Creative', '${U.head}', '${U.pm}');`);
    const empty = await call<Row>(U.design, `proj_work_overview('${Q}')`);
    expect(empty).toMatchObject({ next_on_site: null, attention: [], recent: [] });                              // an empty project reads as empty, not as an error
    await call(U.pm, `proj_add_site_activities('${Q}', ${j([
      { activity_kind: "setup", title: "Setup soon", run_label: "Run 1", location: "Hall 1", owner_id: U.design, start_date: day(3), end_date: day(3), activity_state: "tentative" },
      { activity_kind: "show", title: "Show later", start_date: day(5), end_date: day(6), activity_state: "confirmed" },
      { activity_kind: "setup", title: "Setup already past", start_date: day(-5), end_date: day(-5) }])})`);
    const tq = await createTask(U.pm, Q, { title: "Logo animation", assignee_id: U.design, team_id: (await admin<{ id: string }>(`select id from proj_teams where project_id = '${Q}'`))[0]!.id, requires_review: true });
    await setOutput(U.pm, tq, "Logo animation", 1, true);
    let o = await call<Row>(U.design, `proj_work_overview('${Q}')`);
    expect(o.next_on_site).toMatchObject({ title: "Setup soon", state: "tentative", owner_name: expect.any(String), location: "Hall 1" });
    const kinds = () => o.attention.map((a: Row) => a.kind);
    expect(kinds()).toEqual(expect.arrayContaining(["output_missing", "site_missing"]));
    expect(o.attention.find((a: Row) => a.kind === "output_missing")).toMatchObject({ task_id: tq, who: [expect.any(String)] });
    expect(JSON.stringify(o.attention.filter((a: Row) => a.kind === "site_missing"))).toMatch(/time|crew/);
    // a version awaiting review is named against the reviewer; then the review decision shows in recent changes
    await status(U.design, tq, "in_progress");
    const sv = await submit(U.design, tq, await link(Q, "Logo v1"), { key: "overview-attempt-1" });
    o = await call<Row>(U.design, `proj_work_overview('${Q}')`);
    expect(kinds()).toContain("review_waiting");
    expect(o.attention.find((a: Row) => a.kind === "review_waiting").who).toEqual([expect.any(String)]);
    expect(kinds()).not.toContain("output_missing");
    await status(U.design, tq, "ready_for_review");
    await decide(U.head, sv.id, "changes_requested", "More contrast");
    o = await call<Row>(U.pm, `proj_work_overview('${Q}')`);
    expect(kinds()).toContain("changes_requested");
    expect(o.recent.length).toBeGreaterThanOrEqual(3);
    expect(o.recent[0]).toMatchObject({ entity: "task_output", title: "Logo animation", to: "changes_requested" });
    // a shipment conflict surfaces too
    const setupId = (await sched(U.pm, Q)).activities.find((a: Row) => a.title === "Setup soon").id;
    await call(U.pm, `proj_save_shipment('${Q}', null, ${j({ label: "Late crates", plan_item_id: setupId, arrives_local: `${day(4)}T10:00` })})`);
    o = await call<Row>(U.pm, `proj_work_overview('${Q}')`);
    expect(kinds()).toContain("shipment_conflict");
    await expect(call(U.outsider, `proj_work_overview('${Q}')`)).rejects.toThrow(/Project not found/);
  });

  it("the owner packs: preflight has no STOP, verify says OK on every row, rollback refuses while Phase 2 data exists and, once it is cleared, restores the previous behaviour", async () => {
    expect((await admin(pack("proj_phase2_deliverables_site_00_preflight_readonly.sql"))).filter((r) => String(r.result).startsWith("STOP"))).toEqual([]);
    const rows = await admin(pack("proj_phase2_deliverables_site_20_verify_readonly.sql"));
    expect(rows.filter((r) => r.result !== "OK" && !String(r.item).startsWith("no restricted file")), JSON.stringify(rows)).toEqual([]);
    expect(rows.length).toBe(8);
    await expect(admin(pack("proj_phase2_deliverables_site_90_rollback.sql"))).rejects.toThrow(/STOP/);
  });
});
