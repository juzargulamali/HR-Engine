import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects Phase 2, part 2: the Project Closeout Report (migration 20270101000100_proj_closeout_reports.sql). Proves, against a real Postgres, on ONE exhibition project with
// delegated Engineering, Content and Programming sections, an approved change, a client comment and a partial equipment return:
//   * only whoever manages the project reads the evidence or a report, or drafts, edits or approves one; a member and an outsider get nothing, on any project;
//   * the evidence holds the decision, the feedback, the delivery and the handover facts, and NONE of the commercial or private values planted next to them;
//   * a missing client sign-off is a null completion (the report says "not recorded"), and equipment still out is visible even once the project is completed;
//   * the caller cannot supply evidence: a draft is saved only when the snapshot it was written from equals the one taken at save time;
//   * one draft per project (a retry updates it), an approved version is frozen and keeps its snapshot when the project changes later, the next draft is version 2;
//   * drafting and approving change nothing else: project status, completion, tasks, stock, notifications and chat are untouched.

const id = () => randomUUID();
const CO = { a: id() };
const U = { pm: id(), eng: id(), content: id(), prog: id(), outsider: id(), founder: id(), client: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@closeout-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const HASH = "p1-0123456789abcdef";
const SECTIONS = [{ id: "summary", title: "Executive summary", paragraphs: [{ text: "Delivered.", refs: ["S1"], flags: [] }] }];
const REFS = [{ ref: "S1", category: "project", label: "Project", source_type: "project", source_id: null }];

describe("Project Closeout Report", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const evidence = (user: string, project = P1) => call<Row>(user, `proj_closeout_evidence('${project}')`);
  const saveDraft = async (user: string, snapshot: Row | null, opts: { project?: string; generation?: string; sections?: unknown; hash?: string } = {}) =>
    call<Row>(user, `proj_closeout_save_draft('${opts.project ?? P1}', ${snapshot ? j(snapshot) : "null"}, ${j({ include: ["scope-original"] })}, '${opts.hash ?? HASH}', '${opts.generation ?? "generated"}', 'simulated', ${j(opts.sections ?? SECTIONS)}, ${j(REFS)})`);
  const fingerprint = async () => JSON.stringify(await admin(`select
      (select md5(string_agg(row(p.id, p.status, p.updated_at)::text, ',' order by p.id)) from proj_projects p) projects,
      (select count(*) from proj_completions) completions, (select md5(coalesce(string_agg(row(t.id, t.status, t.version)::text, ',' order by t.id), '')) from proj_tasks t) tasks,
      (select count(*) from notifications) notifications, (select count(*) from chat_messages) chat,
      (select md5(coalesce(string_agg(row(r.id, r.status)::text, ',' order by r.id), '')) from inv_requests r) requests,
      (select md5(coalesce(string_agg(row(x.id, x.qty, x.dispatched_qty, x.returned_qty, x.status)::text, ',' order by x.id), '')) from inv_reservations x) reservations,
      (select count(*) from inv_movements) movements`));
  let P1 = "", P2 = "", LED = "", LOC = "", wall = "", reqLine = "", fb = "", sc = "", draft = "";

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
        ('${U.pm}', '${CO.a}', '{}'), ('${U.eng}', '${CO.a}', '{}'), ('${U.content}', '${CO.a}', '{}'), ('${U.prog}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.a}', '{}'), ('${U.founder}', '${CO.a}', '{founder}');
      insert into inv_items (company_id, name, tracking, status) values ('${CO.a}', 'LED panel P2.6', 'quantity', 'active');
      insert into inv_locations (company_id, code, name, timezone) values ('${CO.a}', 'DXB', 'Dubai warehouse', 'Asia/Dubai');
    `);
    LED = (await admin<{ id: string }>(`select id from inv_items where name = 'LED panel P2.6'`))[0]!.id;
    LOC = (await admin<{ id: string }>(`select id from inv_locations where code = 'DXB'`))[0]!.id;
    P1 = id();
    // A client project points at its Sales opportunity. This test is about the report, not Sales, so the row is inserted without one existing.
    await db.seed(`set session_replication_role = replica;
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by, start_date, end_date, crm_opportunity_id)
        values ('${P1}', '${CO.a}', 'UAE-P-2027-0001', 'Fictional Expo stand', 'client', 'in_progress', '${U.pm}', '${U.pm}', '2027-02-01', '2027-03-10', gen_random_uuid());
      set session_replication_role = origin;`);
    P2 = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.a}', 'UAE-P-2027-0002', 'Fictional other job', 'internal', 'in_progress', '${U.outsider}', '${U.outsider}') returning id`))[0]!.id;
    await db.seed(`
      insert into proj_project_details (project_id, client_name, location, site_timezone, scope, exclusions, install_start, event_start, event_end)
        values ('${P1}', 'Fictional Motors', 'Expo Hall 4', 'Asia/Dubai', 'LED welcome wall 6 x 4 m plus a second kiosk', 'Rigging by venue', '2027-02-26', '2027-03-01', '2027-03-05'), ('${P2}', null, 'Hall 9', 'Asia/Dubai', 'Other', null, null, null, null);
      insert into proj_project_members (project_id, user_id, role) values ('${P1}', '${U.pm}', 'pm'), ('${P1}', '${U.eng}', 'member'), ('${P1}', '${U.content}', 'member'), ('${P1}', '${U.prog}', 'member'), ('${P2}', '${U.outsider}', 'pm');
      -- The accepted Sales handover (the original agreement). Inserted directly: this test is about the report, not the handover flow.
      set session_replication_role = replica;
      insert into proj_handovers (company_id, crm_opportunity_id, crm_reference, status, prepared_by, sales_owner_id, title, client_name, location, install_start, event_start, event_end, technologies, scope, exclusions, notes, pm_user_id, accepted_by, accepted_at, project_id)
        values ('${CO.a}', gen_random_uuid(), 'UAE-O-2027-0007', 'accepted', '${U.pm}', '${U.pm}', 'Expo stand for Fictional Motors', 'Fictional Motors', 'Expo Hall 4', '2027-02-26', '2027-03-01', '2027-03-05',
                '[{"name": "LED wall", "qty": 1, "unit_price": 99999}]', 'LED welcome wall 6 x 4 m', 'Rigging by venue', 'Edition 2027. HANDOVER-NOTE-TEXT', '${U.pm}', '${U.pm}', '2027-01-20 09:00+00', '${P1}');
      set session_replication_role = origin;
      insert into proj_milestones (project_id, title, status, due_date, accepted_by, accepted_at, sort_order) values
        ('${P1}', 'Design approved', 'accepted', '2027-02-10', '${U.pm}', '2027-02-09 10:00+00', 1), ('${P1}', 'Client walkthrough', 'planned', '2027-03-01', null, null, 2);
    `);
    // The delivery plan: one deliverable, three delegated sections, released (tasks + a draft equipment line).
    await call(U.pm, `proj_dp_delegate('${P1}', 'hardware', '${U.eng}')`);
    await call(U.pm, `proj_dp_delegate('${P1}', 'content', '${U.content}')`);
    await call(U.pm, `proj_dp_delegate('${P1}', 'programming', '${U.prog}')`);
    wall = (await call<Row>(U.pm, `proj_dp_save_item('${P1}', null, ${j({ zone: "Entrance", title: "Interactive LED welcome wall", owner_id: U.eng, needed_by: "2027-03-01" })})`)).id;
    await call(U.eng, `proj_dp_save_line('${wall}', null, ${j({ section: "hardware", description: "LED panels", qty: 4, inv_item_id: LED })})`);
    await call(U.content, `proj_dp_save_line('${wall}', null, ${j({ section: "content", description: "Welcome loop video", assignee_id: U.content })})`);
    await call(U.prog, `proj_dp_save_line('${wall}', null, ${j({ section: "programming", description: "Touch interaction", assignee_id: U.prog })})`);
    await call(U.pm, `proj_dp_release('${P1}')`);
    reqLine = (await admin<{ id: string }>(`select request_line_id id from proj_dp_lines where item_id = '${wall}' and section = 'hardware'`))[0]!.id;
    // Warehouse state: 4 sent, 1 returned (a partial return). Content task done, programming task still open.
    await db.seed(`
      update inv_requests set status = 'in_progress', needed_from = '2027-02-25 08:00+00', needed_until = '2027-03-08 08:00+00', expected_return_at = '2027-03-08 08:00+00' where project_id = '${P1}';
      insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, dispatched_qty, returned_qty, reserved_during, made_by)
        values ('${CO.a}', '${reqLine}', '${LED}', '${LOC}', 4, 4, 1, tstzrange('2027-02-25 08:00+00', '2027-03-08 08:00+00'), '${U.pm}');
      update proj_tasks set status = 'done', completed_at = '2027-02-27 15:00+00' where id = (select task_id from proj_dp_lines where item_id = '${wall}' and section = 'content');
    `);
    // An approved change with its reason, and a client comment with our response. Values a report must never carry are planted next to them.
    sc = (await admin<{ id: string }>(`insert into proj_scope_changes (project_id, title, original_scope, base_scope_hash, proposed_scope, effect_on_dates, status, proposed_by, decided_by, decided_at, decision_note)
      values ('${P1}', 'Add a second kiosk', 'LED welcome wall 6 x 4 m', 'x', 'LED welcome wall 6 x 4 m plus a second kiosk', 'One extra install day', 'approved', '${U.eng}', '${U.pm}', '2027-02-12 11:00+00', 'Agreed with the client on the 12 Feb call') returning id`))[0]!.id;
    fb = (await admin<{ id: string }>(`insert into proj_feedback (project_id, target_type, source, received_on, request_text, kind, responsible_user_id, status, resolution, evidence_note, resolved_at, resolved_by, created_by)
      values ('${P1}', 'project', 'SOURCE-CONTACT Jane Client, +971 50 000 0000', '2027-03-02', 'Please make the welcome loop brighter', 'in_scope_correction', '${U.content}', 'resolved', 'Brightness raised and confirmed on site', 'EVIDENCE-NOTE-SECRET', '2027-03-02 16:00+00', '${U.content}', '${U.pm}') returning id`))[0]!.id;
    await db.seed(`insert into proj_messages (project_id, author_id, body) values ('${P1}', '${U.pm}', 'PRIVATE-CHAT-SECRET margin is 40 percent')`).catch(() => undefined);
  });
  afterAll(async () => db.teardown());

  it("only whoever manages the project reads the evidence; a member, an outsider and someone signed out get nothing, on any project", async () => {
    const e = await evidence(U.pm);
    expect(e.project).toMatchObject({ reference: "UAE-P-2027-0001", client: "Fictional Motors", venue: "Expo Hall 4", project_manager: "pm", event_start: "2027-03-01" });
    expect((await evidence(U.founder)).project.reference).toBe("UAE-P-2027-0001");
    for (const who of [U.eng, U.content, U.outsider]) await expect(evidence(who)).rejects.toThrow(/Project not found/);
    await expect(evidence(U.pm, P2)).rejects.toThrow(/Project not found/);
    await expect(q(null, `select proj_closeout_evidence('${P1}')`)).rejects.toThrow();
  });

  it("the evidence traces the decision, the feedback, the delivery and the handover to their records", async () => {
    const e = await evidence(U.pm);
    expect(e.handover).toMatchObject({ sales_reference: "UAE-O-2027-0007", accepted_by: "pm", technologies: [{ name: "LED wall", qty: 1 }] });
    expect(e.scope).toMatchObject({ original_text: "LED welcome wall 6 x 4 m", current_text: "LED welcome wall 6 x 4 m plus a second kiosk", changed: true, approved_changes: 1 });
    expect(e.decisions).toEqual([expect.objectContaining({ id: sc, kind: "scope_change", title: "Add a second kiosk", status: "approved", proposed_by: "eng", decided_by: "pm", reason: "Agreed with the client on the 12 Feb call", effect_on_dates: "One extra install day" })]);
    expect(e.feedback).toEqual([expect.objectContaining({ id: fb, status: "resolved", resolved_by: "content", request_text: "Please make the welcome loop brighter", response_text: "Brightness raised and confirmed on site" })]);
    expect(e.team.map((m: Row) => [m.name, m.role])).toEqual([["pm", "Project Manager"], ["content", "Member"], ["eng", "Member"], ["prog", "Member"]]);
    expect(e.team.find((m: Row) => m.name === "eng")).toMatchObject({ deliverables_owned: ["D001 Interactive LED welcome wall"] });
    expect(e.team.find((m: Row) => m.name === "content")).toMatchObject({ tasks_done: 1, tasks_assigned: 1 });
    expect(e.team.find((m: Row) => m.name === "pm")).toMatchObject({ milestones_accepted: 1 });
    expect(e.milestones.map((m: Row) => [m.title, m.status])).toEqual([["Design approved", "accepted"], ["Client walkthrough", "planned"]]);
    const lines = e.plan[0].lines as Row[];
    expect(lines.map((l) => [l.section, l.released])).toEqual([["hardware", true], ["content", true], ["programming", true]]);
    expect(lines[1]!.task).toMatchObject({ status: "done", assignee: "content" });
    expect(lines[2]!.task.status).not.toBe("done");
    expect(e.tasks).toMatchObject({ total: 2, done: 1, open: 1 });
    expect(e.tasks.not_finished).toHaveLength(1);
  });

  it("carries none of the commercial or private values: no prices, costs, contacts, chat, comments, files or emails", async () => {
    const text = JSON.stringify(await evidence(U.pm));
    for (const banned of ["99999", "unit_price", "SOURCE-CONTACT", "+971", "EVIDENCE-NOTE-SECRET", "PRIVATE-CHAT-SECRET", "@closeout-test.ae", "client_contact", "amount", "cost", "budget", "margin", "salary", "email", "phone"]) expect(text).not.toContain(banned);
    // Every top-level block is one this test knows about: a new block must be reviewed before it can be sent anywhere.
    expect(Object.keys(await evidence(U.pm)).sort()).toEqual(["completion", "decisions", "equipment", "feedback", "handover", "milestones", "missing", "plan", "project", "reopened_earlier", "scope", "tasks", "team", "taken_at"].sort());
  });

  it("a missing client sign-off is a null completion, and equipment that is still out is visible", async () => {
    const e = await evidence(U.pm);
    expect(e.completion).toBeNull();
    expect(e.missing).toEqual([]);
    expect(e.equipment.requests).toHaveLength(1);
    expect(e.equipment.requests[0].lines).toEqual([expect.objectContaining({ id: reqLine, item: "LED panel P2.6", qty: 4, sent: 4, returned: 1 })]);
    expect(e.equipment.requests[0].expected_return_at).toBeTruthy();
  });

  it("drafting: managers only; the snapshot must be the one taken on the server; a retry updates the one draft", async () => {
    const before = await fingerprint();
    const snap = await evidence(U.pm);
    for (const who of [U.eng, U.outsider]) await expect(saveDraft(who, snap)).rejects.toThrow(/Only the Project Manager/);
    await expect(saveDraft(U.pm, snap, { project: P2 })).rejects.toThrow(/Only the Project Manager/);
    await expect(saveDraft(U.pm, null)).rejects.toThrow(/records changed/);
    await expect(saveDraft(U.pm, { ...snap, completion: { id: id(), completed_at: "2027-03-06", completed_by: "pm", evidence_type: "signed_handover" } })).rejects.toThrow(/records changed/);   // forged sign-off
    await expect(saveDraft(U.pm, { ...snap, project: { ...snap.project, client: "Someone else" } })).rejects.toThrow(/records changed/);
    expect(Number((await admin(`select count(*) n from proj_closeout_reports`))[0]!.n)).toBe(0);
    const a = await saveDraft(U.pm, snap);
    expect(a).toMatchObject({ version_no: 1, version: 1 });
    draft = a.id;
    const b = await saveDraft(U.pm, await evidence(U.pm), { hash: "p2-fedcba9876543210" });        // a retry or a regenerate
    expect(b).toMatchObject({ id: draft, version_no: 1, version: 2 });
    expect(Number((await admin(`select count(*) n from proj_closeout_reports`))[0]!.n)).toBe(1);
    await expect(saveDraft(U.pm, await evidence(U.pm), { generation: "failed" })).rejects.toThrow(/Unknown generation/);
    const [row] = await admin<Row>(`select * from proj_closeout_reports where id = '${draft}'`);
    expect(row).toMatchObject({ status: "draft", payload_hash: "p2-fedcba9876543210", generation: "generated", provider_kind: "simulated", created_by: U.pm });
    expect(row!.snapshot.scope.approved_changes).toBe(1);
    expect(await fingerprint()).toBe(before);
  });

  it("reading a report: managers only; nobody writes to the table directly", async () => {
    expect(await q(U.pm, `select id from proj_closeout_reports`)).toHaveLength(1);
    expect(await q(U.founder, `select id from proj_closeout_reports`)).toHaveLength(1);
    for (const who of [U.eng, U.content, U.outsider]) expect(await q(who, `select id from proj_closeout_reports`)).toHaveLength(0);
    for (const who of [U.eng, U.outsider]) {
      await db.asUserCommit(who, async (query) => { await query(`update proj_closeout_reports set status = 'approved', approved_at = now() where id = '${draft}'`).catch(() => undefined); }).catch(() => undefined);
      await db.asUserCommit(who, async (query) => { await query(`delete from proj_closeout_reports where id = '${draft}'`).catch(() => undefined); }).catch(() => undefined);
    }
    expect((await admin<Row>(`select status from proj_closeout_reports where id = '${draft}'`))[0]!.status).toBe("draft");
    // The table privileges themselves (SELECT only for signed-in users) are asserted for every proj_ table in projects.rls.test.ts and by the verify pack on hosted.
  });

  it("editing and approving: managers only, a stale copy is refused, an empty report cannot be approved, approval is a repeatable step that freezes the version", async () => {
    const before = await fingerprint();
    const edited = [{ ...SECTIONS[0], paragraphs: [{ text: "Delivered, with one item open.", refs: ["S1"], flags: [] }] }];
    await expect(call(U.eng, `proj_closeout_save_edits('${draft}', ${j(edited)}, 2)`)).rejects.toThrow(/Only the Project Manager/);
    await expect(call(U.pm, `proj_closeout_save_edits('${draft}', ${j(edited)}, 1)`)).rejects.toThrow(/changed by someone else/);
    expect(await call<number>(U.pm, `proj_closeout_save_edits('${draft}', ${j(edited)}, 2)`)).toBe(3);
    await expect(call(U.outsider, `proj_closeout_approve('${draft}', 3)`)).rejects.toThrow(/Only the Project Manager/);
    await expect(call(U.pm, `proj_closeout_approve('${draft}', 2)`)).rejects.toThrow(/changed by someone else/);
    await call(U.pm, `proj_closeout_save_edits('${draft}', '[]'::jsonb, 3)`);
    await expect(call(U.pm, `proj_closeout_approve('${draft}', 4)`)).rejects.toThrow(/empty/);
    await call(U.pm, `proj_closeout_save_edits('${draft}', ${j(edited)}, 4)`);
    await call(U.pm, `proj_closeout_approve('${draft}', 5)`);
    await call(U.pm, `proj_closeout_approve('${draft}', 5)`);                       // a second click
    const [row] = await admin<Row>(`select status, approved_by, approved_at, sections from proj_closeout_reports where id = '${draft}'`);
    expect(row).toMatchObject({ status: "approved", approved_by: U.pm });
    expect(row!.sections[0].paragraphs[0].text).toBe("Delivered, with one item open.");
    await expect(call(U.pm, `proj_closeout_save_edits('${draft}', ${j(edited)}, null)`)).rejects.toThrow(/approved report cannot be edited/);
    await expect(call(U.pm, `proj_closeout_discard_draft('${draft}')`)).rejects.toThrow(/approved report is kept/);
    expect(await fingerprint()).toBe(before);                                       // approving completed nothing, told nobody, moved no stock
    expect((await admin<Row>(`select status from proj_projects where id = '${P1}'`))[0]!.status).toBe("in_progress");
  });

  it("a later project edit does not rewrite the approved version; the next draft is version 2 and can be discarded", async () => {
    await db.seed(`
      insert into proj_completions (project_id, evidence_type, evidence_reference, confirmed_on, client_contact, completion_note, completed_by, completed_at)
        values ('${P1}', 'signed_handover', 'REF-SECRET-77', '2027-03-06', 'CONTACT-SECRET Jane Client', 'Handed over on site', '${U.pm}', '2027-03-06 12:00+00');
      update proj_projects set status = 'completed' where id = '${P1}';
      update proj_project_details set scope = 'Rewritten later' where project_id = '${P1}';
    `);
    const [v1] = await admin<Row>(`select snapshot from proj_closeout_reports where id = '${draft}'`);
    expect(v1!.snapshot.completion).toBeNull();
    expect(v1!.snapshot.scope.current_text).toBe("LED welcome wall 6 x 4 m plus a second kiosk");
    // The completed project: the sign-off is now recorded, and the equipment is STILL out. Two separate facts.
    const e = await evidence(U.pm);
    expect(e.project.status).toBe("completed");
    expect(e.completion).toMatchObject({ evidence_type: "signed_handover", confirmed_on: "2027-03-06", has_reference: true, has_file: false, completed_by: "pm", note_text: "Handed over on site" });
    expect(JSON.stringify(e)).not.toMatch(/REF-SECRET-77|CONTACT-SECRET/);
    expect(e.equipment.requests[0].lines[0]).toMatchObject({ sent: 4, returned: 1 });
    const d2 = await saveDraft(U.pm, e, { generation: "none" });
    expect(d2.version_no).toBe(2);
    expect(d2.id).not.toBe(draft);
    await expect(call(U.eng, `proj_closeout_discard_draft('${d2.id}')`)).rejects.toThrow(/Only the Project Manager/);
    await call(U.pm, `proj_closeout_discard_draft('${d2.id}')`);
    await call(U.pm, `proj_closeout_discard_draft('${d2.id}')`);                    // already gone: nothing happens
    expect((await admin<Row>(`select version_no, status from proj_closeout_reports where project_id = '${P1}'`))).toEqual([{ version_no: 1, status: "approved" }]);
  });

  it("the owner packs: preflight has no STOP, verify says OK on every row", async () => {
    expect((await admin(pack("proj_closeout_reports_00_preflight_readonly.sql"))).filter((r) => String(r.result).startsWith("STOP"))).toEqual([]);
    // Row 2 (no write privilege) is checked on hosted and by projects.rls.test.ts; other suites in this harness may grant every table to signed-in users.
    const rows = (await admin(pack("proj_closeout_reports_20_verify_readonly.sql"))).filter((r) => !String(r.item).startsWith("signed-in users can only READ"));
    expect(rows.filter((r) => r.result !== "OK" && r.result !== "INFO")).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it("rollback: the reports are gone, nothing else is, and applying the migration again works", async () => {
    const before = await fingerprint();
    await db.seed(pack("proj_closeout_reports_90_rollback.sql"));
    await db.seed(pack("proj_closeout_reports_90_rollback.sql"));                   // safe to run twice
    expect((await admin(`select to_regclass('public.proj_closeout_reports') t`))[0]!.t).toBeNull();
    expect(await fingerprint()).toBe(before);
    await db.applyMigration("20270101000100_proj_closeout_reports.sql");
    await db.applyMigration("20270101000100_proj_closeout_reports.sql");            // idempotent
    expect((await evidence(U.pm)).project.reference).toBe("UAE-P-2027-0001");
  });
});
