import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales follow-ups: a time zone per company (migration 20270112000500_crm_follow_up_time_zone.sql), against a real Postgres.
//   * each existing company takes the zone of its country (AE Dubai, SA Riyadh, PL Warsaw; any other country stays on Dubai and is listed for review), once;
//   * no follow-up due moment changes when the migration is applied, when it is applied again, or when a zone is changed later: the preflight fingerprint equals
//     the verify fingerprint; what changes is the clock the same moment is read on (10:00 Dubai is 07:00 Warsaw in winter, 09:00 Riyadh);
//   * only the people who manage Sales settings change the zone, of their own company; a named zone only (no fixed offset, no abbreviation);
//   * the settings function the deployed app calls still works and keeps the zone; settings created later take the country's zone;
//   * reminder boundaries: a follow-up's reminder fires at its stored moment whatever the company's zone (00:15 Warsaw on the spring-forward night included),
//     never before, and the overdue reminder 24 hours later;
//   * the rollback returns every company to the Dubai clock, stops while an open deadline was typed on a non-Dubai clock since, goes ahead once confirmed.

const id = () => randomUUID();
const CO = { uae: id(), pl: id(), sa: id(), de: id() };
const U = { founder: id(), plManager: id(), sara: id(), piotr: id(), nogrant: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@tz-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = path.join(__dirname, "../../..");
const pack = (f: string) => readFileSync(path.join(ROOT, "supabase/manual-sql", f), "utf8");
const MIGRATION = "20270112000500_crm_follow_up_time_zone.sql";
const row = (rows: { item: string; result: string }[], re: RegExp) => rows.find((r) => re.test(r.item))!.result;

describe("Follow-up time zone per company", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const zone = async (company: string) => (await admin(`select follow_up_time_zone z from crm_company_settings where company_id = '${company}'`))[0]!.z as string;
  const dueMoments = () => admin(`select id, extract(epoch from due_at)::bigint e from crm_follow_ups order by id`).then((r) => JSON.stringify(r));
  let ORG = "", OPP_PL = "", OPP_UAE = "", F_PL = "", F_UAE = "", F_OLD = "";

  beforeAll(async () => {
    // Built up to (not including) the migration, with follow-ups already saved, so the migration is proved against existing data.
    await db.setupBefore(MIGRATION);
    await db.seed(readFileSync(path.join(ROOT, "supabase/tests/grant-authenticated-access.sql"), "utf8"));
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('PL', 'Poland', 'PLN'), ('SA', 'Saudi Arabia', 'SAR'), ('DE', 'Germany', 'EUR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional UAE', 'AE', 'AED'), ('${CO.pl}', 'Fictional Polska', 'PL', 'PLN'),
        ('${CO.sa}', 'Fictional KSA', 'SA', 'SAR'), ('${CO.de}', 'Fictional Germany', 'DE', 'EUR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.pl}', 'POL', 'PLN'), ('${CO.sa}', 'KSA', 'SAR'), ('${CO.de}', 'GER', 'EUR') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.pl}', '{founder}'), ('${U.founder}', '${CO.sa}', '{founder}'),
        ('${U.plManager}', '${CO.pl}', '{manage_settings}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.piotr}', '${CO.pl}', '{}');
    `);
    ORG = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Agency', 'agency') returning id`))[0]!.id;
    // The Warsaw follow-up is due at 00:15 Warsaw on Sunday 28 March 2027, the night the clocks go forward there (= 23:15 UTC on the 27th = 03:15 Dubai on the 28th).
    OPP_PL = await call<string>(U.piotr, `crm_create_opportunity(p_company_id => '${CO.pl}', p_title => 'Warsaw stand', p_source => 'website', p_next_title => 'Call at 00:15', p_next_due => '2027-03-27T23:15:00Z', p_agency_org_id => '${ORG}')`);
    OPP_UAE = await call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Dubai stand', p_source => 'website', p_next_title => 'Call at 03:15 Dubai', p_next_due => '2027-03-27T23:15:00Z', p_agency_org_id => '${ORG}')`);
    F_PL = (await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${OPP_PL}'`))[0]!.id;
    F_UAE = (await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${OPP_UAE}'`))[0]!.id;
    // A deadline the Polish company typed BEFORE the change, as "10:00 (Dubai)" on 15 January 2027 (= 06:00 UTC), as the old app saved it.
    F_OLD = await call<string>(U.piotr, `crm_create_follow_up('${OPP_PL}', 'Typed as 10:00 Dubai', '2027-01-15T06:00:00Z'::timestamptz, 'call', null)`);
  });
  afterAll(async () => db.teardown());

  it("each existing company takes the zone of its country, once; no follow-up changes: the preflight fingerprint equals the verify fingerprint", async () => {
    const pre = await admin<{ item: string; result: string }>(pack("crm_follow_up_time_zone_00_preflight_readonly.sql"));
    expect(row(pre, /not installed yet/)).toBe("not installed yet");
    expect(row(pre, /stored as moments/)).toBe("OK");
    expect(row(pre, /each Sales company \(country\) and the zone it will get/)).toBe(
      "Fictional Germany (DE) -> Asia/Dubai (country not in the list: review) | Fictional KSA (SA) -> Asia/Riyadh | Fictional Polska (PL) -> Europe/Warsaw | Fictional UAE (AE) -> Asia/Dubai");
    expect(row(pre, /country other than AE, SA, PL/)).toBe("Fictional Germany (DE)");
    expect(row(pre, /companies leaving the Dubai clock/)).toBe("Fictional Polska 2 / 1");
    const before = await dueMoments();
    const followUpsBefore = JSON.stringify(await admin(`select * from crm_follow_ups order by id`));
    const settingsBefore = JSON.stringify(await admin(`select company_id, updated_at, updated_by from crm_company_settings order by company_id`));
    await db.applyMigration(MIGRATION);
    const verify = await admin<{ item: string; result: string }>(pack("crm_follow_up_time_zone_20_verify_readonly.sql"));
    for (const r of verify) if (!/^information|^FINGERPRINT/.test(r.item)) expect(r.result, r.item).toBe("OK");
    expect(row(verify, /^FINGERPRINT/)).toBe(row(pre, /^FINGERPRINT/));
    expect(row(verify, /the zone each Sales company HAS/)).toBe("Fictional Germany (DE): Asia/Dubai | Fictional KSA (SA): Asia/Riyadh | Fictional Polska (PL): Europe/Warsaw | Fictional UAE (AE): Asia/Dubai");
    expect(await dueMoments()).toBe(before);
    expect(JSON.stringify(await admin(`select * from crm_follow_ups order by id`))).toBe(followUpsBefore);          // not one column of one follow-up
    expect(JSON.stringify(await admin(`select company_id, updated_at, updated_by from crm_company_settings order by company_id`))).toBe(settingsBefore);
    expect([await zone(CO.uae), await zone(CO.pl), await zone(CO.sa), await zone(CO.de)]).toEqual(["Asia/Dubai", "Europe/Warsaw", "Asia/Riyadh", "Asia/Dubai"]);
    // a zone the owner changes afterwards survives a second run of the migration (safe to run twice; the country default is applied once)
    await call(U.founder, `crm_set_follow_up_time_zone('${CO.sa}', 'Asia/Dubai')`);
    await db.applyMigration(MIGRATION);
    expect(await zone(CO.sa)).toBe("Asia/Dubai");
    await call(U.founder, `crm_set_follow_up_time_zone('${CO.sa}', 'Asia/Riyadh')`);
    expect(await dueMoments()).toBe(before);
  });

  it("the visible consequence: the same moment is now read on the company's clock (10:00 Dubai is 07:00 Warsaw in winter, 09:00 Riyadh) and on its own day", async () => {
    const read = async (tz: string) => (await admin(`select to_char(due_at at time zone '${tz}', 'YYYY-MM-DD HH24:MI') t from crm_follow_ups where id = '${F_OLD}'`))[0]!.t;
    expect([await read("Asia/Dubai"), await read("Europe/Warsaw"), await read("Asia/Riyadh")]).toEqual(["2027-01-15 10:00", "2027-01-15 07:00", "2027-01-15 09:00"]);
    // 03:15 on the 28th in Dubai is 00:15 on the 28th in Warsaw; at 01:30 Dubai (22:30 Warsaw on the 27th) it is "today" in Dubai and "tomorrow" in Warsaw
    const day = async (tz: string, at: string) => (await admin(`select ((due_at at time zone '${tz}')::date = ('${at}'::timestamptz at time zone '${tz}')::date) same from crm_follow_ups where id = '${F_PL}'`))[0]!.same;
    expect([await day("Asia/Dubai", "2027-03-27T21:30:00Z"), await day("Europe/Warsaw", "2027-03-27T21:30:00Z"), await day("Europe/Warsaw", "2027-03-27T23:05:00Z")]).toEqual([true, false, true]);
  });

  it("only the people who manage a company's Sales settings change its zone; a named zone only", async () => {
    await expect(call(U.piotr, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Berlin')`)).rejects.toThrow(/Not allowed/);
    await expect(call(U.sara, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Berlin')`)).rejects.toThrow(/Not allowed/);        // another company
    await expect(call(U.plManager, `crm_set_follow_up_time_zone('${CO.uae}', 'Europe/Warsaw')`)).rejects.toThrow(/Not allowed/);  // manages Poland, not the UAE
    await expect(call(U.nogrant, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Berlin')`)).rejects.toThrow(/Not allowed/);
    await expect(q(null, `select crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Berlin')`)).rejects.toThrow();
    for (const bad of ["+01:00", "UTC+1", "GMT+1", "Etc/GMT+1", "CET", "Europe/Atlantis", "", "Warsaw", "europe/warsaw; drop table x"]) {
      await expect(call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', '${bad.replace(/'/g, "''")}')`), bad).rejects.toThrow(/Choose a time zone by its name/);
    }
    // no direct write: the table has no update policy (and, on the hosted database, no update privilege), so a statement changes nothing
    await db.asUserCommit(U.plManager, (query) => query(`update crm_company_settings set follow_up_time_zone = 'Europe/Berlin' where company_id = '${CO.pl}'`)).catch(() => null);
    expect(await zone(CO.pl)).toBe("Europe/Warsaw");
    await expect(admin(`update crm_company_settings set follow_up_time_zone = '+01:00' where company_id = '${CO.pl}'`)).rejects.toThrow(/crm_company_settings_follow_up_time_zone/);
    const before = await dueMoments();
    await call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Berlin')`);
    await call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', ' Europe/Warsaw ')`);
    await call(U.plManager, `crm_set_follow_up_time_zone('${CO.pl}', 'Europe/Warsaw')`);       // again: nothing
    expect([await zone(CO.uae), await zone(CO.pl)]).toEqual(["Asia/Dubai", "Europe/Warsaw"]);
    expect(await dueMoments()).toBe(before);                                                    // changing the zone moves no deadline
    // everyone with Sales access to the company reads its zone; another company's staff do not
    expect((await q(U.piotr, `select follow_up_time_zone z from crm_company_settings`)).map((r) => r.z)).toEqual(["Europe/Warsaw"]);
    expect((await q(U.sara, `select follow_up_time_zone z from crm_company_settings`)).map((r) => r.z)).toEqual(["Asia/Dubai"]);
  });

  it("the settings function the deployed app calls still saves, with its old arguments, and keeps the zone; settings created later take the country's zone", async () => {
    await call(U.founder, `crm_upsert_settings('${CO.pl}', 'POL', 'PLN', 4, null, 180, false, null, null)`);
    await call(U.founder, `crm_upsert_settings(p_company_id => '${CO.pl}', p_reference_code => 'POL', p_default_quote_currency => 'EUR')`);
    expect((await admin(`select follow_up_time_zone z, default_quote_currency c from crm_company_settings where company_id = '${CO.pl}'`))[0]).toEqual({ z: "Europe/Warsaw", c: "EUR" });
    const fresh = { pl: id(), fr: id() };
    await admin(`insert into countries (code, name, default_currency) values ('FR', 'France', 'EUR') on conflict do nothing`);
    await admin(`insert into companies (id, legal_name, country_code, default_currency) values ('${fresh.pl}', 'Fictional New PL', 'PL', 'PLN'), ('${fresh.fr}', 'Fictional New FR', 'FR', 'EUR')`);
    await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${fresh.pl}', '{founder}'), ('${U.founder}', '${fresh.fr}', '{founder}')`);
    await expect(call(U.founder, `crm_set_follow_up_time_zone('${fresh.pl}', 'Europe/Warsaw')`)).rejects.toThrow(/Save the Sales settings of this company/);
    await call(U.founder, `crm_upsert_settings('${fresh.pl}', 'NPL', 'PLN')`);
    await call(U.founder, `crm_upsert_settings('${fresh.fr}', 'NFR', 'EUR')`);
    expect([await zone(fresh.pl), await zone(fresh.fr)]).toEqual(["Europe/Warsaw", "Asia/Dubai"]);
  });

  it("reminder boundaries: the reminder fires at the stored moment in every zone, never before; overdue 24 hours later; 00:15 on the spring-forward night included", async () => {
    const reminders = (followUp: string) => admin(`select kind, user_id, extract(epoch from due_at)::bigint e from crm_reminders where follow_up_id = '${followUp}' order by kind`);
    const run = (iso: string) => admin(`select crm_generate_reminders('${iso}'::timestamptz) n`);
    await admin(`update crm_follow_ups set status = 'done', completed_at = now() where id = '${F_OLD}'`).catch(() => admin(`delete from crm_follow_ups where id = '${F_OLD}'`));
    // one minute before the moment (00:14 Warsaw, 03:14 Dubai): nothing, although it is already "the 28th" in both zones
    await run("2027-03-27T23:14:00Z");
    expect(await reminders(F_PL)).toEqual([]);
    expect(await reminders(F_UAE)).toEqual([]);
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

  it("rollback: stops while an open deadline was typed on a non-Dubai clock since the installation, goes ahead once confirmed, returns every company to Dubai, changes no moment", async () => {
    // the reschedule above was made after the installation, in the Warsaw company: that is the unsafe case
    await expect(db.seed(pack("crm_follow_up_time_zone_90_rollback.sql"))).rejects.toThrow(/STOP: 1 open follow-up\(s\) were typed or moved on a non-Dubai clock.*Fictional Polska 1/);
    expect(await zone(CO.pl)).toBe("Europe/Warsaw");
    const before = await dueMoments();
    await db.seed(`select set_config('crm.time_zone_rollback_confirmed', 'yes', false);\n${pack("crm_follow_up_time_zone_90_rollback.sql")}\nselect set_config('crm.time_zone_rollback_confirmed', '', false);`);
    await db.seed(pack("crm_follow_up_time_zone_90_rollback.sql"));                              // twice
    expect(await admin(`select 1 from information_schema.columns where table_name = 'crm_company_settings' and column_name = 'follow_up_time_zone'`)).toEqual([]);
    expect((await admin(`select to_regprocedure('public.crm_default_time_zone(text)') f, to_regprocedure('public.crm_set_follow_up_time_zone(uuid, text)') g`))[0]).toEqual({ f: null, g: null });
    expect(await dueMoments()).toBe(before);
    await call(U.founder, `crm_upsert_settings('${CO.pl}', 'POL', 'PLN')`);                      // the deployed app's save still works
    // installed again: the country defaults again, and with no deadline typed since, the rollback runs straight through
    await db.applyMigration(MIGRATION);
    expect([await zone(CO.pl), await zone(CO.sa), await zone(CO.uae)]).toEqual(["Europe/Warsaw", "Asia/Riyadh", "Asia/Dubai"]);
    await db.seed(pack("crm_follow_up_time_zone_90_rollback.sql"));
    expect(await dueMoments()).toBe(before);
    await db.applyMigration(MIGRATION);
  });
});
