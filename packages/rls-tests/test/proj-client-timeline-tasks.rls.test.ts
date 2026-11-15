import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Individual tasks on a client timeline (migration 20270113000100_proj_client_timeline_tasks.sql), against a real Postgres. Fictional data throughout.
//   * nothing is chosen by default; a task is on the timeline only by explicit choice of someone who may issue (Project Manager, temporary leadership, founder);
//   * the payload is built from an ALLOWLIST in SQL: secret strings planted in every internal field of a task appear nowhere in the preview, the issued version or any read;
//   * a member and a summary-only person can neither choose, preview nor issue, and cannot read the choice;
//   * applying the migration changes no existing payload or hash (an issued version does not turn outdated), and issuing a new version never rewrites an old one;
//   * the checked issue refuses when the content is no longer the preview; the owner pack (verify, rollback) behaves as documented.

const MIGRATION = "20270113000100_proj_client_timeline_tasks.sql";
const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { pm: id(), founder: id(), member: id(), summary: id(), outsider: id(), acting: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@cttest.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const SECRET = {
  title: "SECRET-INTERNAL-TITLE", description: "SECRET-DESCRIPTION", blocked: "SECRET-BLOCKED-REASON", unblock: "SECRET-UNBLOCK-ACTION", output: "SECRET-OUTPUT-LABEL", comment: "SECRET-COMMENT-BODY",
  file: "SECRET-FILE-NAME.pdf", cost: "SECRET-COST-250000", mail: "secret.assignee.mail", name: "Secret Assignee Fullname", other: "SECRET-UNCHOSEN-TASK", note: "SECRET-ISSUE-NOTE",
};

describe("Client timeline: individual tasks by explicit choice, from an allowlist", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const rows = async <T = Row>(user: string, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  let P = "", INT = "", PB = "", T1 = "", T2 = "", T3 = "", TCancelled = "", TOther = "", M1 = "", v1 = "", hashBefore = "", payloadBefore = "";

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      update profiles set full_name = '${SECRET.name}', email = '${SECRET.mail}@cttest.ae' where id = '${U.member}';
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.a}', '{}'), ('${U.founder}', '${CO.a}', '{founder}'), ('${U.member}', '${CO.a}', '{}'),
        ('${U.summary}', '${CO.a}', '{}'), ('${U.acting}', '${CO.a}', '{}'), ('${U.outsider}', '${CO.b}', '{founder}');
    `);
    const proj = async (ref: string, name: string, kind: string, company = CO.a, pm = U.pm) => {
      let opp = "null";
      if (kind === "client") {
        const org = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional client of ${ref}', 'client') returning id`))[0]!.id;
        opp = `'${(await admin<{ id: string }>(`insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, stage, currency, client_org_id)
          values ('${company}', 'OPP-${ref}', 'Fictional enquiry ${ref}', 'website', '${pm}', '${pm}', 'qualified', 'AED', '${org}') returning id`))[0]!.id}'`;
      }
      const p = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by, crm_opportunity_id) values ('${company}', '${ref}', '${name}', '${kind}', 'in_progress', '${pm}', '${pm}', ${opp}) returning id`))[0]!.id;
      await admin(`insert into proj_project_details (project_id, client_name, location, site_timezone, scope, technologies) values ('${p}', 'Fictional Orbit Motors', 'Fictional Hall 3', 'Asia/Dubai', '${SECRET.cost}', '[]'::jsonb)`);
      await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${pm}', 'pm')${company === CO.a ? `, ('${p}', '${U.member}', 'member'), ('${p}', '${U.acting}', 'member')` : ""}`);
      return p;
    };
    P = await proj("UAE-P-2099-0501", "Fictional client stand", "client");
    INT = await proj("UAE-P-2099-0502", "Fictional internal job", "internal");
    PB = await proj("OTH-P-2099-0501", "Fictional other company stand", "client", CO.b, U.outsider);
    const task = async (p: string, title: string, extra = "") =>
      (await admin<{ id: string }>(`insert into proj_tasks (project_id, title, description, assignee_id, start_date, due_date, created_by, priority${extra ? ", status" : ""})
        values ('${p}', '${title}', '${SECRET.description}', '${U.member}', '2099-03-01', '2099-03-05', '${U.pm}', 'urgent'${extra ? `, '${extra}'` : ""}) returning id`))[0]!.id;
    T1 = await task(P, `${SECRET.title} one`);
    T2 = await task(P, `${SECRET.title} two`);
    T3 = await task(P, `${SECRET.title} three`);
    TCancelled = await task(P, `${SECRET.title} cancelled`, "cancelled");
    TOther = await task(PB, SECRET.other);
    // every internal field of T1 carries a recognisable secret
    await admin(`update proj_tasks set blocked_at = now(), blocked_reason = '${SECRET.blocked}', unblock_action = '${SECRET.unblock}', output_label = '${SECRET.output}', status = 'in_progress' where id = '${T1}'`);
    await admin(`update proj_tasks set start_date = null where id = '${T2}'`);
    await admin(`insert into proj_task_events (task_id, project_id, kind, note, actor_id) values ('${T1}', '${P}', 'comment', '${SECRET.comment}', '${U.member}')`).catch(() => null);
    await admin(`insert into proj_files (project_id, kind, label, url, purpose, created_by) values ('${P}', 'link', '${SECRET.file}', 'https://example.invalid/${SECRET.file}', 'document', '${U.pm}')`).catch(() => null);
    M1 = (await admin<{ id: string }>(`insert into proj_milestones (project_id, title, due_date, client_facing, created_by) values ('${P}', 'Design sign-off', '2099-02-20', true, '${U.pm}') returning id`))[0]!.id;
    // BEFORE the migration: a version is issued and the live payload is remembered
    v1 = await call<string>(U.pm, `proj_issue_plan('${P}', null, '${SECRET.note}')`);
    const [b] = await admin<Row>(`select payload::text as t, payload_hash as h from proj_issued_plans where id = '${v1}'`);
    payloadBefore = b!.t; hashBefore = b!.h;
    expect((await admin<Row>(`select md5(proj_build_plan_payload('${P}')::text) as h`))[0]!.h).toBe(hashBefore);
    await db.applyMigration(MIGRATION);
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8"));
    // the migration's own privileges are what counts on hosted: re-apply them after the blanket test grant
    await db.applyMigration(MIGRATION);
  }, 240_000);
  afterAll(async () => db.teardown());

  it("applying the migration (twice) changes no payload: the issued version is byte for byte the same and is not outdated", async () => {
    const [a] = await admin<Row>(`select payload::text as t, payload_hash as h from proj_issued_plans where id = '${v1}'`);
    expect(a!.t).toBe(payloadBefore);
    expect(a!.h).toBe(hashBefore);
    expect((await admin<Row>(`select md5(proj_build_plan_payload('${P}')::text) as h, proj_build_plan_payload('${P}') ? 'tasks' as has`))[0]).toEqual({ h: hashBefore, has: false });
    expect(await call<boolean>(U.pm, `proj_plan_outdated('${P}')`)).toBe(false);
    expect((await call<Row>(U.pm, `proj_plan_preview('${P}')`)).hash).toBe(hashBefore);
  });

  it("nothing is chosen by default, and only someone who may issue can choose, preview or read the choice", async () => {
    expect(await admin(`select 1 from proj_client_timeline_tasks`)).toHaveLength(0);
    const pick = j([{ task_id: T1, client_title: "Screen content ready" }]);
    for (const who of [U.member, U.acting]) expect(await code(call(who, `proj_set_client_timeline_tasks('${P}', ${pick})`)), who).toBe("42501");
    for (const who of [U.summary, U.outsider]) expect(await code(call(who, `proj_set_client_timeline_tasks('${P}', ${pick})`)), who).toMatch(/P0002|42501/);
    for (const who of [U.member, U.summary, U.outsider]) {
      expect(await call(who, `proj_plan_preview('${P}')`), who).toBeNull();
      expect(await code(call(who, `proj_issue_plan_checked('${P}', '${hashBefore}', null, null)`)), who).toMatch(/P0002|42501/);
      expect(await code(call(who, `proj_issue_plan('${P}')`)), who).toMatch(/P0002|42501/);
    }
    // direct writes are refused for everyone, the manager included
    for (const who of [U.pm, U.founder, U.member]) {
      expect(await code(rows(who, `insert into proj_client_timeline_tasks (task_id, project_id, client_title, selected_by) values ('${T1}', '${P}', 'x', '${who}')`)), who).toBe("42501");
    }
    // the internal builders are not callable from a session
    expect(await code(call(U.pm, `proj_build_plan_payload('${P}')`))).toBe("42501");
    expect(await code(call(U.pm, `proj_client_timeline_tasks_json('${P}')`))).toBe("42501");
    expect(await admin(`select 1 from proj_client_timeline_tasks`)).toHaveLength(0);
  });

  it("the choice is validated: this project's own tasks, not cancelled, each with a client title, a list of at most 100", async () => {
    expect(await code(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: TOther, client_title: "x" }])})`))).toBe("P0002");
    expect(await code(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: TCancelled, client_title: "x" }])})`))).toBe("23514");
    await expect(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T1, client_title: "  " }])})`)).rejects.toThrow(/title the client will see/);
    await expect(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T1 }])})`)).rejects.toThrow(/title the client will see/);
    await expect(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: "nope", client_title: "x" }])})`)).rejects.toThrow(/not valid/);
    await expect(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j({ all: true })})`)).rejects.toThrow(/as a list/);
    await expect(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j(Array.from({ length: 101 }, () => ({ task_id: T1, client_title: "x" })))})`)).rejects.toThrow(/at most 100/);
    expect(await code(call(U.pm, `proj_set_client_timeline_tasks('${INT}', ${j([])})`))).toBe("23514");
    expect(await admin(`select 1 from proj_client_timeline_tasks`)).toHaveLength(0);
  });

  it("the preview and the issued version carry ONLY the allowlisted fields of the chosen tasks; no planted secret appears anywhere", async () => {
    const r = await call<Row>(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T1, client_title: "Screen content ready" }, { task_id: T2, client_title: "  Stand graphics approved " }])})`);
    expect(r).toMatchObject({ added: 2, changed: 0, removed: 0, chosen: 2 });
    // saving the same choice again changes nothing
    expect(await call<Row>(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T1, client_title: "Screen content ready" }, { task_id: T2, client_title: "Stand graphics approved" }])})`)).toMatchObject({ added: 0, changed: 0, removed: 0 });
    const prev = await call<Row>(U.pm, `proj_plan_preview('${P}')`);
    expect(prev.payload.tasks).toEqual([
      { title: "Screen content ready", start_date: "2099-03-01", due_date: "2099-03-05", status: "In progress" },
      { title: "Stand graphics approved", start_date: null, due_date: "2099-03-05", status: "Planned" },
    ]);
    for (const t of prev.payload.tasks as Row[]) expect(Object.keys(t).sort()).toEqual(["due_date", "start_date", "status", "title"]);
    expect(Object.keys(prev.payload).sort()).toEqual(["delivery", "dependencies", "milestones", "project", "site", "tasks"]);
    expect(await call<boolean>(U.pm, `proj_plan_outdated('${P}')`)).toBe(true);
    expect(await call<Row>(U.pm, `proj_current_plan_payload('${P}')`)).toEqual(prev.payload);      // the read the deployed app uses shows the same thing
    const v2 = await call<string>(U.pm, `proj_issue_plan_checked('${P}', '${prev.hash}', 'ACME-REF-7', '${SECRET.note}')`);
    const [issued] = await admin<Row>(`select payload, payload::text as t, payload_hash, version, title, client_reference, tz from proj_issued_plans where id = '${v2}'`);
    expect(issued!.payload).toEqual(prev.payload);
    expect(issued!.payload_hash).toBe(prev.hash);
    expect(issued!.version).toBe(2);
    const everything = JSON.stringify(prev) + issued!.t + issued!.title + issued!.client_reference + JSON.stringify(await rows(U.member, `select payload, title, client_reference, tz from proj_issued_plans where project_id = '${P}'`));
    for (const [k, s] of Object.entries(SECRET)) if (k !== "note") expect(everything.includes(s), k).toBe(false);
    expect(everything).not.toContain(U.member);                          // no assignee id either
    expect(everything).not.toMatch(/urgent|blocked|assignee|priority|description|output/i);
    // a member reads the issued version (as before) but not the choice behind it
    expect(await rows(U.member, `select 1 from proj_issued_plans where id = '${v2}'`)).toHaveLength(1);
    expect(await rows(U.member, `select 1 from proj_client_timeline_tasks`)).toHaveLength(0);
    expect(await rows(U.summary, `select 1 from proj_client_timeline_tasks`)).toHaveLength(0);
    expect(await rows(U.outsider, `select 1 from proj_client_timeline_tasks`)).toHaveLength(0);
    expect(await rows(U.pm, `select 1 from proj_client_timeline_tasks`)).toHaveLength(2);
    expect(await rows(U.founder, `select 1 from proj_client_timeline_tasks`)).toHaveLength(2);
  });

  it("issuing a new version never rewrites an old one: version 1 (no tasks) is byte for byte what it was, and cannot be changed", async () => {
    const [a] = await admin<Row>(`select payload::text as t, payload_hash as h, superseded_at, note from proj_issued_plans where id = '${v1}'`);
    expect(a!.t).toBe(payloadBefore);
    expect(a!.h).toBe(hashBefore);
    expect(a!.superseded_at).not.toBeNull();
    expect(a!.t).not.toContain("tasks");
    await expect(admin(`update proj_issued_plans set payload = payload || '{"tasks": []}'::jsonb where id = '${v1}'`)).rejects.toThrow(/cannot be changed/);
    await expect(admin(`delete from proj_issued_plans where id = '${v1}'`)).rejects.toThrow(/cannot be deleted/);
  });

  it("the checked issue refuses when the content changed after the preview, and issues nothing; the same content twice returns the same version", async () => {
    const prev = await call<Row>(U.pm, `proj_plan_preview('${P}')`);
    const same = await call<string>(U.pm, `proj_issue_plan_checked('${P}', '${prev.hash}', null, null)`);
    expect((await admin<Row>(`select version from proj_issued_plans where id = '${same}'`))[0]!.version).toBe(2);
    await admin(`update proj_tasks set status = 'done', completed_at = now(), completed_by = '${U.member}', blocked_at = null, blocked_reason = null, unblock_action = null where id = '${T1}'`);
    expect(await code(call(U.pm, `proj_issue_plan_checked('${P}', '${prev.hash}', null, null)`))).toBe("23514");
    await expect(call(U.pm, `proj_issue_plan_checked('${P}', '${prev.hash}', null, null)`)).rejects.toThrow(/changed after you opened the preview/);
    expect(await code(call(U.pm, `proj_issue_plan_checked('${P}', '', null, null)`))).toBe("22023");
    expect((await admin<Row>(`select count(*)::int as n from proj_issued_plans where project_id = '${P}'`))[0]!.n).toBe(2);
    expect(await call<boolean>(U.pm, `proj_plan_outdated('${P}')`)).toBe(true);
    const next = await call<Row>(U.pm, `proj_plan_preview('${P}')`);
    expect((next.payload.tasks as Row[]).find((t) => t.title === "Screen content ready")!.status).toBe("Done");
  });

  it("a cancelled or deleted task leaves the timeline; clearing the choice removes the tasks key; a timeline of tasks alone can be issued", async () => {
    await admin(`update proj_tasks set status = 'cancelled' where id = '${T2}'`);
    expect(((await call<Row>(U.pm, `proj_plan_preview('${P}')`)).payload.tasks as Row[]).map((t) => t.title)).toEqual(["Screen content ready"]);
    expect(await call<Row>(U.founder, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T3, client_title: "Final checks" }])})`)).toMatchObject({ added: 1, removed: 2, chosen: 1 });
    await admin(`update proj_milestones set client_facing = false where id = '${M1}'`);
    const only = await call<Row>(U.pm, `proj_plan_preview('${P}')`);
    expect(only.payload.milestones).toEqual([]);
    expect(only.payload.tasks).toHaveLength(1);
    const v3 = await call<string>(U.pm, `proj_issue_plan('${P}', null, null)`);                       // the deployed app's call still works
    expect((await admin<Row>(`select version from proj_issued_plans where id = '${v3}'`))[0]!.version).toBe(3);
    await call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([])})`);
    const none = await call<Row>(U.pm, `proj_plan_preview('${P}')`);
    expect("tasks" in none.payload).toBe(false);
    await expect(call(U.pm, `proj_issue_plan('${P}', null, null)`)).rejects.toThrow(/Mark at least one/);
    await admin(`update proj_milestones set client_facing = true where id = '${M1}'`);
    expect((await call<Row>(U.pm, `proj_plan_preview('${P}')`)).hash).toBe(hashBefore);                // back to exactly the first payload
    // a finished project is read-only
    await admin(`update proj_projects set status = 'completed' where id = '${P}'`);
    expect(await code(call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T3, client_title: "x" }])})`))).toBe("23514");
    await admin(`update proj_projects set status = 'in_progress' where id = '${P}'`);
  });

  it("the owner pack: verify is all OK, the rollback stops while a task is chosen and then restores the previous functions", async () => {
    const verify = await admin<{ item: string; result: string }>(manual("proj_client_timeline_tasks_20_verify_readonly.sql"));
    expect(verify.slice(0, 5).map((r) => r.result)).toEqual(["OK", "OK", "OK", "OK", "OK"]);
    const pre = await admin<{ item: string; result: string }>(manual("proj_client_timeline_tasks_00_preflight_readonly.sql").split("-- Ambiguous records")[0]!);
    expect(pre.slice(0, 3).map((r) => r.result)).toEqual(["OK", "OK", "already installed"]);
    await call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([{ task_id: T3, client_title: "Final checks" }])})`);
    await expect(db.seed(manual("proj_client_timeline_tasks_90_rollback.sql"))).rejects.toThrow(/STOP: 1 task/);
    await call(U.pm, `proj_set_client_timeline_tasks('${P}', ${j([])})`);
    await db.seed(manual("proj_client_timeline_tasks_90_rollback.sql"));
    await db.seed(manual("proj_client_timeline_tasks_90_rollback.sql"));                                // safe to run twice
    expect((await admin<Row>(`select to_regclass('public.proj_client_timeline_tasks') as t, to_regprocedure('public.proj_plan_preview(uuid)') as f`))[0]).toEqual({ t: null, f: null });
    expect((await admin<Row>(`select md5(proj_build_plan_payload('${P}')::text) as h`))[0]!.h).toBe(hashBefore);
    expect((await admin<Row>(`select count(*)::int as n from proj_issued_plans where project_id = '${P}'`))[0]!.n).toBe(3);   // no issued version was deleted
    expect((await admin<Row>(`select payload::text as t from proj_issued_plans where id = '${v1}'`))[0]!.t).toBe(payloadBefore);
    await call(U.pm, `proj_issue_plan('${P}', null, null)`);                                           // the restored function works for the manager
  });
});
