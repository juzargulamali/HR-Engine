import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Chat release 2: one group per project and the transfer of the Projects Discussion (migration 20261230000100_chat_project_groups.sql). Proves, against a real Postgres:
//   * every project gets one group, named by its CURRENT reference and name;
//   * membership is active enrolment in THAT project only: a Projects grant, a founder grant, Sales access or membership of another project grants nothing;
//   * listing, previews, unread counts, history, posting, read markers, the member list and mentions refuse a non-member, and a removed or deactivated member loses all of them;
//   * Discussion messages are copied once, in order, with their authors and times; deleted ones are not; a rerun copies nothing; the first listing shows nothing unread;
//   * a message posted in the old Discussion after the migration is mirrored once; a finished project is read-only; the Sales groups behave as before;
//   * the owner packs: preflight, verify (all OK), rollback followed by release 1 restores the Sales groups and leaves the Discussion untouched.

const MIGRATION = "20261230000100_chat_project_groups.sql";
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { pm: id(), tech: id(), other: id(), founder: id(), grantOnly: id(), sales: id(), leaver: id(), newbie: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@chat-proj.ae')`).join(", ");
const PRJ = { a: id(), b: id(), done: id(), empty: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

describe("Chat: project groups and the Discussion transfer", () => {
  const db = new RlsTestDatabase();
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const groups = (who: string) => commit<Row>(who, `select * from chat_my_groups()`);
  const keys = async (who: string) => (await groups(who)).map((r) => r.gkey as string);
  const gid = async (project: string) => (await admin<{ id: string }>(`select id from chat_groups where project_id = '${project}'`))[0]!.id;
  // Row 9 of the verify pack (no table privilege) is checked on hosted; this harness grants every table to signed-in users so that row-level security is what is tested.
  const notOk = (rows: Row[]) => rows.filter((r) => r.result !== "OK" && r.result !== "INFO" && !String(r.item).startsWith("signed-in users, anon and public still have NO privilege"));
  const post = (who: string, group: string, body: string, extra = "") => commit<{ r: Row }>(who, `select chat_post('${group}', '${body.replace(/'/g, "''")}'${extra}) r`).then((x) => x[0]!.r);
  const history = (who: string, group: string) => commit<{ r: { messages: Row[] } }>(who, `select chat_messages('${group}') r`).then((x) => x[0]!.r.messages);
  const legacy = async (who: string, project: string, body: string, extra = "") => (await commit<{ v: string }>(who, `select proj_post_message('${project}', '${body}'${extra}) as v`))[0]!.v;
  let gA: string; let gB: string; let gDone: string; let m1: string; let m2: string; let m3: string; let deleted: string;

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional UAE', 'AE', 'AED'), ('${CO.ksa}', 'Fictional KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.uae}', '{}'), ('${U.tech}', '${CO.uae}', '{}'), ('${U.other}', '${CO.uae}', '{}'), ('${U.leaver}', '${CO.uae}', '{}'), ('${U.newbie}', '${CO.uae}', '{}'),
        ('${U.grantOnly}', '${CO.uae}', '{}'), ('${U.founder}', '${CO.uae}', '{founder}');
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.uae}', '{}'), ('${U.pm}', '${CO.uae}', '{}');
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${PRJ.a}', '${CO.uae}', 'UAE-P-A', 'Fictional Alpha stand', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.b}', '${CO.uae}', 'UAE-P-B', 'Fictional Beta arena', 'internal', 'in_progress', '${U.other}', '${U.other}'),
        ('${PRJ.done}', '${CO.uae}', 'UAE-P-D', 'Fictional Finished show', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.empty}', '${CO.uae}', 'UAE-P-E', 'Fictional Quiet job', 'internal', 'in_progress', '${U.pm}', '${U.pm}');
      insert into proj_project_details (project_id, scope) select id, 'LED wall' from proj_projects;
      insert into proj_project_members (project_id, user_id, role) values
        ('${PRJ.a}', '${U.pm}', 'pm'), ('${PRJ.a}', '${U.tech}', 'member'), ('${PRJ.a}', '${U.leaver}', 'member'),
        ('${PRJ.b}', '${U.other}', 'pm'),
        ('${PRJ.done}', '${U.pm}', 'pm'), ('${PRJ.done}', '${U.tech}', 'member'),
        ('${PRJ.empty}', '${U.pm}', 'pm');
    `);
    // The old Discussion, written through its own function before the migration exists.
    m1 = await legacy(U.pm, PRJ.a, "Truss arrives Monday");
    m2 = await legacy(U.tech, PRJ.a, "Noted, I will be on site", `, '${m1}', null, ARRAY['${U.pm}']::uuid[]`);
    deleted = await legacy(U.tech, PRJ.a, "Wrong thread, sorry");
    await commit(U.tech, `select proj_delete_message('${deleted}')`);
    m3 = await legacy(U.pm, PRJ.a, "Power is confirmed");
    await legacy(U.other, PRJ.b, "Beta secret plan");
    await legacy(U.pm, PRJ.done, "Final sign-off received");
    await db.seed(`
      update proj_messages set created_at = '2026-01-05 09:00+00' where id = '${m1}';
      update proj_messages set created_at = '2026-01-05 09:30+00' where id = '${m2}';
      update proj_messages set created_at = '2026-01-06 08:00+00' where id = '${m3}';
      update proj_projects set status = 'completed' where id = '${PRJ.done}';
    `);
    expect((await admin(pack("chat_project_groups_00_preflight_readonly.sql"))).filter((r) => String(r.result).startsWith("STOP"))).toEqual([]);
    await db.applyMigration(MIGRATION);
    gA = await gid(PRJ.a); gB = await gid(PRJ.b); gDone = await gid(PRJ.done);
  });
  afterAll(async () => db.teardown());

  it("gives every project exactly one group, and the verify pack says OK on every row", async () => {
    expect(Number((await admin(`select count(*) n from chat_groups where kind = 'project'`))[0]!.n)).toBe(4);
    const rows = await admin(pack("chat_project_groups_20_verify_readonly.sql"));
    expect(notOk(rows)).toEqual([]);
    expect(rows.length).toBeGreaterThan(12);
  });

  it("copies the Discussion once, in order, with the original authors and times; a deleted message is not copied; mentions come too", async () => {
    const h = await history(U.pm, gA);
    expect(h.map((m) => m.body)).toEqual(["Truss arrives Monday", "Noted, I will be on site", "Power is confirmed"]);
    expect(h.map((m) => m.senderId)).toEqual([U.pm, U.tech, U.pm]);
    expect(h.map((m) => new Date(m.createdAt).toISOString())).toEqual(["2026-01-05T09:00:00.000Z", "2026-01-05T09:30:00.000Z", "2026-01-06T08:00:00.000Z"]);
    expect(h[1]!.mentions).toEqual([{ userId: U.pm, name: "pm" }]);
    expect(JSON.stringify(h)).not.toContain("Wrong thread");
  });

  it("a rerun of the transfer, and of the whole migration, copies nothing", async () => {
    const before = Number((await admin(`select count(*) n from chat_messages`))[0]!.n);
    expect((await admin<{ n: number }>(`select chat_import_project_messages() n`))[0]!.n).toBe(0);
    await db.applyMigration(MIGRATION);
    expect(Number((await admin(`select count(*) n from chat_messages`))[0]!.n)).toBe(before);
    expect(Number((await admin(`select count(*) n from chat_groups where kind = 'project'`))[0]!.n)).toBe(4);
  });

  it("lists a member's own project groups by current reference and name, with nothing unread from the migrated history", async () => {
    const pm = await groups(U.pm);
    expect(pm.filter((g) => g.gkind === "project").map((g) => g.gname).sort()).toEqual(["UAE-P-A · Fictional Alpha stand", "UAE-P-D · Fictional Finished show", "UAE-P-E · Fictional Quiet job"]);
    expect(pm.every((g) => g.unread === "0" && g.mentions === "0")).toBe(true);
    expect(pm[0]!.gkey).toBe("sales_uae");                                          // Sales groups first, unchanged
    expect(pm.find((g) => g.project_id === PRJ.a)).toMatchObject({ last_preview: "Power is confirmed", last_sender: "pm", read_only: false });
    expect(pm.find((g) => g.project_id === PRJ.done)).toMatchObject({ read_only: true });
    const tech = await groups(U.tech);
    expect(tech.map((g) => g.project_id).sort()).toEqual([PRJ.a, PRJ.done].sort());   // a project-only member, with no Sales group
    await admin(`update proj_projects set name = 'Fictional Alpha stand (renamed)' where id = '${PRJ.a}'`);
    expect((await groups(U.tech)).find((g) => g.project_id === PRJ.a)!.gname).toBe("UAE-P-A · Fictional Alpha stand (renamed)");
  });

  it("a Projects grant, a founder grant, Sales access or another project's membership give nothing: no group, preview, unread count, history, post, read marker or member list", async () => {
    for (const who of [U.grantOnly, U.founder, U.other, U.sales]) {
      const mine = await groups(who);
      expect(mine.some((g) => g.project_id === PRJ.a)).toBe(false);
      expect(JSON.stringify(mine)).not.toContain("Power is confirmed");
      await expect(history(who, gA)).rejects.toThrow(/not a member/);
      await expect(post(who, gA, "hello")).rejects.toThrow(/not a member/);
      await expect(commit(who, `select chat_mark_read('${gA}', 1)`)).rejects.toThrow(/not a member/);
      await expect(commit(who, `select * from chat_group_members('${gA}')`)).rejects.toThrow(/not a member/);
      await expect(commit(who, `select chat_project_group('${PRJ.a}')`)).rejects.toThrow(/not a member/);
    }
    expect(await keys(U.grantOnly)).toEqual([]);
    expect(await keys(U.sales)).toEqual(["sales_uae"]);
    expect((await keys(U.other))).toEqual([`project:${PRJ.b}`]);
    await expect(history(U.tech, gB)).rejects.toThrow(/not a member/);               // a member of A cannot read B
    await expect(commit(U.tech, `select chat_project_group('${id()}')`)).rejects.toThrow(/not a member/);   // an unknown project looks the same
    await expect(db.asUser(null, async (query) => (await query(`select * from chat_my_groups()`)).rows)).rejects.toThrow(/permission denied/);
  });

  it("posting, unread and mentions work for members; a mention must name a current member of THAT project", async () => {
    const first = await post(U.tech, gA, "On site now");
    expect((await groups(U.pm)).find((g) => g.project_id === PRJ.a)).toMatchObject({ unread: "1", mentions: "0" });
    await post(U.tech, gA, "@pm please confirm power", `, ARRAY['${U.pm}']::uuid[]`);
    expect((await groups(U.pm)).find((g) => g.project_id === PRJ.a)).toMatchObject({ unread: "2", mentions: "1" });
    expect((await groups(U.pm)).find((g) => g.project_id === PRJ.done)).toMatchObject({ unread: "0" });   // another group is not affected
    await commit(U.pm, `select chat_mark_read('${gA}', ${first.seq + 1})`);
    expect((await groups(U.pm)).find((g) => g.project_id === PRJ.a)).toMatchObject({ unread: "0", mentions: "0" });
    await expect(post(U.tech, gA, "hey", `, ARRAY['${U.other}']::uuid[]`)).rejects.toThrow(/current members of this group/);
    await expect(post(U.tech, gA, "hey", `, ARRAY['${U.founder}']::uuid[]`)).rejects.toThrow(/current members of this group/);
    expect((await commit<{ name: string }>(U.tech, `select name from chat_group_members('${gA}')`)).map((r) => r.name)).toEqual(["leaver", "pm", "tech"]);
    const a = await post(U.tech, gA, "once", `, '{}', null, null, 'k-1'`);
    expect(await post(U.tech, gA, "once", `, '{}', null, null, 'k-1'`)).toMatchObject({ id: a.id, duplicate: true });
    // no project notification is written for a chat message or a mention
    expect(Number((await admin(`select count(*) n from notifications where created_at > now() - interval '1 minute' and type in ('project_mention', 'project_reply') and payload->>'message_id' = '${a.id}'`))[0]!.n)).toBe(0);
  });

  it("adding someone to the project gives them the group; removing them, revoking their Projects access or deactivating them takes it away at once", async () => {
    expect(await keys(U.newbie)).toEqual([]);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${PRJ.a}', '${U.newbie}', 'member')`);
    expect(await keys(U.newbie)).toEqual([`project:${PRJ.a}`]);
    expect((await groups(U.newbie))[0]).toMatchObject({ unread: "0" });               // history is not a flood of unread
    expect((await history(U.newbie, gA)).length).toBeGreaterThan(3);

    expect((await groups(U.leaver))[0]).toMatchObject({ unread: "0" });
    await post(U.pm, gA, "@leaver are you there", `, ARRAY['${U.leaver}']::uuid[]`);
    expect((await groups(U.leaver))[0]).toMatchObject({ unread: "1", mentions: "1" });
    await admin(`update proj_project_members set removed_at = now() where project_id = '${PRJ.a}' and user_id = '${U.leaver}'`);
    expect(await groups(U.leaver)).toEqual([]);                                      // group, preview and unread count are gone
    await expect(history(U.leaver, gA)).rejects.toThrow(/not a member/);
    await expect(post(U.leaver, gA, "still here?")).rejects.toThrow(/not a member/);
    await expect(commit(U.leaver, `select chat_mark_read('${gA}', 1)`)).rejects.toThrow(/not a member/);
    await expect(post(U.pm, gA, "@leaver", `, ARRAY['${U.leaver}']::uuid[]`)).rejects.toThrow(/current members of this group/);

    await admin(`update proj_company_grants set revoked_at = now() where user_id = '${U.newbie}'`);        // still enrolled, no longer eligible
    expect(await keys(U.newbie)).toEqual([]);
    await expect(history(U.newbie, gA)).rejects.toThrow(/not a member/);
    await admin(`update proj_company_grants set revoked_at = null where user_id = '${U.newbie}'`);
    expect(await keys(U.newbie)).toEqual([`project:${PRJ.a}`]);
    await admin(`update profiles set is_active = false where id = '${U.newbie}'`);
    expect(await keys(U.newbie)).toEqual([]);
    await expect(post(U.newbie, gA, "hi")).rejects.toThrow(/not a member/);
  });

  it("a finished project's conversation can be read but not written; a finished project with no messages is not listed", async () => {
    expect((await history(U.tech, gDone)).map((m) => m.body)).toEqual(["Final sign-off received"]);
    await expect(post(U.tech, gDone, "one more thing")).rejects.toThrow(/read-only/);
    await admin(`update proj_projects set status = 'completed' where id = '${PRJ.empty}'`);
    expect((await groups(U.pm)).some((g) => g.project_id === PRJ.empty)).toBe(false);
    await admin(`update proj_projects set status = 'in_progress' where id = '${PRJ.empty}'`);
    expect((await groups(U.pm)).some((g) => g.project_id === PRJ.empty)).toBe(true);
  });

  it("a message posted in the OLD Discussion after the migration is mirrored once, with its mention, and counts as unread for the others", async () => {
    const top = (await admin<{ s: string }>(`select max(seq) s from chat_messages where group_id = '${gA}'`))[0]!.s;
    await commit(U.tech, `select chat_mark_read('${gA}', ${top})`);
    const late = await legacy(U.pm, PRJ.a, "Posted from the old tab", `, null, null, ARRAY['${U.tech}']::uuid[]`);
    const copies = await admin(`select id, sender_id from chat_messages where source = 'proj_messages' and source_id = '${late}'`);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.sender_id).toBe(U.pm);
    expect((await groups(U.tech)).find((g) => g.project_id === PRJ.a)).toMatchObject({ unread: "1", mentions: "1", last_preview: "Posted from the old tab" });
    expect((await admin<{ n: number }>(`select chat_import_project_messages('${PRJ.a}') n`))[0]!.n).toBe(0);
    expect(notOk(await admin(pack("chat_project_groups_20_verify_readonly.sql")))).toEqual([]);
  });

  it("a new project gets its group when a member first lists their groups or asks for it; deleting a project removes its group and messages", async () => {
    const p = id();
    await admin(`insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values ('${p}', '${CO.uae}', 'UAE-P-N', 'Fictional New job', 'internal', 'planning', '${U.tech}', '${U.tech}');
                 insert into proj_project_members (project_id, user_id, role) values ('${p}', '${U.tech}', 'pm');`);
    const g = (await commit<{ g: string }>(U.tech, `select chat_project_group('${p}') g`))[0]!.g;
    expect((await groups(U.tech)).find((x) => x.project_id === p)).toMatchObject({ gid: g, gname: "UAE-P-N · Fictional New job" });
    await post(U.tech, g, "hello");
    await admin(`delete from proj_project_members where project_id = '${p}'; delete from proj_projects where id = '${p}';`);
    expect(Number((await admin(`select count(*) n from chat_messages where group_id = '${g}'`))[0]!.n)).toBe(0);
    expect(Number((await admin(`select count(*) n from chat_groups where id = '${g}'`))[0]!.n)).toBe(0);
  });

  it("Sales groups still work as before for a Sales member, and a project member cannot read them", async () => {
    const sg = (await admin<{ id: string }>(`select id from chat_groups where key = 'sales_uae'`))[0]!.id;
    await post(U.sales, sg, "Sales hello");
    expect((await groups(U.pm)).find((g) => g.gkey === "sales_uae")).toMatchObject({ unread: "1", gkind: "sales", read_only: false, project_id: null });
    expect((await history(U.pm, sg)).map((m) => m.body)).toEqual(["Sales hello"]);
    await expect(history(U.tech, sg)).rejects.toThrow(/not a member/);
    expect((await commit<{ name: string }>(U.sales, `select name from chat_group_members('${sg}')`)).map((r) => r.name)).toEqual(["pm", "sales"]);
  });

  it("rollback, then release 1 again: the Sales groups and their messages are back as they were, the project groups are gone and the Discussion is untouched", async () => {
    const discussion = Number((await admin(`select count(*) n from proj_messages`))[0]!.n);
    await db.seed(pack("chat_project_groups_90_rollback.sql"));
    await db.seed(pack("chat_project_groups_90_rollback.sql"));                       // safe to run twice
    await db.applyMigration("20261225000100_chat_sales_groups.sql");
    expect(await keys(U.sales)).toEqual(["sales_uae"]);
    expect(await keys(U.tech)).toEqual([]);
    expect(Number((await admin(`select count(*) n from chat_groups`))[0]!.n)).toBe(3);
    expect(Number((await admin(`select count(*) n from chat_messages where body = 'Sales hello'`))[0]!.n)).toBe(1);
    expect(Number((await admin(`select count(*) n from proj_messages`))[0]!.n)).toBe(discussion);
    await legacy(U.pm, PRJ.a, "The old Discussion still works");                     // no mirror trigger is left behind
    // and forward again: the migration re-creates the groups and copies the whole Discussion once more
    await db.applyMigration(MIGRATION);
    expect((await history(U.pm, await gid(PRJ.a))).map((m) => m.body)).toContain("The old Discussion still works");
    expect(notOk(await admin(pack("chat_project_groups_20_verify_readonly.sql")))).toEqual([]);
  });
});
