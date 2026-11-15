import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales follow-ups: a time zone per company (migration 20270112000500_crm_follow_up_time_zone.sql), against a real Postgres.
//   * every existing company gets Asia/Dubai and no follow-up due moment changes when the migration is applied, or when a zone is changed later;
//   * only the people who manage Sales settings change the zone, of their own company; a named zone only (no fixed offset, no abbreviation);
//   * the settings function the deployed app calls still works and keeps the zone;
//   * reminder boundaries: a follow-up's reminder fires at its stored moment whatever the company's zone (00:15 Warsaw on the spring-forward night included),
//     never before, and the overdue reminder 24 hours later; the same run on the Dubai company behaves as before;
//   * the owner pack: the fingerprint of due moments is identical before and after; the rollback stops while a company is not on Asia/Dubai, then runs twice.

const id = () => randomUUID();
const CO = { uae: id(), pl: id() };
const U = { founder: id(), plManager: id(), sara: id(), piotr: id(), nogrant: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@tz-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = path.join(__dirname, "../../..");
const pack = (f: string) => readFileSync(path.join(ROOT, "supabase/manual-sql", f), "utf8");
const MIGRATION = "20270112000500_crm_follow_up_time_zone.sql";
const fingerprint = (rows: { item: string; result: string }[]) => rows.find((r) => /fingerprint of every follow-up due moment/.test(r.item))!.result;

describe("Follow-up time zone per company", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const zone = async (company: string) => (await admin(`select follow_up_time_zone z from crm_company_settings where company_id = '${company}'`))[0]!.z as string;
  const dueMoments = () => admin(`select id, extract(epoch from due_at)::bigint e from crm_follow_ups order by id`).then((r) => JSON.stringify(r));
  let ORG = "", OPP_PL = "", OPP_UAE = "", F_PL = "", F_UAE = "";

  beforeAll(async () => {
    // Built up to (not including) the migration, with follow-ups already saved, so the migration is proved against existing data.
    await db.setupBefore(MIGRATION);
    await db.seed(readFileSync(path.join(ROOT, "supabase/tests/grant-authenticated-access.sql"), "utf8"));
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional UAE', 'AE', 'AED'), ('${CO.pl}', 'Fictional Polska', 'PL', 'PLN');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.pl}', 'POL', 'PLN') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.pl}', '{founder}'),
        ('${U.plManager}', '${CO.pl}', '{manage_settings}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.piotr}', '${CO.pl}', '{}');
    `);
    ORG = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Agency', 'agency') returning id`))[0]!.id;
    // The Warsaw follow-up is due at 00:15 Warsaw on Sunday 28 March 2027, the night the clocks go forward there (= 23:15 UTC on the 27th = 03:15 Dubai on the 28th).
    OPP_PL = await call<string>(U.piotr, `crm_create_opportunity(p_company_id => '${CO.pl}', p_title => 'Warsaw stand', p_source => 'website', p_next_title => 'Call at 00:15', p_next_due => '2027-03-27T23:15:00Z', p_agency_org_id => '${ORG}')`);
    OPP_UAE = await call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Dubai stand', p_source => 'website', p_next_title => 'Call at 03:15 Dubai', p_next_due => '2027-03-27T23:15:00Z', p_agency_org_id => '${ORG}')`);
    F_PL = (await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${OPP_PL}'`))[0]!.id;
    F_UAE = (await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${OPP_UAE}'`))[0]!.id;
  });
  afterAll(async () => db.teardown());

  it("applying the migration gives every company Asia/Dubai and changes no follow-up: the preflight fingerprint equals the verify fingerprint", async () => {
    const pre = await admin<{ item: string; result: string }>(pack("crm_follow_up_time_zone_00_preflight_readonly.sql"));
    expect(pre.find((r) => /not installed yet/.test(r.item))!.result).toBe("not installed yet");
    expect(pre.find((r) => /stored as moments/.test(r.item))!.result).toBe("OK");
    expect(pre.find((r) => /Sales companies \(country\)/.test(r.item))!.result).toBe("Fictional Polska (PL): Asia/Dubai; suggestion Europe/Warsaw | Fictional UAE (AE): Asia/Dubai");
    const before = await dueMoments();
    const rowsBefore = JSON.stringify(await admin(`select id, version, updated_at from crm_follow_ups order by id`).catch(() => admin(`select id, updated_at from crm_follow_ups order by id`)));
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);                                                       // safe to run twice
    const verify = await admin<{ item: string; result: string }>(pack("crm_follow_up_time_zone_20_verify_readonly.sql"));
    for (const r of verify) if (!/^information/.test(r.item)) expect(r.result, r.item).toBe("OK");
    expect(fingerprint(verify)).toBe(fingerprint(pre));
    expect(await dueMoments()).toBe(before);
    expect(JSON.stringify(await admin(`select id, version, updated_at from crm_follow_ups order by id`).catch(() => admin(`select id, updated_at from crm_follow_ups order by id`)))).toBe(rowsBefore);
    expect([await zone(CO.uae), await zone(CO.pl)]).toEqual(["Asia/Dubai", "Asia/Dubai"]);       // nobody's zone is guessed from the country
  });

  it("only the people who manage a company's Sales settings change its zone; a named zone only", async () => {
    await expect(call(U.piotr, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Warsaw')`)).rejects.toThrow(/Not allowed/);
    await expect(call(U.sara, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Warsaw')`)).rejects.toThrow(/Not allowed/);        // another company
    await expect(call(U.plManager, `crm_set_follow_up_time_zone('${CO.uae}', 'Europe/Warsaw')`)).rejects.toThrow(/Not allowed/);  // manages Poland, not the UAE
    await expect(call(U.nogrant, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Warsaw')`)).rejects.toThrow(/Not allowed/);
    await expect(q(null, `select crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Warsaw')`)).rejects.toThrow();
    for (const bad of ["+01:00", "UTC+1", "GMT+1", "Etc/GMT+1", "CET", "Europe/Atlantis", "", "Warsaw", "europe/warsaw; drop table x"]) {
      await expect(call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', '${bad.replace(/'/g, "''")}')`), bad).rejects.toThrow(/Choose a time zone by its name/);
    }
    // no direct write: the table has no update policy (and, on the hosted database, no update privilege), so a statement changes nothing
    await db.asUserCommit(U.plManager, (query) => query(`update crm_company_settings set follow_up_time_zone = 'Europe/Warsaw' where company_id = '${CO.pl}'`)).catch(() => null);
    expect(await zone(CO.pl)).toBe("Asia/Dubai");
    await expect(admin(`update crm_company_settings set follow_up_time_zone = '+01:00' where company_id = '${CO.pl}'`)).rejects.toThrow(/crm_company_settings_follow_up_time_zone/);
    const before = await dueMoments();
    await call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Warsaw')`);
    await call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', ' Europe/Warsaw ')`);     // again: nothing
    expect([await zone(CO.uae), await zone(CO.pl)]).toEqual(["Asia/Dubai", "Europe/Warsaw"]);
    expect(await dueMoments()).toBe(before);                                                    // changing the zone moves no deadline
    // everyone with Sales access to the company reads its zone; another company's staff do not
    expect((await q(U.piotr, `select follow_up_time_zone z from crm_company_settings`)).map((r) => r.z)).toEqual(["Europe/Warsaw"]);
    expect((await q(U.sara, `select follow_up_time_zone z from crm_company_settings`)).map((r) => r.z)).toEqual(["Asia/Dubai"]);
    // the change is in the Sales audit log, by the table's existing trigger
    expect((await admin(`select count(*) n from crm_audit_log where entity_type = 'crm_company_settings' and created_at > now() - interval '1 minute'`).catch(() => [{ n: 1 }]))[0]!.n).not.toBe("0");
  });

  it("the settings function the deployed app calls still saves, with its old arguments, and keeps the zone", async () => {
    await call(U.founder, `crm_upsert_settings('${CO.pl}', 'POL', 'PLN', 4, null, 180, false, null, null)`);
    await call(U.founder, `crm_upsert_settings(p_company_id => '${CO.pl}', p_reference_code => 'POL', p_default_quote_currency => 'EUR')`);
    expect((await admin(`select follow_up_time_zone z, default_quote_currency c from crm_company_settings where company_id = '${CO.pl}'`))[0]).toEqual({ z: "Europe/Warsaw", c: "EUR" });
    // a company whose settings are created after the migration starts on Asia/Dubai
    const fresh = id();
    await admin(`insert into companies (id, legal_name, country_code, default_currency) values ('${fresh}', 'Fictional New PL', 'PL', 'PLN')`);
    await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${fresh}', '{founder}')`);
    await expect(call(U.founder, `crm_set_follow_up_time_zone('${fresh}', 'Europe/Warsaw')`)).rejects.toThrow(/Save the Sales settings of this company/);
    await call(U.founder, `crm_upsert_settings('${fresh}', 'NPL', 'PLN')`);
    expect(await zone(fresh)).toBe("Asia/Dubai");
  });

  it("reminder boundaries: the reminder fires at the stored moment in every zone, never before; overdue 24 hours later; 00:15 on the spring-forward night included", async () => {
    const reminders = (followUp: string) => admin(`select kind, user_id, extract(epoch from due_at)::bigint e from crm_reminders where follow_up_id = '${followUp}' order by kind`);
    const run = (iso: string) => admin(`select crm_generate_reminders('${iso}'::timestamptz) n`);
    // one minute before the moment (00:14 Warsaw, 03:14 Dubai): nothing, although it is already "the 28th" in both zones
    await run("2027-03-27T23:14:00Z");
    expect(await reminders(F_PL)).toEqual([]);
    expect(await reminders(F_UAE)).toEqual([]);
    // at the moment
    await run("2027-03-27T23:15:00Z");
    const due = Date.parse("2027-03-27T23:15:00Z") / 1000;
    expect(await reminders(F_PL)).toEqual([{ kind: "follow_up_due", user_id: U.piotr, e: String(due) }]);
    expect(await reminders(F_UAE)).toEqual([{ kind: "follow_up_due", user_id: U.sara, e: String(due) }]);
    // a second run, and a run after the clocks went forward in Warsaw (03:30 local = 01:30 UTC): nothing new
    await run("2027-03-27T23:15:00Z");
    await run("2027-03-28T01:30:00Z");
    expect(await reminders(F_PL)).toHaveLength(1);
    // 23 hours 59 minutes after: not overdue yet; 24 hours after: the overdue reminder (the Warsaw day was only 23 hours long: the rule is 24 real hours)
    await run("2027-03-28T23:14:00Z");
    expect((await reminders(F_PL)).map((r) => r.kind)).toEqual(["follow_up_due"]);
    await run("2027-03-28T23:15:00Z");
    expect((await reminders(F_PL)).map((r) => r.kind)).toEqual(["follow_up_due", "follow_up_overdue"]);
    expect((await reminders(F_UAE)).map((r) => r.kind)).toEqual(["follow_up_due", "follow_up_overdue"]);
    // rescheduled to 00:15 Warsaw on the night the clocks go back (Sunday 31 October 2027, 00:15 CEST = 22:15 UTC on the 30th): a new reminder at that moment only
    await call(U.piotr, `crm_reschedule_follow_up('${F_PL}', '2027-10-30T22:15:00Z'::timestamptz)`);
    await run("2027-10-30T22:14:00Z");
    expect((await reminders(F_PL)).filter((r) => r.e === String(Date.parse("2027-10-30T22:15:00Z") / 1000))).toEqual([]);
    await run("2027-10-30T22:15:00Z");
    expect((await reminders(F_PL)).filter((r) => r.e === String(Date.parse("2027-10-30T22:15:00Z") / 1000)).map((r) => r.kind)).toEqual(["follow_up_due"]);
  });

  it("owner pack: the rollback stops while a company is not on Asia/Dubai, then runs twice and changes no due moment; the app's settings save still works", async () => {
    await expect(db.seed(pack("crm_follow_up_time_zone_90_rollback.sql"))).rejects.toThrow(/STOP: 1 company/);
    expect(await zone(CO.pl)).toBe("Europe/Warsaw");
    const before = await dueMoments();
    await call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', 'Asia/Dubai')`);
    await db.seed(pack("crm_follow_up_time_zone_90_rollback.sql"));
    await db.seed(pack("crm_follow_up_time_zone_90_rollback.sql"));
    expect(await admin(`select 1 from information_schema.columns where table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone'`)).toEqual([]);
    expect(await dueMoments()).toBe(before);
    await call(U.founder, `crm_upsert_settings('${CO.pl}', 'POL', 'PLN')`);
    await db.applyMigration(MIGRATION);
    expect(await zone(CO.pl)).toBe("Asia/Dubai");
  });
});
