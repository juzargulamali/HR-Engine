import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: an event added TOGETHER with its first edition (migration 20261227000100_crm_event_first_edition.sql). Proves, against a real Postgres:
//   * one call adds both rows, recorded against the person who added them, with the existing rules (any Sales grant; no grant refused);
//   * BOTH parts are checked and a refusal of either part writes NOTHING: a bad edition never leaves an event without an edition (no orphan);
//   * the duplicate rule is the existing one (a live event with the same name is refused whatever the spelling; an archived one does not block the name);
//   * a later edition is added to the same event with the existing function, and the first edition is untouched;
//   * signed-in users can call it; anon cannot; the tables stay closed to direct writes.

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
  "20261224000100_crm_events_outreach.sql",
  "20261227000100_crm_event_first_edition.sql",
];
const id = () => randomUUID();
const CO = { uae: id() };
const U = { sara: id(), omar: id(), hr: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@first-edition-test.ae')`).join(", ");

describe("An event with its first edition, in one transaction", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const counts = async () => (await admin<{ events: string; editions: string }>(`select (select count(*) from crm_events)::text as events, (select count(*) from crm_event_editions)::text as editions`))[0];
  const add = (user: string, args: string) => commit<{ r: { event_id: string; edition_id: string } }>(user, `select crm_add_event_with_edition(${args}) as r`);

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hr}', 'hr_admin');
    `);
    for (const f of MIGRATIONS) await db.applyMigration(f);
    await db.seed(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}');`);
  }, 120_000);
  afterAll(async () => { await db.teardown(); });

  let event: string; let first: string;

  it("adds the event and its first edition in one call, recorded against the person who added them", async () => {
    const r = (await add(U.sara, `'  Fictional Tech Week ', 'conference', '2027-03-30', '2027-04-02', ' Riyadh ', 'sa', 'Fictional Hall', null, null, 'first one'`))[0].r;
    event = r.event_id; first = r.edition_id;
    const ev = (await admin<{ name: string; kind: string; created_by: string }>(`select name, kind, created_by from crm_events where id = '${event}'`))[0];
    expect(ev).toEqual({ name: "Fictional Tech Week", kind: "conference", created_by: U.sara });
    const ed = (await admin<{ event_id: string; s: string; e: string; city: string; country_code: string; venue: string; note: string; created_by: string }>(
      `select event_id, start_date::text as s, end_date::text as e, city, country_code, venue, note, created_by from crm_event_editions where id = '${first}'`))[0];
    expect(ed).toEqual({ event_id: event, s: "2027-03-30", e: "2027-04-02", city: "Riyadh", country_code: "SA", venue: "Fictional Hall", note: "first one", created_by: U.sara });
    expect(await counts()).toEqual({ events: "1", editions: "1" });
  });

  it("a refused edition leaves NO event behind: bad dates, a missing date and a bad country write nothing", async () => {
    await expect(add(U.sara, `'Fictional Orphan Show', 'exhibition', '2027-06-10', '2027-06-08'`)).rejects.toThrow(/end date/);
    await expect(add(U.sara, `'Fictional Orphan Show', 'exhibition', null, '2027-06-08'`)).rejects.toThrow(/start and end dates/);
    await expect(add(U.sara, `'Fictional Orphan Show', 'exhibition', '2027-06-08', '2027-06-10', null, 'UAE'`)).rejects.toThrow(/two-letter/);
    expect((await admin<{ n: string }>(`select count(*)::text as n from crm_events where name = 'Fictional Orphan Show'`))[0].n).toBe("0");
    expect(await counts()).toEqual({ events: "1", editions: "1" });
  });

  it("a refused event part writes nothing either: no name, a bad kind, a duplicate name in any spelling", async () => {
    await expect(add(U.sara, `'  ', 'exhibition', '2027-06-08', '2027-06-10'`)).rejects.toThrow(/event name/);
    await expect(add(U.sara, `'Fictional Party', 'party', '2027-06-08', '2027-06-10'`)).rejects.toThrow(/exhibition, conference or other/);
    await expect(add(U.omar, `' fictional TECH-week ', 'exhibition', '2028-03-01', '2028-03-03'`)).rejects.toThrow(/already exists/);
    expect(await counts()).toEqual({ events: "1", editions: "1" });
  });

  it("a failure INSIDE the second write undoes the first: the whole call is one transaction", async () => {
    // Force the edition insert itself to fail after the event insert has run, then prove the event insert was undone.
    await db.seed(`
      create function test_refuse_edition() returns trigger language plpgsql as $$ begin raise exception 'edition refused for the test'; end; $$;
      create trigger test_refuse_edition before insert on crm_event_editions for each row execute function test_refuse_edition();
    `);
    try {
      await expect(add(U.sara, `'Fictional Half Saved', 'exhibition', '2027-08-01', '2027-08-02'`)).rejects.toThrow(/edition refused for the test/);
    } finally {
      await db.seed(`drop trigger test_refuse_edition on crm_event_editions; drop function test_refuse_edition();`);
    }
    expect((await admin<{ n: string }>(`select count(*)::text as n from crm_events where name = 'Fictional Half Saved'`))[0].n).toBe("0");
    expect(await counts()).toEqual({ events: "1", editions: "1" });
  });

  it("is refused without a Sales grant and for anon; the tables stay closed to direct writes", async () => {
    await expect(add(U.hr, `'Fictional No Grant', 'exhibition', '2027-06-08', '2027-06-10'`)).rejects.toThrow(/Sales access|No CRM access/i);
    const priv = (await admin<{ auth: boolean; anon: boolean; ins: boolean }>(`select
      has_function_privilege('authenticated', 'crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)', 'execute') as auth,
      has_function_privilege('anon', 'crm_add_event_with_edition(text, text, date, date, text, text, text, text, text, text)', 'execute') as anon,
      has_table_privilege('authenticated', 'crm_events', 'insert') or has_table_privilege('authenticated', 'crm_event_editions', 'insert') as ins`))[0];
    expect(priv).toEqual({ auth: true, anon: false, ins: false });
    expect(await counts()).toEqual({ events: "1", editions: "1" });
  });

  it("a later edition is added to the SAME event with the existing function and the first edition is untouched", async () => {
    const later = (await commit<{ id: string }>(U.omar, `select crm_save_edition(null, '${event}', '2028-03-28', '2028-03-31', 'Riyadh', 'SA') as id`))[0].id;
    const rows = await admin<{ id: string; s: string }>(`select id, start_date::text as s from crm_event_editions where event_id = '${event}' order by start_date`);
    expect(rows).toEqual([{ id: first, s: "2027-03-30" }, { id: later, s: "2028-03-28" }]);
    await expect(commit(U.omar, `select crm_save_edition(null, '${event}', '2027-03-30', '2027-04-01')`)).rejects.toThrow(/already has an edition/);
    expect(await counts()).toEqual({ events: "1", editions: "2" });
  });

  it("an archived event does not block its name: the name can be added again with a new first edition", async () => {
    await commit(U.sara, `select crm_archive_event('${event}')`);
    const again = (await add(U.omar, `'Fictional Tech Week', 'conference', '2029-03-27', '2029-03-30'`))[0].r;
    expect(again.event_id).not.toBe(event);
    expect(await counts()).toEqual({ events: "2", editions: "3" });
  });
});
