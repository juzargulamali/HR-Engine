import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects & Tasks Phase 2B: Operations (migration 20270102000100_ops_phase2b.sql). One exhibition journey across Sales, Operations, the Project Manager and the
// warehouse, in two companies, against a real Postgres:
//   * Operations Manager is a Projects capability per company. It opens the Operations reads of that company only, implies PM assignment, and gives no Sales,
//     Inventory, task or delivery write. Revoking it closes everything on the next read;
//   * Sales flags an enquiry; Operations reads an allowlisted row with no commercial value; Operations names a provisional PM and asks a question; nothing else is created;
//   * once Won, Operations assigns the PM through the existing handover functions, the PM accepts, and the project carries the event edition as it was at submission;
//   * a later edit of the edition in Sales changes neither the handover, the project, nor the project's dates;
//   * a committed date change while a request is with the warehouse records a review with the old and the new date and changes no reservation;
//   * readiness: a buy or rent shortage is short, never reserved; partial dispatch and still out are told apart; equipment out survives completion;
//   * Chat: the Operations Manager reads and posts in the project group without being on the project; the archived state comes from the real project status.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { sales: id(), salesB: id(), ops: id(), opsB: id(), pm: id(), member: id(), wh: id(), founder: id(), nobody: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@ops-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

describe("Operations (Phase 2B)", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const rows = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const upcoming = (user: string, company: string | null = null) => call<Row[]>(user, `ops_upcoming_work(${company ? `'${company}'` : "null"})`);
  const overview = (user: string, company = CO.a) => call<Row>(user, `ops_overview('${company}')`);
  let ORG = "", OPP = "", OPP_B = "", OPP_QUIET = "", EVENT = "", EDITION = "", HANDOVER = "", PROJECT = "", LED = "", LOC = "", REQ = "", LINE_OK = "", LINE_BUY = "", GROUP = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.a}', '{}'), ('${U.salesB}', '${CO.b}', '{}');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'KSA');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.ops}', '${CO.a}', '{operations}'), ('${U.opsB}', '${CO.b}', '{operations}'), ('${U.pm}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'),
        ('${U.founder}', '${CO.a}', '{founder}');
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE');
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.wh}', '${CO.a}', '{warehouse}');
      insert into inv_items (company_id, name, tracking, status) values ('${CO.a}', 'LED panel P2.6', 'quantity', 'active');
      insert into inv_locations (company_id, code, name, timezone) values ('${CO.a}', 'DXB', 'Dubai warehouse', 'Asia/Dubai');
    `);
    LED = (await admin<{ id: string }>(`select id from inv_items where name = 'LED panel P2.6'`))[0]!.id;
    LOC = (await admin<{ id: string }>(`select id from inv_locations where code = 'DXB'`))[0]!.id;
    ORG = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Motors', 'client') returning id`))[0]!.id;
    EVENT = (await admin<{ id: string }>(`insert into crm_events (name, kind) values ('Fictional Auto Expo', 'exhibition') returning id`))[0]!.id;
    EDITION = (await admin<{ id: string }>(`insert into crm_event_editions (event_id, start_date, end_date, city, country_code, venue) values ('${EVENT}', '2027-03-01', '2027-03-05', 'Dubai', 'AE', 'Expo Hall 4') returning id`))[0]!.id;
    const opp = (company: string, owner: string, ref: string, title: string, extra = "") => admin<{ id: string }>(`insert into crm_opportunities (company_id, reference, title, client_org_id, source, owner_id, created_by, stage, currency, value, budget_note, payment_terms, brief, scope, location, install_start, event_start, event_end, technologies ${extra ? ", event_edition_id" : ""})
      values ('${company}', '${ref}', '${title}', '${ORG}', 'direct_client', '${owner}', '${owner}', 'proposal_sent', 'AED', 987654.00, 'BUDGET-SECRET', 'PAYMENT-SECRET 50/50', 'BRIEF-SECRET', 'LED welcome wall 6 x 4 m', 'Dubai', '2027-02-26', '2027-03-01', '2027-03-05',
              '[{"name": "LED wall", "qty": 1, "unit_price": 55555}]' ${extra}) returning id`).then((r) => r[0]!.id);
    OPP = await opp(CO.a, U.sales, "UAE-O-2027-0007", "Expo stand for Fictional Motors", `, '${EDITION}'`);
    OPP_B = await opp(CO.b, U.salesB, "KSA-O-2027-0002", "Riyadh launch stand");
    OPP_QUIET = await opp(CO.a, U.sales, "UAE-O-2027-0008", "Not flagged job");
  });
  afterAll(async () => db.teardown());

  it("Operations Manager is a Projects capability: it implies PM assignment and nothing in Sales or Inventory", async () => {
    expect((await admin<{ c: string[] }>(`select proj_capability_list() c`))[0]!.c).toContain("operations");
    const has = (user: string, company: string, cap: string) => q<{ v: boolean }>(user, `select proj_has_capability('${company}', '${cap}') v`).then((r) => r[0]!.v);
    expect([await has(U.ops, CO.a, "operations"), await has(U.ops, CO.a, "assign_pm"), await has(U.ops, CO.b, "operations"), await has(U.ops, CO.a, "manage_access"), await has(U.ops, CO.a, "approve_scope")]).toEqual([true, true, false, false, false]);
    expect([await has(U.founder, CO.a, "operations"), await has(U.pm, CO.a, "operations"), await has(U.pm, CO.a, "assign_pm")]).toEqual([true, false, false]);
    expect((await q<{ c: string }>(U.ops, `select ops_company_ids() c`)).map((r) => r.c)).toEqual([CO.a]);
    expect(await q(U.pm, `select ops_company_ids()`)).toEqual([]);
    // no Sales and no Inventory through it
    expect(await q(U.ops, `select 1 from crm_opportunities`)).toEqual([]);
    expect((await q<{ v: boolean }>(U.ops, `select crm_has_access('${CO.a}') v`))[0]!.v).toBe(false);
    expect((await q<{ v: boolean }>(U.ops, `select inv_has_capability('${CO.a}', 'warehouse') v`))[0]!.v).toBe(false);
    // it is granted and revoked through the existing Projects grant functions, by a founder, and audited by the existing trigger
    await call(U.founder, `proj_grant_access('${U.nobody}', '${CO.a}', '{operations}'::text[], 'Operations Manager')`);
    expect(await has(U.nobody, CO.a, "operations")).toBe(true);
    await expect(call(U.ops, `proj_grant_access('${U.member}', '${CO.a}', '{operations}'::text[], null)`)).rejects.toThrow();
    await call(U.founder, `proj_revoke_access('${U.nobody}', '${CO.a}')`);
    expect(await has(U.nobody, CO.a, "operations")).toBe(false);
    expect(Number((await admin(`select count(*) n from proj_audit_log where company_id = '${CO.a}' and created_at > now() - interval '1 minute'`))[0]!.n)).toBeGreaterThanOrEqual(2);
  });

  it("Sales flags an enquiry: owner or founder only, never a lost one; Operations of that company sees it, with no commercial data", async () => {
    await expect(call(U.ops, `crm_set_ops_planning('${OPP}', true, '{}'::jsonb, null)`)).rejects.toThrow(/not found/i);
    await expect(call(U.salesB, `crm_set_ops_planning('${OPP}', true, '{}'::jsonb, null)`)).rejects.toThrow(/not found/i);
    await expect(call(U.sales, `crm_set_ops_planning('${OPP}', true, ${j({ value: 1 })}, null)`)).rejects.toThrow(/Unknown planning field/);
    expect(await upcoming(U.ops)).toEqual([]);
    const v = await call<number>(U.sales, `crm_set_ops_planning('${OPP}', true, ${j({ decision_date: "2027-01-15", dates_tentative: true, dismantle_date: "2027-03-06", teams: ["engineering", "content", "content"], to_confirm: "Power drop position", note: "Client wants a rehearsal the evening before" })}, null)`);
    expect(v).toBeGreaterThan(1);
    await expect(call(U.sales, `crm_set_ops_planning('${OPP}', true, ${j({ teams: ["finance"] })}, null)`)).rejects.toThrow();
    await call(U.salesB, `crm_set_ops_planning('${OPP_B}', true, '{}'::jsonb, null)`);
    const list = await upcoming(U.ops);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reference: "UAE-O-2027-0007", title: "Expo stand for Fictional Motors", stage: "proposal_sent", owner: "sales", decision_date: "2027-01-15", dates_tentative: true, won: false,
      location: "Dubai", install_start: "2027-02-26", event_start: "2027-03-01", event_end: "2027-03-05", dismantle_date: "2027-03-06", teams: ["content", "engineering"],
      equipment: [{ name: "LED wall", qty: 1 }], to_confirm: "Power drop position", note: "Client wants a rehearsal the evening before", planning: null, handover: null });
    expect(list[0]!.edition).toMatchObject({ event_name: "Fictional Auto Expo", label: "Fictional Auto Expo · 2027 · Dubai", venue: "Expo Hall 4", start_date: "2027-03-01", end_date: "2027-03-05" });
    const text = JSON.stringify(list);
    for (const banned of ["987654", "AED", "BUDGET-SECRET", "PAYMENT-SECRET", "BRIEF-SECRET", "55555", "unit_price", "value", "currency", "scope", "@ops-test.ae", "Not flagged job"]) expect(text, banned).not.toContain(banned);
    expect(Object.keys(list[0]!).sort()).toEqual(["company_id", "decision_date", "dates_tentative", "dismantle_date", "edition", "equipment", "event_end", "event_start", "flagged_at", "handover", "id", "install_start", "location", "note", "owner", "owner_id", "planning", "reference", "stage", "teams", "title", "to_confirm", "won"].sort());
    // company scope: the other company's Operations Manager sees their own enquiry only; asking for a company that is not yours is refused; nobody else gets anything
    expect((await upcoming(U.opsB)).map((r) => r.reference)).toEqual(["KSA-O-2027-0002"]);
    await expect(upcoming(U.ops, CO.b)).rejects.toThrow(/Operations Managers of this company/);
    for (const who of [U.pm, U.member, U.sales, U.wh]) expect(await upcoming(who), who).toEqual([]);
    await expect(q(null, `select ops_upcoming_work(null)`)).rejects.toThrow();
    expect((await upcoming(U.founder)).map((r) => r.reference)).toEqual(["UAE-O-2027-0007"]);
    // the Operations Managers of the company were told; the flag is in the enquiry's history
    expect(await admin(`select type from notifications where user_id = '${U.ops}' and type = 'project_ops_enquiry_flagged'`)).toHaveLength(1);
    expect(await admin(`select 1 from crm_opportunity_events where opportunity_id = '${OPP}' and reason = 'Flagged for Operations planning'`)).toHaveLength(1);
    await admin(`update crm_opportunities set stage = 'lost', lost_reason = 'x', closed_at = now() where id = '${OPP_QUIET}'`);
    await expect(call(U.sales, `crm_set_ops_planning('${OPP_QUIET}', true, '{}'::jsonb, null)`)).rejects.toThrow(/lost enquiry/);
  });

  it("Operations names a provisional PM, flags a conflict and asks Sales; it creates no project, books nobody and reserves nothing; Sales answers", async () => {
    const before = JSON.stringify(await admin(`select (select count(*) from proj_projects) p, (select count(*) from proj_handovers) h, (select count(*) from proj_project_members) m, (select count(*) from inv_requests) r, (select count(*) from inv_reservations) x, (select count(*) from proj_tasks) t`));
    await expect(call(U.pm, `ops_set_enquiry_planning('${OPP}', ${j({ risk: "high" })})`)).rejects.toThrow(/not found/i);
    await expect(call(U.opsB, `ops_set_enquiry_planning('${OPP}', ${j({ risk: "high" })})`)).rejects.toThrow(/not found/i);
    await expect(call(U.sales, `ops_set_enquiry_planning('${OPP}', ${j({ risk: "high" })})`)).rejects.toThrow(/not found/i);
    await expect(call(U.ops, `ops_set_enquiry_planning('${OPP}', ${j({ provisional_pm_id: U.sales })})`)).rejects.toThrow(/Projects access/);
    await expect(call(U.ops, `ops_set_enquiry_planning('${OPP}', ${j({ stage: "won" })})`)).rejects.toThrow(/Unknown planning field/);
    await call(U.ops, `ops_set_enquiry_planning('${OPP}', ${j({ provisional_pm_id: U.pm, risk: "medium", risk_note: "Tight install window", capacity_conflict: true, capacity_note: "Overlaps the Riyadh job", question: "Is the hall available from the 25th?" })})`);
    expect(await admin(`select (select count(*) from proj_projects) p, (select count(*) from proj_handovers) h, (select count(*) from proj_project_members) m, (select count(*) from inv_requests) r, (select count(*) from inv_reservations) x, (select count(*) from proj_tasks) t`).then(JSON.stringify)).toBe(before);
    const [row] = await upcoming(U.ops);
    expect(row!.planning).toMatchObject({ provisional_pm: "pm", risk: "medium", risk_note: "Tight install window", capacity_conflict: true, question: "Is the hall available from the 25th?", question_by: "ops", answer: null });
    // Sales sees it on the enquiry and is told; another company's Sales and a plain project member cannot read the row
    expect(await call<Row>(U.sales, `crm_ops_planning('${OPP}')`)).toMatchObject({ provisional_pm: "pm", capacity_conflict: true, question: "Is the hall available from the 25th?" });
    await expect(call(U.salesB, `crm_ops_planning('${OPP}')`)).rejects.toThrow(/not found/i);
    expect(await q(U.member, `select 1 from ops_enquiry_planning`)).toEqual([]);
    expect(await q(U.sales, `select 1 from ops_enquiry_planning`)).toHaveLength(1);
    expect(await admin(`select 1 from crm_opportunity_events where opportunity_id = '${OPP}' and reason like 'Operations: provisional Project Manager named: pm%'`)).toHaveLength(1);   // Sales reads it in the enquiry's history
    expect((await rows(U.ops, `select type from proj_my_notifications(50, false)`)).map((r) => r.type)).toContain("project_ops_enquiry_flagged");   // and Operations in Project notices
    // bad values are refused in words, not with a raw error; saving the same thing twice writes one history line
    await expect(call(U.ops, `ops_set_enquiry_planning('${OPP}', ${j({ risk: "extreme" })})`)).rejects.toThrow(/Check the planning details/);
    await expect(call(U.ops, `ops_set_enquiry_planning('${OPP}', ${j({ provisional_pm_id: "nope" })})`)).rejects.toThrow(/Check the planning details/);
    await expect(call(U.sales, `crm_set_ops_planning('${OPP}', null, ${j({ decision_date: "2027-02-31" })}, null)`)).rejects.toThrow(/Check the planning details/);
    await expect(call(U.sales, `crm_set_ops_planning('${OPP}', null, ${j({ teams: "engineering" })}, null)`)).rejects.toThrow(/Check the planning details/);
    await call(U.ops, `ops_set_enquiry_planning('${OPP}', ${j({ provisional_pm_id: U.pm, risk: "high", capacity_conflict: true, question: "Is the hall available from the 25th?" })})`);
    expect(await admin(`select 1 from crm_opportunity_events where opportunity_id = '${OPP}' and reason like 'Operations:%'`)).toHaveLength(1);
    expect((await upcoming(U.ops))[0]!.planning).toMatchObject({ risk: "high", question_by: "ops" });
    // an answer does not flag an enquiry, and with no question there is nothing to tell Operations
    await call(U.sales, `crm_set_ops_planning('${OPP_QUIET}', null, ${j({ answer: "hello" })}, null)`).catch(() => undefined);
    expect((await admin<Row>(`select ops_flagged_at from crm_opportunities where id = '${OPP_QUIET}'`))[0]!.ops_flagged_at).toBeNull();
    expect(await admin(`select 1 from notifications where user_id = '${U.ops}' and type = 'project_ops_sales_answered'`)).toEqual([]);
    await call(U.sales, `crm_set_ops_planning('${OPP}', null, ${j({ answer: "Yes, from the 25th at 08:00" })}, null)`);
    expect((await admin<Row>(`select ops_flagged_at from crm_opportunities where id = '${OPP}'`))[0]!.ops_flagged_at).not.toBeNull();
    expect((await upcoming(U.ops))[0]!.planning).toMatchObject({ answer: "Yes, from the 25th at 08:00" });
    expect(await admin(`select 1 from notifications where user_id = '${U.ops}' and type = 'project_ops_sales_answered'`)).toHaveLength(1);
    // direct writes to either side are not possible
    await db.asUserCommit(U.ops, async (query) => { await query(`update ops_enquiry_planning set risk = 'low'`).catch(() => undefined); }).catch(() => undefined);
    await db.asUserCommit(U.ops, async (query) => { await query(`update crm_opportunities set ops_note = 'x'`).catch(() => undefined); }).catch(() => undefined);
    expect((await admin<Row>(`select risk from ops_enquiry_planning where opportunity_id = '${OPP}'`))[0]!.risk).toBe("high");
  });

  it("once Won the dates read as confirmed; Operations assigns the PM through the handover; the PM accepts; the project carries the edition as submitted", async () => {
    await admin(`update crm_opportunities set stage = 'won', evidence_type = 'purchase_order', evidence_reference = 'PO-SECRET-1', evidence_date = current_date, closed_at = now(), closed_by = '${U.sales}' where id = '${OPP}'`);
    expect((await upcoming(U.ops))[0]).toMatchObject({ won: true, dates_tentative: false });
    HANDOVER = await call<string>(U.sales, `proj_save_handover('${OPP}', ${j({ scope: "LED welcome wall 6 x 4 m" })}, null)`);
    expect((await admin<Row>(`select event_edition_id, edition_snapshot from proj_handovers where id = '${HANDOVER}'`))[0]).toMatchObject({ event_edition_id: EDITION, edition_snapshot: { label: "Fictional Auto Expo · 2027 · Dubai", venue: "Expo Hall 4" } });
    await call(U.sales, `proj_submit_handover('${HANDOVER}')`);
    // Operations Overview finds the handover that waits for a PM
    const ov = await overview(U.ops);
    expect(ov.handovers).toEqual([expect.objectContaining({ id: HANDOVER, sales_reference: "UAE-O-2027-0007", status: "submitted", pm: null, edition: "Fictional Auto Expo · 2027 · Dubai" })]);
    expect(JSON.stringify(ov)).not.toMatch(/987654|PO-SECRET|BUDGET-SECRET|PAYMENT-SECRET|BRIEF-SECRET/);
    expect((await upcoming(U.ops))[0]!.handover).toMatchObject({ id: HANDOVER, status: "submitted", pm: null });
    expect(await admin(`select 1 from notifications where user_id = '${U.ops}' and type = 'project_handover_submitted'`)).toHaveLength(1);   // the Operations Manager is told
    // only an assigner: a plain member cannot; the other company's Operations Manager cannot; the PM must be eligible
    await expect(call(U.member, `proj_assign_handover_pm('${HANDOVER}', '${U.pm}')`)).rejects.toThrow();
    await expect(call(U.opsB, `proj_assign_handover_pm('${HANDOVER}', '${U.pm}')`)).rejects.toThrow();
    await expect(call(U.ops, `proj_assign_handover_pm('${HANDOVER}', '${U.sales}')`)).rejects.toThrow();
    await call(U.ops, `proj_assign_handover_pm('${HANDOVER}', '${U.member}')`);
    await call(U.ops, `proj_assign_handover_pm('${HANDOVER}', '${U.pm}')`);                 // reassign
    // Sales edits the edition AFTER submission: the handover keeps the copy it was submitted with
    await admin(`update crm_event_editions set venue = 'Hall 9 (moved)', start_date = '2027-04-01', end_date = '2027-04-05' where id = '${EDITION}'`);
    await expect(call(U.ops, `proj_accept_handover('${HANDOVER}')`)).rejects.toThrow();     // Operations assigns; it does not accept for the PM
    PROJECT = await call<string>(U.pm, `proj_accept_handover('${HANDOVER}')`);
    expect(await call<string>(U.pm, `proj_accept_handover('${HANDOVER}')`)).toBe(PROJECT);   // a retry returns the same project: one project per handover
    expect(Number((await admin(`select count(*) n from proj_projects where handover_id = '${HANDOVER}'`))[0]!.n)).toBe(1);
    const [d] = await admin<Row>(`select event_edition_id, edition_snapshot, install_start, event_start, event_end from proj_project_details where project_id = '${PROJECT}'`);
    expect(d).toMatchObject({ event_edition_id: EDITION, edition_snapshot: { label: "Fictional Auto Expo · 2027 · Dubai", venue: "Expo Hall 4", start_date: "2027-03-01", end_date: "2027-03-05" } });
    expect([String(d!.install_start).slice(0, 10), String(d!.event_start).slice(0, 10)].every(Boolean)).toBe(true);
    // a second edit in Sales reaches neither the accepted handover nor the project, and does not move the project's dates
    const datesBefore = JSON.stringify(await admin(`select start_date, end_date from proj_projects where id = '${PROJECT}'`)) + JSON.stringify([d!.install_start, d!.event_start, d!.event_end]);
    await admin(`update crm_event_editions set city = 'Abu Dhabi' where id = '${EDITION}'`);
    const [d2] = await admin<Row>(`select edition_snapshot, install_start, event_start, event_end from proj_project_details where project_id = '${PROJECT}'`);
    expect(d2!.edition_snapshot).toMatchObject({ venue: "Expo Hall 4", city: "Dubai", start_date: "2027-03-01" });
    expect(JSON.stringify(await admin(`select start_date, end_date from proj_projects where id = '${PROJECT}'`)) + JSON.stringify([d2!.install_start, d2!.event_start, d2!.event_end])).toBe(datesBefore);
    expect((await admin<Row>(`select edition_snapshot from proj_handovers where id = '${HANDOVER}'`))[0]!.edition_snapshot.venue).toBe("Expo Hall 4");
    // the accepted enquiry leaves Upcoming Work; the project is in the Overview
    expect(await upcoming(U.ops)).toEqual([]);
    expect((await overview(U.ops)).projects.map((p: Row) => [p.reference, p.pm, p.edition])).toEqual([[expect.stringMatching(/^UAE-P-/), "pm", "Fictional Auto Expo · 2027 · Dubai"]]);
    // editions for the directory and for the Sales event: only for people who can see the project
    expect(await rows(U.pm, `select project_id, label from proj_project_editions()`)).toEqual([{ project_id: PROJECT, label: "Fictional Auto Expo · 2027 · Dubai" }]);
    expect((await rows(U.pm, `select project_id from proj_projects_for_edition('${EDITION}')`)).map((r) => r.project_id)).toEqual([PROJECT]);
    for (const who of [U.salesB, U.opsB, U.wh]) expect(await rows(who, `select project_id from proj_projects_for_edition('${EDITION}')`), who).toEqual([]);
    expect((await overview(U.ops)).projects[0].chat_group_id).toBeNull();                  // no conversation yet
    // an internal project and a project accepted from a handover with no edition stay unlinked
    await admin(`insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO.b}', '${CO.b}', 'KSA-P-1', 'Fictional internal job', 'internal', 'in_progress', '${U.opsB}', '${U.opsB}')`);
    await admin(`insert into proj_project_details (project_id, site_timezone) values ('${CO.b}', 'Asia/Riyadh')`);
    expect((await admin<Row>(`select event_edition_id from proj_project_details where project_id = '${CO.b}'`))[0]!.event_edition_id).toBeNull();
  });

  it("the Overview is for the Operations Managers of that company only, and a revoked manager loses it on the next read", async () => {
    for (const who of [U.pm, U.member, U.sales, U.wh, U.opsB]) await expect(overview(who), who).rejects.toThrow(/Operations Managers of this company/);
    await expect(overview(U.ops, CO.b)).rejects.toThrow(/Operations Managers of this company/);
    expect((await overview(U.founder)).projects).toHaveLength(1);
    expect((await overview(U.opsB, CO.b)).projects.map((p: Row) => p.reference)).toEqual(["KSA-P-1"]);
    await call(U.founder, `proj_grant_access('${U.nobody}', '${CO.a}', '{operations}'::text[], null)`);
    expect((await overview(U.nobody)).projects).toHaveLength(1);
    await call(U.founder, `proj_revoke_access('${U.nobody}', '${CO.a}')`);
    await expect(overview(U.nobody)).rejects.toThrow(/Operations Managers of this company/);
    expect(await upcoming(U.nobody)).toEqual([]);
    expect(await q(U.nobody, `select ops_company_ids()`)).toEqual([]);
  });

  it("Chat: the Operations Manager reads and posts in the company's project groups without joining the project; nobody else gains anything", async () => {
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${PROJECT}', '${U.member}', 'member') on conflict do nothing`);
    GROUP = await call<string>(U.pm, `chat_project_group('${PROJECT}')`);
    await call(U.pm, `chat_post('${GROUP}', 'Truss arrives Monday')`);
    const mine = await rows(U.ops, `select * from chat_my_groups()`);
    const g = mine.find((r) => r.gid === GROUP)!;                     // the read marker starts at the newest message the first time a group is listed
    expect(g).toMatchObject({ gkind: "project", project_status: "planning", via_operations: true, read_only: false, unread: "0" });
    expect((await rows(U.pm, `select * from chat_my_groups()`)).find((r) => r.gid === GROUP)).toMatchObject({ via_operations: false, project_status: "planning" });
    expect(await call<string>(U.ops, `chat_project_group('${PROJECT}')`)).toBe(GROUP);
    await call(U.ops, `chat_post('${GROUP}', 'Hall access is confirmed from the 25th')`);
    expect((await rows(U.pm, `select unread from chat_my_groups() where gid = '${GROUP}'`))[0]!.unread).toBe("1");
    expect((await overview(U.ops)).projects[0].chat_group_id).toBe(GROUP);
    expect((await overview(U.founder)).projects[0].chat_group_id).toBeNull();               // a founder without the capability is not offered a chat they cannot open
    expect(Number((await admin(`select count(*) n from proj_project_members where project_id = '${PROJECT}' and user_id = '${U.ops}'`))[0]!.n)).toBe(0);
    // the project's people can see and mention the Operations Manager, marked as Operations
    expect((await rows(U.pm, `select name from chat_group_members('${GROUP}')`)).map((r) => r.name).sort()).toEqual(["member", "ops (Operations)", "pm"]);
    await call(U.pm, `chat_post('${GROUP}', 'Thanks', ARRAY['${U.ops}']::uuid[])`);
    expect((await rows(U.ops, `select mentions from chat_my_groups() where gid = '${GROUP}'`))[0]!.mentions).toBe("1");
    // the founder shortcut is not the explicit permission; another company's manager, Sales and the warehouse have no path
    for (const who of [U.founder, U.opsB, U.sales, U.wh]) {
      await expect(call(who, `chat_project_group('${PROJECT}')`), who).rejects.toThrow(/not a member/);
      expect((await rows(who, `select gid from chat_my_groups()`)).map((r) => r.gid), who).not.toContain(GROUP);
      await expect(call(who, `chat_post('${GROUP}', 'x')`), who).rejects.toThrow(/not a member/);
    }
    // Chat membership itself opens no record. What the Operations Manager reads of the project comes from the Operations permission: the project in full, read only.
    await admin(`insert into proj_tasks (project_id, title, assignee_id, created_by) values ('${PROJECT}', 'Build the wall', '${U.member}', '${U.pm}');
      insert into proj_files (project_id, kind, label, url, restricted, uploaded_by) values ('${PROJECT}', 'link', 'Open drawing', 'https://example.invalid/a', false, '${U.pm}'), ('${PROJECT}', 'link', 'Client confirmation', 'https://example.invalid/b', true, '${U.pm}')`);
    expect(await q(U.ops, `select 1 from proj_tasks where project_id = '${PROJECT}'`)).toHaveLength(1);
    expect((await q<Row>(U.ops, `select label from proj_files where project_id = '${PROJECT}'`)).map((r) => r.label)).toEqual(["Open drawing"]);   // a restricted file stays with whoever manages the project
    expect(await q(U.ops, `select 1 from proj_scope_change_commercial`)).toEqual([]);
    expect((await q<{ v: boolean }>(U.ops, `select proj_can_manage('${PROJECT}') v`))[0]!.v).toBe(false);
    const task = (await admin<{ id: string }>(`select id from proj_tasks where project_id = '${PROJECT}'`))[0]!.id;
    await expect(call(U.ops, `proj_create_task('${PROJECT}', ${j({ title: "x", assignee_id: U.member })})`)).rejects.toThrow();
    await expect(call(U.ops, `proj_set_task_status('${task}', 'done')`)).rejects.toThrow();
    await expect(call(U.ops, `proj_update_project('${PROJECT}', ${j({ install_start: "2027-02-20" })}, null)`)).rejects.toThrow();
    await expect(call(U.ops, `proj_complete_project('${PROJECT}', '{}'::jsonb)`)).rejects.toThrow();
    // PM assignment through Operations stops at handovers and at reassigning a live project's PM: no internal project, no change to Sales links
    await expect(call(U.ops, `proj_create_internal_project('${CO.a}', 'Ops made this', '${U.pm}')`)).rejects.toThrow(/can create an internal project/);
    await expect(call(U.ops, `proj_set_sales_link('${PROJECT}', '${U.sales}', false)`)).rejects.toThrow(/who in Sales is linked/);
    expect(Number((await admin(`select count(*) n from proj_sales_links where project_id = '${PROJECT}' and removed_at is null`))[0]!.n)).toBeGreaterThanOrEqual(1);
    await call(U.founder, `proj_set_sales_link('${PROJECT}', '${U.sales}', true)`);                          // a founder still can
    expect((await rows(U.ops, `select user_id from proj_staff_directory()`)).length).toBeGreaterThan(3);     // names for the people it assigns
    // what an Operations Manager may add to a project they are not on, under their own name: a comment on a task and a correction
    await call(U.ops, `proj_comment_task('${task}', 'Hall access is confirmed')`);
    expect((await admin<Row>(`select author_id from proj_task_comments where task_id = '${task}'`))[0]!.author_id).toBe(U.ops);
    const corr = await call<string>(U.ops, `proj_dp_raise_correction('${PROJECT}', 'task', '${task}', 'The wall is 6 x 4 m, not 5 x 4 m')`);
    expect((await admin<Row>(`select raised_by, status from proj_dp_corrections where id = '${corr}'`))[0]).toMatchObject({ raised_by: U.ops, status: "open" });
    await expect(call(U.ops, `proj_dp_decide_correction('${corr}', 'accept', 'ok')`)).rejects.toThrow();          // raising is not deciding
    // ... and what they may NOT add through Operations alone: a link or a file. A member still can.
    await expect(call(U.ops, `proj_add_link('${PROJECT}', 'Ops link', 'https://example.invalid/ops')`)).rejects.toThrow(/Only the people on this project can add files or links/);
    await expect(rows(U.ops, `select * from proj_create_upload_intent('${PROJECT}', 'a.pdf', 'application/pdf', 1000, 'a.pdf')`)).rejects.toThrow(/Only the people on this project can add files or links/);
    expect(Number((await admin(`select count(*) n from proj_files where project_id = '${PROJECT}' and uploaded_by = '${U.ops}'`))[0]!.n)).toBe(0);
    expect(Number((await admin(`select count(*) n from proj_upload_intents where project_id = '${PROJECT}'`))[0]!.n)).toBe(0);
    expect(await call<string>(U.member, `proj_add_link('${PROJECT}', 'Member link', 'https://example.invalid/m')`)).toBeTruthy();
    // cross-company: the other company's Operations Manager can do none of it
    await expect(call(U.opsB, `proj_comment_task('${task}', 'x')`)).rejects.toThrow();
    await expect(call(U.opsB, `proj_dp_raise_correction('${PROJECT}', 'task', '${task}', 'x')`)).rejects.toThrow();
    await expect(call(U.opsB, `proj_add_link('${PROJECT}', 'x', 'https://example.invalid/x')`)).rejects.toThrow();
    await expect(call(U.opsB, `proj_assign_pm('${PROJECT}', '${U.member}', 'Trying from another company')`)).rejects.toThrow(/can change the Project Manager/);
    // Reassigning the Project Manager of a live project: the existing workflow, with a reason in the history and both Project Managers told.
    const fpBefore = JSON.stringify(await admin(`select (select md5(string_agg(row(t.id, t.assignee_id, t.status)::text, ',' order by t.id)) from proj_tasks t where t.project_id = '${PROJECT}') tasks,
      (select count(*) from inv_requests) requests, (select count(*) from inv_reservations) reservations`));
    await expect(call(U.member, `proj_assign_pm('${PROJECT}', '${U.member}', 'I would like it')`)).rejects.toThrow(/can change the Project Manager/);
    await expect(call(U.ops, `proj_assign_pm('${PROJECT}', '${U.member}', null)`)).rejects.toThrow(/Give the reason/);
    await expect(call(U.ops, `proj_assign_pm('${PROJECT}', '${U.member}')`)).rejects.toThrow(/Give the reason/);
    await expect(call(U.ops, `proj_assign_pm('${PROJECT}', '${U.wh}', 'Warehouse person')`)).rejects.toThrow(/Projects access/);
    await call(U.ops, `proj_assign_pm('${PROJECT}', '${U.member}', 'Pat is on leave for the installation week')`);
    expect((await admin<Row>(`select pm_user_id from proj_projects where id = '${PROJECT}'`))[0]!.pm_user_id).toBe(U.member);
    expect((await admin<Row>(`select role from proj_project_members where project_id = '${PROJECT}' and user_id = '${U.pm}' and removed_at is null`))[0]!.role).toBe("member");   // the outgoing PM stays on the project
    const log = await admin<Row>(`select field, to_value from proj_change_log where project_id = '${PROJECT}' and field in ('pm', 'pm_change_reason') order by id desc limit 2`);
    expect(log.map((l) => [l.field, l.to_value]).sort()).toEqual([["pm", "member"], ["pm_change_reason", "Pat is on leave for the installation week"]]);
    expect((await admin<Row>(`select payload from notifications where user_id = '${U.pm}' and type = 'project_pm_changed'`))[0]!.payload).toMatchObject({ new_pm: "member", reason: "Pat is on leave for the installation week" });
    expect(await admin(`select 1 from notifications where user_id = '${U.member}' and type = 'project_assigned'`)).toHaveLength(1);
    expect(JSON.stringify(await admin(`select (select md5(string_agg(row(t.id, t.assignee_id, t.status)::text, ',' order by t.id)) from proj_tasks t where t.project_id = '${PROJECT}') tasks,
      (select count(*) from inv_requests) requests, (select count(*) from inv_reservations) reservations`))).toBe(fpBefore);   // tasks keep their owners; no booking is touched
    await call(U.founder, `proj_assign_pm('${PROJECT}', '${U.pm}', 'Pat is back')`);        // back, for the rest of this journey
    await expect(q(U.ops, `select proj_assign_pm_base('${PROJECT}', '${U.member}')`)).rejects.toThrow(/permission denied/);
    // the other company's Operations Manager, Sales and the warehouse read none of it
    for (const who of [U.opsB, U.sales, U.wh]) expect(await q(who, `select 1 from proj_tasks where project_id = '${PROJECT}'`), who).toEqual([]);
    // revoked: the group is gone on the next read, and posting is refused
    await call(U.founder, `proj_grant_access('${U.nobody}', '${CO.a}', '{operations}'::text[], null)`);
    expect((await rows(U.nobody, `select gid from chat_my_groups()`)).map((r) => r.gid)).toContain(GROUP);
    await call(U.founder, `proj_revoke_access('${U.nobody}', '${CO.a}')`);
    expect((await rows(U.nobody, `select gid from chat_my_groups()`)).map((r) => r.gid)).not.toContain(GROUP);
    await expect(call(U.nobody, `chat_post('${GROUP}', 'x')`)).rejects.toThrow(/not a member/);
  });

  it("a committed date change while a request is with the warehouse records a review with the old and new date, and changes no reservation", async () => {
    REQ = (await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone, needed_from, needed_until, expected_return_at)
      values ('${CO.a}', 'UAE-R-90001', 'project', '${PROJECT}', '${U.pm}', 'submitted', 'Asia/Dubai', '2027-02-25 08:00+00', '2027-03-08 08:00+00', '2027-03-08 08:00+00') returning id`))[0]!.id;
    LINE_OK = (await admin<{ id: string }>(`insert into inv_request_lines (request_id, company_id, item_id, qty) values ('${REQ}', '${CO.a}', '${LED}', 4) returning id`))[0]!.id;
    LINE_BUY = (await admin<{ id: string }>(`insert into inv_request_lines (request_id, company_id, item_id, qty, shortage_action) values ('${REQ}', '${CO.a}', '${LED}', 2, 'need_to_buy') returning id`))[0]!.id;
    await admin(`insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, reserved_during, made_by) values ('${CO.a}', '${LINE_OK}', '${LED}', '${LOC}', 4, tstzrange('2027-02-25 08:00+00', '2027-03-08 08:00+00'), '${U.wh}')`);
    const draft = (await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone) values ('${CO.a}', 'UAE-R-90002', 'project', '${PROJECT}', '${U.pm}', 'draft', 'Asia/Dubai') returning id`))[0]!.id;
    const fp = async () => JSON.stringify(await admin(`select (select md5(string_agg(row(x.id, x.qty, x.dispatched_qty, x.returned_qty, x.status, x.reserved_during)::text, ',' order by x.id)) from inv_reservations x) r,
      (select md5(string_agg(row(q.id, q.status, q.needed_from, q.needed_until, q.expected_return_at, q.version)::text, ',' order by q.id)) from inv_requests q) q`));
    const before = await fp();
    const version = (await admin<Row>(`select version from proj_projects where id = '${PROJECT}'`))[0]!.version;
    await call(U.pm, `proj_update_project('${PROJECT}', ${j({ install_start: "2027-02-24" })}, ${version})`);
    expect(await fp()).toBe(before);                                                        // the date change alone alters no reservation and no request
    const ready = await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`);
    expect(ready.reviews).toEqual([expect.objectContaining({ request_id: REQ, request_code: "UAE-R-90001", field: "install_start", old_date: "2027-02-26", new_date: "2027-02-24", changed_by: "pm" })]);
    expect(ready.reviews.some((r: Row) => r.request_id === draft)).toBe(false);             // a draft has nothing booked to review
    // a second change keeps the date the booking was made from, and stays one review
    const v2 = (await admin<Row>(`select version from proj_projects where id = '${PROJECT}'`))[0]!.version;
    await call(U.pm, `proj_update_project('${PROJECT}', ${j({ install_start: "2027-02-23" })}, ${v2})`);
    const again = (await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`)).reviews;
    expect(again).toEqual([expect.objectContaining({ old_date: "2027-02-26", new_date: "2027-02-23" })]);
    expect((await overview(U.ops)).projects[0].equipment_reviews).toBe(1);
    // who reads it: the project's people, Operations and the warehouse; who decides: whoever manages the project, or the warehouse
    for (const who of [U.ops, U.wh, U.member]) expect((await call<Row>(who, `proj_equipment_readiness('${PROJECT}')`)).reviews, who).toHaveLength(1);
    for (const who of [U.opsB, U.salesB, U.sales]) await expect(call(who, `proj_equipment_readiness('${PROJECT}')`), who).rejects.toThrow(/not found/i);
    // changed back to the date the booking was made for: nothing is left to review; changed again: one review
    const v3 = (await admin<Row>(`select version from proj_projects where id = '${PROJECT}'`))[0]!.version;
    await call(U.pm, `proj_update_project('${PROJECT}', ${j({ install_start: "2027-02-26" })}, ${v3})`);
    expect((await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`)).reviews).toEqual([]);
    await call(U.pm, `proj_update_project('${PROJECT}', ${j({ install_start: "2027-02-23" })}, ${v3 + 1})`);
    const again2 = (await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`)).reviews;
    expect(again2).toEqual([expect.objectContaining({ old_date: "2027-02-26", new_date: "2027-02-23" })]);
    const review = again2[0].id as string;
    for (const who of [U.member, U.ops, U.opsB]) await expect(call(who, `proj_resolve_equipment_review('${review}', 'x')`), who).rejects.toThrow(/not found/i);
    await call(U.wh, `proj_resolve_equipment_review('${review}', 'Window moved on the request')`);
    await call(U.wh, `proj_resolve_equipment_review('${review}', 'again')`);
    expect((await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`)).reviews).toEqual([]);
    expect((await admin<Row>(`select resolution_note, resolved_by from proj_equipment_reviews where id = '${review}'`))[0]).toMatchObject({ resolution_note: "Window moved on the request", resolved_by: U.wh });
    expect(await fp()).toBe(before);
    expect(await admin(`select 1 from notifications where user_id = '${U.pm}' and type = 'project_equipment_review'`)).toEqual([]);   // the PM made the change, so is not told
  });

  it("readiness: a buy shortage is short, never reserved; partial dispatch, still out and returned are told apart", async () => {
    const state = async () => (await call<Row>(U.ops, `proj_equipment_readiness('${PROJECT}')`)).requests.find((r: Row) => r.id === REQ) as Row;
    const of = async (id: string) => (await admin<{ s: Row }>(`select inv_request_state('${id}') s`))[0]!.s;
    // a draft with lines and nothing reserved is not "reserved", even with a line marked to buy; a request with no lines is "empty"
    const d1 = (await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone) values ('${CO.a}', 'UAE-R-90003', 'project', '${PROJECT}', '${U.pm}', 'draft', 'Asia/Dubai') returning id`))[0]!.id;
    await admin(`insert into inv_request_lines (request_id, company_id, item_id, qty, shortage_action) values ('${d1}', '${CO.a}', '${LED}', 2, 'need_to_buy'), ('${d1}', '${CO.a}', '${LED}', 1, 'none')`);
    expect(await of(d1)).toMatchObject({ state: "draft", lines: 2, reserved_lines: 0 });
    const d2 = (await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone, needed_from, needed_until) values ('${CO.a}', 'UAE-R-90004', 'project', '${PROJECT}', '${U.pm}', 'submitted', 'Asia/Dubai', '2027-02-25 08:00+00', '2027-03-08 08:00+00') returning id`))[0]!.id;
    expect(await of(d2)).toMatchObject({ state: "empty", lines: 0, reserved_lines: 0 });
    await admin(`delete from inv_request_lines where request_id = '${d1}'; delete from inv_requests where id in ('${d1}', '${d2}')`);
    expect(await state()).toMatchObject({ state: "partially_ready", lines: 2, reserved_lines: 1, short_lines: 1, short_buy: 1, short_rent: 0, short_no_plan: 0, units_short: 2, units_out: 0 });
    await admin(`update inv_request_lines set shortage_action = 'need_to_rent' where id = '${LINE_BUY}'`);
    expect(await state()).toMatchObject({ state: "partially_ready", reserved_lines: 1, short_rent: 1, short_buy: 0 });
    await admin(`update inv_reservations set status = 'released', released_at = now() where request_line_id = '${LINE_OK}'`);
    expect(await state()).toMatchObject({ state: "short", reserved_lines: 0, short_lines: 2, short_no_plan: 1 });
    await admin(`update inv_reservations set status = 'active', released_at = null where request_line_id = '${LINE_OK}'`);
    // the warehouse dispatches the reserved line; the rented line is still short: a partial dispatch
    await admin(`update inv_requests set status = 'in_progress' where id = '${REQ}'; update inv_reservations set dispatched_qty = 4 where request_line_id = '${LINE_OK}'`);
    expect(await state()).toMatchObject({ state: "partially_dispatched", dispatched_lines: 1, short_lines: 1, units_dispatched: 4, units_out: 4, return_overdue: false });
    await admin(`update inv_reservations set returned_qty = 1 where request_line_id = '${LINE_OK}'`);
    expect(await state()).toMatchObject({ units_out: 3, units_returned: 1 });
    // everything that was sent is back, and one line is still short: that is not "returned"
    await admin(`update inv_reservations set returned_qty = 4 where request_line_id = '${LINE_OK}'`);
    expect(await state()).toMatchObject({ state: "partially_dispatched", short_lines: 1, units_out: 0 });
    await admin(`update inv_reservations set returned_qty = 1 where request_line_id = '${LINE_OK}'`);
    // the rented stock arrives, is reserved and dispatched: everything is out, some of it back
    await admin(`insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, dispatched_qty, reserved_during, made_by) values ('${CO.a}', '${LINE_BUY}', '${LED}', '${LOC}', 2, 2, tstzrange('2027-02-25 08:00+00', '2027-03-08 08:00+00'), '${U.wh}')`);
    expect(await state()).toMatchObject({ state: "still_out", short_lines: 0, units_out: 5 });
    expect((await overview(U.ops)).projects[0].equipment.find((r: Row) => r.id === REQ)).toMatchObject({ state: "still_out", units_out: 5 });
  });

  it("equipment that is out survives completion until the warehouse records the return; a failed release is reported", async () => {
    await admin(`update proj_projects set status = 'completed', completed_at = now() where id = '${PROJECT}'`).catch(async () => { await admin(`update proj_projects set status = 'completed' where id = '${PROJECT}'`); });
    await admin(`update inv_requests set expected_return_at = now() - interval '2 days' where id = '${REQ}'`);
    const done = await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`);
    expect(done.project_status).toBe("completed");
    expect(done.requests.find((r: Row) => r.id === REQ)).toMatchObject({ units_out: 5, return_overdue: true });
    expect(done.release_failed).toBeNull();
    const ov = await overview(U.ops);
    expect(ov.projects.map((p: Row) => [p.status, p.equipment.find((r: Row) => r.id === REQ)?.units_out])).toEqual([["completed", 5]]);   // still listed: delivery complete, equipment still out
    // a failed release is reported only while something is still left to release
    await admin(`insert into inv_import_log (company_id, project_id, outcome, detail) values ('${CO.a}', '${PROJECT}', 'failed', 'Releasing equipment at project completed failed: boom')`);
    await admin(`update inv_requests set status = 'cancelled', cancelled_at = now() where project_id = '${PROJECT}' and status in ('draft', 'submitted')`);
    expect((await call<Row>(U.wh, `proj_equipment_readiness('${PROJECT}')`)).release_failed).toBeNull();
    const spare = (await admin<{ id: string }>(`insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, reserved_during, made_by) values ('${CO.a}', '${LINE_OK}', '${LED}', '${LOC}', 1, tstzrange('2027-02-25 08:00+00', '2027-03-08 08:00+00'), '${U.wh}') returning id`))[0]!.id;
    expect((await call<Row>(U.wh, `proj_equipment_readiness('${PROJECT}')`)).release_failed).toMatchObject({ detail: "Releasing equipment at project completed failed: boom" });
    expect((await overview(U.ops)).projects[0].release_failed).toBe(true);
    await admin(`update inv_reservations set status = 'released', released_at = now() where id = '${spare}'`);          // the warehouse releases it by hand
    expect((await call<Row>(U.wh, `proj_equipment_readiness('${PROJECT}')`)).release_failed).toBeNull();
    // the warehouse records the return: nothing is out, and the finished project leaves the Overview once the failed release is the only thing left to see
    await admin(`update inv_reservations set returned_qty = dispatched_qty where request_line_id in ('${LINE_OK}', '${LINE_BUY}')`);
    expect((await call<Row>(U.pm, `proj_equipment_readiness('${PROJECT}')`)).requests.find((r: Row) => r.id === REQ)).toMatchObject({ state: "returned", units_out: 0, return_overdue: false });
    await admin(`delete from inv_import_log where project_id = '${PROJECT}'`);
    expect((await overview(U.ops)).projects).toEqual([]);
  });

  it("Chat follows the real project status: completed is read-only, archived is reported as archived, restored is live again; the closeout evidence carries the edition", async () => {
    const mine = async (who: string) => (await rows(who, `select project_status, read_only from chat_my_groups() where gid = '${GROUP}'`))[0];
    expect(await mine(U.ops)).toMatchObject({ project_status: "completed", read_only: true });
    await expect(call(U.ops, `chat_post('${GROUP}', 'x')`)).rejects.toThrow(/read-only/);
    await admin(`update proj_projects set status = 'archived' where id = '${PROJECT}'`);
    expect(await mine(U.pm)).toMatchObject({ project_status: "archived", read_only: true });
    expect(await call<string>(U.pm, `chat_project_group('${PROJECT}')`)).toBe(GROUP);        // an authorised direct link still opens it
    expect((await call<Row>(U.pm, `chat_messages('${GROUP}')`)).messages).toHaveLength(3);
    await admin(`update proj_projects set status = 'in_progress', completed_at = null where id = '${PROJECT}'`).catch(async () => { await admin(`update proj_projects set status = 'in_progress' where id = '${PROJECT}'`); });
    expect(await mine(U.pm)).toMatchObject({ project_status: "in_progress", read_only: false });
    const ev = await call<Row>(U.pm, `proj_closeout_evidence('${PROJECT}')`);
    expect(ev.project.edition).toEqual({ label: "Fictional Auto Expo · 2027 · Dubai", event_name: "Fictional Auto Expo", venue: "Expo Hall 4", city: "Dubai", start_date: "2027-03-01", end_date: "2027-03-05" });
    expect(Object.keys(await call<Row>(U.opsB, `proj_closeout_evidence('${CO.b}')`).then((e) => e.project))).not.toContain("edition");   // an unlinked project's evidence is unchanged
    await expect(call(U.ops, `proj_closeout_evidence('${PROJECT}')`)).rejects.toThrow(/not found/i);   // Operations is not the project's manager
    await expect(q(U.pm, `select proj_closeout_evidence_base('${PROJECT}')`)).rejects.toThrow(/permission denied/);
  });

  it("Sales removes the flag: the enquiry leaves Upcoming Work; the owner packs pass; rollback and re-apply work", async () => {
    await call(U.salesB, `crm_set_ops_planning('${OPP_B}', false, '{}'::jsonb, null)`);
    expect(await upcoming(U.opsB)).toEqual([]);
    expect((await admin(pack("ops_phase2b_00_preflight_readonly.sql"))).filter((r) => String(r.result).startsWith("STOP"))).toEqual([]);
    const verify = (await admin(pack("ops_phase2b_20_verify_readonly.sql"))).filter((r) => !String(r.item).startsWith("signed-in users can only READ"));
    expect(verify.filter((r) => r.result !== "OK" && r.result !== "INFO")).toEqual([]);
    expect(verify.length).toBeGreaterThanOrEqual(14);
    await db.seed(pack("ops_phase2b_90_rollback.sql"));
    await db.seed(pack("ops_phase2b_90_rollback.sql"));                                    // safe to run twice
    expect((await admin(`select to_regclass('public.ops_enquiry_planning') t, to_regprocedure('public.ops_overview(uuid)') f, to_regprocedure('public.proj_closeout_evidence_base(uuid)') b`))[0]).toEqual({ t: null, f: null, b: null });
    expect((await admin<{ c: string[] }>(`select proj_capability_list() c`))[0]!.c).not.toContain("operations");
    expect((await admin(`select to_regprocedure('public.proj_set_sales_link_base(uuid, uuid, boolean)') b, to_regprocedure('public.proj_set_sales_link(uuid, uuid, boolean)') f, to_regprocedure('public.proj_holds_assign_pm(uuid)') h`))[0]).toMatchObject({ b: null, h: null });
    expect((await rows(U.pm, `select name from chat_group_members('${GROUP}')`)).map((r) => r.name).sort()).toEqual(["member", "pm"]);
    expect((await admin(`select to_regprocedure('public.proj_assign_pm(uuid, uuid)') two, to_regprocedure('public.proj_assign_pm(uuid, uuid, text)') three, to_regprocedure('public.proj_file_contributor_guard()') g`))[0]).toMatchObject({ three: null, g: null });
    expect((await call<Row>(U.pm, `proj_closeout_evidence('${PROJECT}')`)).project.reference).toMatch(/^UAE-P-/);   // the closeout report works as before
    expect((await rows(U.pm, `select gid from chat_my_groups()`)).map((r) => r.gid)).toContain(GROUP);
    await expect(call(U.ops, `chat_project_group('${PROJECT}')`)).rejects.toThrow(/not a member/);
    await db.applyMigration("20270102000100_ops_phase2b.sql");
    await db.applyMigration("20270102000100_ops_phase2b.sql");                             // idempotent
    expect((await overview(U.founder)).company_id).toBe(CO.a);
  });
});
