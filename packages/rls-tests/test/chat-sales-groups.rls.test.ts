import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// App-wide Chat, release 1: the three Sales groups (migration 20261225000100_chat_sales_groups.sql). Proves, against a real Postgres:
//   * membership is computed from existing access only: an ACTIVE Sales grant for THAT company. Company access alone (an HR role scoped to the company) grants nothing;
//     a person with grants in all three companies is in all three groups; there is no all-company group;
//   * listing, history, posting, marking read, the member list and mentions are all enforced on the server and refuse a non-member;
//   * unread counts exclude the sender's own messages, a mention is counted separately, and a first listing starts at "nothing unread";
//   * a mention must name a CURRENT member of that group;
//   * a shared item is a reference: the sender must see it; each reader gets title and link only with their own current access, otherwise only {"restricted": true}
//     (nothing of the item leaks into the payload or the group preview);
//   * removing company access (or deactivating the person) removes the group, its history and its unread count at once, and restoring it brings the history back.

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
  "20261224000100_crm_events_outreach.sql",
  "20261225000100_chat_sales_groups.sql",
];
const id = () => randomUUID();
const CO = { uae: id(), ksa: id(), pl: id() };
const U = { all3: id(), uae: id(), ksa: id(), pl: id(), hrUae: id(), noSales: id(), founder: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@chat-test.ae')`).join(", ");

describe("Chat: the three Sales groups", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const groupsOf = async (who: string) => (await commit<{ gkey: string }>(who, `select gkey from chat_my_groups()`)).map((r) => r.gkey);
  const gid = async (key: string) => (await admin<{ id: string }>(`select id from chat_groups where key = '${key}'`))[0].id;
  const post = (who: string, group: string, body: string, extra = "") => commit<{ r: { id: string; seq: number; duplicate: boolean } }>(who, `select chat_post('${group}', '${body.replace(/'/g, "''")}'${extra}) r`).then((x) => x[0].r);
  const history = (who: string, group: string, args = "") => commit<{ r: { messages: Array<Record<string, any>>; hasMore: boolean } }>(who, `select chat_messages('${group}'${args}) r`).then((x) => x[0].r);
  const unread = async (who: string, key: string) => (await commit<{ unread: string; mentions: string }>(who, `select unread, mentions from chat_my_groups() where gkey = '${key}'`))[0];
  let uaeG: string; let ksaG: string; let plG: string; let uaeOpp: string; let acct: string; let event: string; let edition: string;

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Chat UAE', 'AE', 'AED'), ('${CO.ksa}', 'Chat KSA', 'SA', 'SAR'), ('${CO.pl}', 'Chat Poland', 'PL', 'PLN');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role, company_id) values ('${U.hrUae}', 'hr_admin', '${CO.uae}');
    `);
    for (const f of MIGRATIONS) await db.applyMigration(f);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.ksa}', '{founder}'), ('${U.founder}', '${CO.pl}', '{founder}'),
        ('${U.all3}', '${CO.uae}', '{}'), ('${U.all3}', '${CO.ksa}', '{}'), ('${U.all3}', '${CO.pl}', '{}'),
        ('${U.uae}', '${CO.uae}', '{}'), ('${U.ksa}', '${CO.ksa}', '{}'), ('${U.pl}', '${CO.pl}', '{}');
    `);
    uaeG = await gid("sales_uae"); ksaG = await gid("sales_ksa"); plG = await gid("sales_europe");
    const org = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Chat Account', p_roles => '{client}') as id`))[0].id;
    acct = org;
    uaeOpp = (await commit<{ id: string }>(U.uae, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Secret UAE stand', p_source => 'agency_call',
      p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${org}') as id`))[0].id;
    event = (await commit<{ id: string }>(U.uae, `select crm_save_event(null, 'Fictional Chat Expo', 'exhibition') as id`))[0].id;
    edition = (await commit<{ id: string }>(U.uae, `select crm_save_edition(null, '${event}', '2030-05-01', '2030-05-03', 'Dubai', 'AE') as id`))[0].id;
  });
  afterAll(async () => { await db.teardown(); });

  it("creates the three Sales groups, bound one-to-one to the company of their country (UAE, KSA, Europe = Poland) and no all-company group", async () => {
    const rows = await admin<{ key: string; company_id: string }>(`select key, company_id from chat_groups order by sort_order`);
    expect(rows.map((r) => r.key)).toEqual(["sales_uae", "sales_ksa", "sales_europe"]);
    expect(rows.map((r) => r.company_id)).toEqual([CO.uae, CO.ksa, CO.pl]);
    expect((await admin<{ name: string }>(`select name from chat_groups order by sort_order`)).map((r) => r.name)).toEqual(["Sales — UAE", "Sales — KSA", "Sales — Europe"]);
  });

  it("membership is the active Sales grant for THAT company: one company, one group; all three companies, all three groups; company access or no Sales access, none", async () => {
    expect(await groupsOf(U.uae)).toEqual(["sales_uae"]);
    expect(await groupsOf(U.ksa)).toEqual(["sales_ksa"]);
    expect(await groupsOf(U.pl)).toEqual(["sales_europe"]);
    expect(await groupsOf(U.all3)).toEqual(["sales_uae", "sales_ksa", "sales_europe"]);
    expect(await groupsOf(U.founder)).toEqual(["sales_uae", "sales_ksa", "sales_europe"]);
    expect(await groupsOf(U.hrUae)).toEqual([]);          // an HR role scoped to the UAE company is company access, not Sales access
    expect(await groupsOf(U.noSales)).toEqual([]);
    await expect(history(U.noSales, uaeG)).rejects.toThrow(/not a member/);
    await expect(history(U.hrUae, uaeG)).rejects.toThrow(/not a member/);
    await expect(post(U.noSales, uaeG, "hello")).rejects.toThrow(/not a member/);
    await expect(commit(U.noSales, `select chat_mark_read('${uaeG}', 1)`)).rejects.toThrow(/not a member/);
    await expect(commit(U.noSales, `select * from chat_group_members('${uaeG}')`)).rejects.toThrow(/not a member/);
    expect(await q(U.uae, `select id from chat_messages`)).toHaveLength(0);                                  // the tables themselves show nobody anything (RLS, no policy; hosted also has no grant)
    expect(await q(U.uae, `select group_id from chat_read_state`)).toHaveLength(0);
    await expect(q(null, `select * from chat_my_groups()`)).rejects.toThrow(/permission denied/);
  });

  it("a person cannot read or post to a group of a company they have no Sales grant for", async () => {
    await expect(history(U.uae, ksaG)).rejects.toThrow(/not a member/);
    await expect(post(U.uae, plG, "hi")).rejects.toThrow(/not a member/);
    await expect(history(U.ksa, uaeG)).rejects.toThrow(/not a member/);
  });

  it("unread: the first listing starts at zero, a sender's own messages never count, marking read clears it, and a mention is counted separately", async () => {
    expect(await unread(U.uae, "sales_uae")).toMatchObject({ unread: "0", mentions: "0" });
    expect(await unread(U.all3, "sales_uae")).toMatchObject({ unread: "0" });
    await post(U.uae, uaeG, "first message");
    expect(await unread(U.uae, "sales_uae")).toMatchObject({ unread: "0" });                 // my own
    expect(await unread(U.all3, "sales_uae")).toMatchObject({ unread: "1", mentions: "0" });
    expect(await unread(U.all3, "sales_ksa")).toMatchObject({ unread: "0" });                // another group is not affected
    const mention = await post(U.uae, uaeG, "hello @all3", `, ARRAY['${U.all3}']::uuid[]`);
    expect(await unread(U.all3, "sales_uae")).toMatchObject({ unread: "2", mentions: "1" });
    const h = await history(U.all3, uaeG);
    expect(h.messages.map((m) => m.body)).toEqual(["first message", "hello @all3"]);
    expect(h.messages[1]!.mentions).toEqual([{ userId: U.all3, name: "all3" }]);
    await commit(U.all3, `select chat_mark_read('${uaeG}', ${mention.seq})`);
    expect(await unread(U.all3, "sales_uae")).toMatchObject({ unread: "0", mentions: "0" });
    await commit(U.all3, `select chat_mark_read('${uaeG}', 1)`);                             // reading never moves backwards
    expect(await unread(U.all3, "sales_uae")).toMatchObject({ unread: "0" });
    // a retry with the same client key never posts twice
    const a = await post(U.uae, uaeG, "once", `, '{}', null, null, 'k-1'`);
    const b = await post(U.uae, uaeG, "once", `, '{}', null, null, 'k-1'`);
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(Number((await admin<{ n: string }>(`select count(*) n from chat_messages where body = 'once'`))[0].n)).toBe(1);
    // empty messages and over-long ones are refused
    await expect(post(U.uae, uaeG, "   ")).rejects.toThrow(/Write a message/);
    await expect(post(U.uae, uaeG, "x".repeat(4001))).rejects.toThrow(/4000/);
  });

  it("a mention must name a CURRENT member of that group (not a member of another group, not a person without access, not someone whose access was removed)", async () => {
    await expect(post(U.uae, uaeG, "hey @ksa", `, ARRAY['${U.ksa}']::uuid[]`)).rejects.toThrow(/current members of this group/);
    await expect(post(U.uae, uaeG, "hey @hr", `, ARRAY['${U.hrUae}']::uuid[]`)).rejects.toThrow(/current members of this group/);
    await expect(post(U.uae, uaeG, "hey", `, ARRAY['${id()}']::uuid[]`)).rejects.toThrow(/current members of this group/);
    const members = (await commit<{ name: string }>(U.uae, `select name from chat_group_members('${uaeG}')`)).map((r) => r.name);
    expect(members).toEqual(["all3", "founder", "uae"]);
    // the member list is exactly the people who may be mentioned
    expect(members).not.toContain("ksa");
  });

  it("a shared item is a reference: the sender must see it; a reader without access gets only a generic placeholder with no detail anywhere in the payload or preview", async () => {
    // the UAE-only person cannot share a KSA... and the KSA/Poland-only people cannot share a UAE enquiry
    await expect(post(U.pl, plG, "look", `, '{}', 'enquiry', '${uaeOpp}'`)).rejects.toThrow(/do not have access to that item/);
    await expect(post(U.uae, uaeG, "look", `, '{}', 'enquiry', '${id()}'`)).rejects.toThrow(/do not have access to that item/);
    await expect(post(U.uae, uaeG, "look", `, '{}', 'secret', '${uaeOpp}'`)).rejects.toThrow();
    // all3 may share the UAE enquiry into the EUROPE group, where the Poland-only member has no access to it
    const shared = await post(U.all3, plG, "", `, '{}', 'enquiry', '${uaeOpp}'`);
    expect(shared.id).toBeTruthy();
    const plView = await history(U.pl, plG);
    const msg = plView.messages.find((m) => m.id === shared.id)!;
    expect(msg.shared).toEqual({ restricted: true });
    const raw = JSON.stringify(plView);
    expect(raw).not.toMatch(/Secret UAE stand|OPP-|crm|opportunities/i);                                 // no title, reference or link anywhere in what the Poland member receives
    const preview = (await commit<{ last_preview: string }>(U.pl, `select last_preview from chat_my_groups() where gkey = 'sales_europe'`))[0].last_preview;
    expect(preview).toBe("Shared an item");
    // the same message for someone who does have access shows the title and the link
    const allView = (await history(U.all3, plG)).messages.find((m) => m.id === shared.id)!;
    expect(allView.shared).toMatchObject({ type: "enquiry", id: uaeOpp, href: `/sales/opportunities/${uaeOpp}` });
    expect(String(allView.shared.title)).toMatch(/Secret UAE stand/);
    // shared directory items (accounts, events, editions) are visible to every Sales member, as the directory already is
    for (const [type, itemId, expected] of [["account", acct, /Fictional Chat Account/], ["event", event, /Fictional Chat Expo/], ["edition", edition, /Fictional Chat Expo · 2030 · Dubai/]] as const) {
      const m = await post(U.all3, plG, "", `, '{}', '${type}', '${itemId}'`);
      const seen = (await history(U.pl, plG)).messages.find((x) => x.id === m.id)!;
      expect(String(seen.shared.title)).toMatch(expected);
      expect(seen.shared.href).toMatch(/^\/sales\//);
    }
    // an estimate follows its enquiry's company
    const prop = await admin<{ id: string }>(`insert into crm_proposals (opportunity_id, company_id, version, created_by) values ('${uaeOpp}', '${CO.uae}', 1, '${U.uae}') returning id`);
    const est = await post(U.all3, plG, "", `, '{}', 'estimate', '${prop[0].id}'`);
    expect((await history(U.pl, plG)).messages.find((x) => x.id === est.id)!.shared).toEqual({ restricted: true });
    expect((await history(U.all3, plG)).messages.find((x) => x.id === est.id)!.shared).toMatchObject({ type: "estimate", href: `/sales/opportunities/${uaeOpp}/quotations/${prop[0].id}` });
  });

  it("removing company access removes that group's history and unread count at once, blocks posting and mentions, and restoring it brings the history back", async () => {
    await post(U.pl, plG, "note from the Poland team");
    const before = await unread(U.all3, "sales_europe");
    expect(Number(before!.unread)).toBeGreaterThan(0);
    await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.all3}' and company_id = '${CO.pl}'`);
    expect(await groupsOf(U.all3)).toEqual(["sales_uae", "sales_ksa"]);                      // the Europe group disappears from the list ...
    await expect(history(U.all3, plG)).rejects.toThrow(/not a member/);                       // ... its history cannot be read ...
    await expect(post(U.all3, plG, "still here?")).rejects.toThrow(/not a member/);          // ... or posted to ...
    await expect(post(U.pl, plG, "hi @all3", `, ARRAY['${U.all3}']::uuid[]`)).rejects.toThrow(/current members of this group/);   // ... and they cannot be mentioned
    const rows = await commit<{ gkey: string }>(U.all3, `select gkey from chat_my_groups() where unread > 0 or mentions > 0`);
    expect(rows.map((r) => r.gkey)).not.toContain("sales_europe");                           // ... and no unread count remains from it
    expect((await commit<{ name: string }>(U.pl, `select name from chat_group_members('${plG}')`)).map((r) => r.name)).not.toContain("all3");
    // the other groups are untouched
    await expect(history(U.all3, uaeG)).resolves.toBeTruthy();
    // restoring access restores the group and its history
    await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.all3}' and company_id = '${CO.pl}'`);
    expect(await groupsOf(U.all3)).toContain("sales_europe");
    expect((await history(U.all3, plG)).messages.length).toBeGreaterThan(0);
    // deactivating the person removes every group
    await admin(`update profiles set is_active = false where id = '${U.all3}'`);
    expect(await groupsOf(U.all3)).toEqual([]);
    await admin(`update profiles set is_active = true where id = '${U.all3}'`);
  });
});
