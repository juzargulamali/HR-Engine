import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: Events & Exhibitions, observations, the enquiry-to-edition link and the shared outreach priority
// (migration 20261224000100_crm_events_outreach.sql). Proves, against a real Postgres:
//   * the outreach priority is ONE shared value per account (1 to 5 or Unrated), set by any Sales grant, visible to every company, refused without a grant;
//   * events and editions are shared reference data: readable with any grant, written only through the functions, duplicates and bad dates refused,
//     the next edition never touches an earlier one;
//   * observations keep "No observation" (no row), "Agency unknown" and "Did not exhibit" distinct, allow several rows per exhibitor and edition, and the same
//     exhibitor shows a DIFFERENT agency in two years;
//   * an enquiry is linked to an edition only by its owner or a founder; edition counts come from the enquiries the VIEWER can read, so an enquiry of a company
//     the viewer has no grant for contributes nothing;
//   * ARCHIVE is the only removal and gives the same result whatever is attached (an empty edition and one linked only to another company's enquiry look the same);
//     every edition, observation and link is kept and nothing can be deleted; bulk import classifies, never overwrites or reopens, adds in one batch and is idempotent;
//   * crm_create_opportunity is untouched (an enquiry without an edition still works).

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
  "20261224000100_crm_events_outreach.sql",
];
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), faisal: id(), stranger: id(), hr: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@events-test.ae')`).join(", ");

describe("Events & Exhibitions, observations and outreach priority", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";

  let client: string; let agencyA: string; let agencyB: string; let techCo: string;
  let event: string; let e2025: string; let e2026: string; let e2027: string;
  let uaeOpp: string; let ksaOpp: string;

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hr}', 'hr_admin');
    `);
    for (const f of MIGRATIONS) await db.applyMigration(f);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.ksa}', '{founder}'),
        ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.faisal}', '${CO.ksa}', '{}');
    `);
    const org = async (name: string, roles: string) =>
      (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '${roles}') as id`))[0].id;
    client = await org("Fictional Harbour Client", "{client}");
    agencyA = await org("Fictional Agency A", "{agency}");
    agencyB = await org("Fictional Agency B", "{agency}");
    techCo = await org("Fictional Tech Co", "{technology}");
  });

  afterAll(async () => { await db.teardown(); });

  describe("shared outreach priority", () => {
    it("is one value per account that every company sees, set by any Sales grant, 1 to 5 or Unrated", async () => {
      expect((await admin<{ p: number | null }>(`select outreach_priority p from crm_organisations where id = '${client}'`))[0].p).toBeNull();
      await commit(U.sara, `select crm_set_outreach_priority('${client}', 4)`);
      for (const who of [U.sara, U.faisal, U.founder]) {
        expect((await q<{ p: number }>(who, `select outreach_priority p from crm_organisations where id = '${client}'`))[0].p).toBe(4);
      }
      const [row] = await admin<{ by: string }>(`select outreach_priority_by by from crm_organisations where id = '${client}'`);
      expect(row.by).toBe(U.sara);
      await commit(U.faisal, `select crm_set_outreach_priority('${client}', 5)`);
      expect((await admin<{ p: number }>(`select outreach_priority p from crm_organisations where id = '${client}'`))[0].p).toBe(5);
      await commit(U.omar, `select crm_set_outreach_priority('${client}', null)`);
      expect((await admin<{ p: number | null }>(`select outreach_priority p from crm_organisations where id = '${client}'`))[0].p).toBeNull();
    });
    it("refuses 0, 6, a missing account and anyone without a Sales grant, and cannot be written directly", async () => {
      for (const bad of [0, 6]) await expect(commit(U.sara, `select crm_set_outreach_priority('${client}', ${bad})`)).rejects.toThrow(/1 to 5/);
      await expect(commit(U.sara, `select crm_set_outreach_priority('${id()}', 3)`)).rejects.toThrow(/Account not found/);
      for (const who of [U.hr, U.stranger]) await expect(commit(who, `select crm_set_outreach_priority('${client}', 3)`)).rejects.toThrow(/Sales access|No CRM access/i);
      // no policy allows a direct write (the test database grants DML to the role, row-level security still refuses): nothing changes
      await commit(U.sara, `update crm_organisations set outreach_priority = 5 where id = '${client}'`);
      expect((await admin<{ p: number | null }>(`select outreach_priority p from crm_organisations where id = '${client}'`))[0].p).toBeNull();
    });
  });

  describe("events and editions", () => {
    it("any Sales grant adds an event; a duplicate name is refused; people without a grant see nothing and cannot add", async () => {
      event = (await commit<{ id: string }>(U.sara, `select crm_save_event(null, 'Fictional Expo Global', 'exhibition', 'https://expo.example', null) as id`))[0].id;
      await expect(commit(U.omar, `select crm_save_event(null, '  fictional EXPO global ', 'exhibition')`)).rejects.toThrow(/already exists/);
      await expect(commit(U.sara, `select crm_save_event(null, '', 'exhibition')`)).rejects.toThrow(/event name/);
      await expect(commit(U.sara, `select crm_save_event(null, 'Bad Kind', 'party')`)).rejects.toThrow(/exhibition, conference or other/);
      expect(await q(U.faisal, `select id from crm_events where id = '${event}'`)).toHaveLength(1);
      expect(await q(U.hr, `select id from crm_events`)).toHaveLength(0);
      await expect(commit(U.hr, `select crm_save_event(null, 'No Grant Expo', 'exhibition')`)).rejects.toThrow(/Sales access|No CRM access/i);
      await expect(commit(U.sara, `insert into crm_events (name) values ('Direct')`)).rejects.toThrow(/row-level security/i);
    });
    it("adds the next edition without touching an earlier one; refuses a duplicate start date, reversed dates and a bad country", async () => {
      const add = async (s: string, e: string, city = "Dubai") => (await commit<{ id: string }>(U.sara, `select crm_save_edition(null, '${event}', '${s}', '${e}', '${city}', 'AE', 'Fictional Hall', null) as id`))[0].id;
      e2025 = await add("2025-10-13", "2025-10-17");
      e2026 = await add("2026-10-12", "2026-10-16");
      e2027 = await add("2027-10-11", "2027-10-15");
      expect((await admin<{ start_date: string }>(`select to_char(start_date, 'YYYY-MM-DD') start_date from crm_event_editions where id = '${e2025}'`))[0].start_date).toBe("2025-10-13");
      await expect(add("2026-10-12", "2026-10-16")).rejects.toThrow(/already has an edition/);
      await expect(commit(U.sara, `select crm_save_edition(null, '${event}', '2028-10-12', '2028-10-10')`)).rejects.toThrow(/end date/);
      await expect(commit(U.sara, `select crm_save_edition(null, '${event}', '2028-10-10', '2028-10-12', null, 'UAE')`)).rejects.toThrow(/two-letter/);
    });
    it("only the person who added it or a founder edits or removes; anyone else is refused", async () => {
      await expect(commit(U.omar, `select crm_save_edition('${e2026}', null, '2026-10-12', '2026-10-17')`)).rejects.toThrow(/Only the person who added/);
      await expect(commit(U.omar, `select crm_save_event('${event}', 'Fictional Expo Global Renamed')`)).rejects.toThrow(/Only the person who added/);
      await commit(U.sara, `select crm_save_edition('${e2026}', null, '2026-10-12', '2026-10-17', 'Dubai', 'AE', 'Fictional Hall 2', 'moved a day')`);
      expect((await admin<{ end_date: string; venue: string }>(`select to_char(end_date, 'YYYY-MM-DD') end_date, venue from crm_event_editions where id = '${e2026}'`))[0]).toEqual({ end_date: "2026-10-17", venue: "Fictional Hall 2" });
      expect((await admin<{ d: string }>(`select to_char(start_date, 'YYYY-MM-DD') d from crm_event_editions where id = '${e2025}'`))[0].d).toBe("2025-10-13");
      await commit(U.founder, `select crm_save_event('${event}', 'Fictional Expo Global', 'exhibition', 'https://expo.example', 'a founder may edit')`);
    });
  });

  describe("observations", () => {
    it("records the same exhibitor with a different agency in two years, several rows per edition, and keeps unknown / did-not-exhibit / unverified distinct", async () => {
      const obs = (edition: string, args: string) => commit<{ id: string }>(U.sara, `select crm_record_observation('${edition}', '${client}', ${args}) as id`);
      await obs(e2025, `'exhibited', '${agencyA}', false, 'B12', 'stand_builder', 'seen on site', 'confirmed'`);
      await obs(e2026, `'exhibited', '${agencyB}', false, 'C3', 'stand_builder', null, 'unverified'`);
      await obs(e2026, `'exhibited', null, true, 'C4', null, 'second stand, builder not known', 'unverified'`);
      await obs(e2027, `'did_not_exhibit', null, false, null, null, 'told by the client', 'confirmed'`);
      const rows = await q<{ y: number; kind: string; agency: string | null; unknown: boolean; verification: string }>(
        U.faisal, `select extract(year from d.start_date)::int y, o.kind, a.name agency, o.agency_unknown unknown, o.verification
           from crm_event_observations o join crm_event_editions d on d.id = o.edition_id left join crm_organisations a on a.id = o.agency_org_id
          where o.exhibitor_org_id = '${client}' order by d.start_date, o.stand_no nulls last`);
      expect(rows.map((r) => [r.y, r.kind, r.agency, r.unknown, r.verification])).toEqual([
        [2025, "exhibited", "Fictional Agency A", false, "confirmed"],
        [2026, "exhibited", "Fictional Agency B", false, "unverified"],
        [2026, "exhibited", null, true, "unverified"],
        [2027, "did_not_exhibit", null, false, "confirmed"],
      ]);
      // "No observation" is simply no row: an exhibitor nobody recorded has none, which is not "did not exhibit"
      expect(await q(U.sara, `select 1 from crm_event_observations where exhibitor_org_id = '${techCo}'`)).toHaveLength(0);
    });
    it("refuses an ambiguous or impossible shape and a non-agency as the agency", async () => {
      const bad = (args: string) => commit(U.sara, `select crm_record_observation('${e2025}', '${client}', ${args})`);
      await expect(bad(`'exhibited', null, false`)).rejects.toThrow(/agency, or mark the agency as unknown/);
      await expect(bad(`'exhibited', '${agencyA}', true`)).rejects.toThrow(/agency, or mark the agency as unknown/);
      await expect(bad(`'did_not_exhibit', '${agencyA}', false`)).rejects.toThrow(/takes no agency/);
      await expect(bad(`'did_not_exhibit', null, false, 'A1'`)).rejects.toThrow(/takes no agency/);
      await expect(bad(`'exhibited', '${techCo}', false`)).rejects.toThrow(/not recorded as an agency/);
      await expect(bad(`'exhibited', '${client}', false`)).rejects.toThrow(/not recorded as an agency/);
      await expect(bad(`'exhibited', '${agencyA}', false, null, 'caterer'`)).rejects.toThrow(/listed agency role/);
      await expect(bad(`'maybe', '${agencyA}', false`)).rejects.toThrow(/Exhibited or Did not exhibit/);
      await expect(commit(U.hr, `select crm_record_observation('${e2025}', '${client}', 'exhibited', null, true)`)).rejects.toThrow(/Sales access|No CRM access/i);
    });
    it("is edited or removed only by the person who recorded it or a founder; a non-exhibition event needs no stand", async () => {
      const [o] = await admin<{ id: string }>(`select id from crm_event_observations where edition_id = '${e2025}' limit 1`);
      await expect(commit(U.omar, `select crm_update_observation('${o.id}', 'exhibited', '${agencyB}', false, 'B12', 'stand_builder', null, 'confirmed')`)).rejects.toThrow(/Only the person who recorded/);
      await expect(commit(U.omar, `select crm_remove_observation('${o.id}')`)).rejects.toThrow(/Only the person who recorded/);
      await commit(U.sara, `select crm_update_observation('${o.id}', 'exhibited', '${agencyA}', false, 'B12', 'stand_builder', 'corrected', 'confirmed')`);
      expect((await admin<{ note: string }>(`select note from crm_event_observations where id = '${o.id}'`))[0].note).toBe("corrected");
      const conf = (await commit<{ id: string }>(U.sara, `select crm_save_event(null, 'Fictional Summit', 'conference') as id`))[0].id;
      const ed = (await commit<{ id: string }>(U.sara, `select crm_save_edition(null, '${conf}', '2026-05-04', '2026-05-05', 'Riyadh', 'SA') as id`))[0].id;
      await commit(U.sara, `select crm_record_observation('${ed}', '${client}', 'exhibited', '${agencyA}', false)`);
      expect((await admin<{ s: string | null }>(`select stand_no s from crm_event_observations where edition_id = '${ed}'`))[0].s).toBeNull();
    });
  });

  describe("linking an enquiry and the counts each viewer can see", () => {
    it("an enquiry without an edition still works (crm_create_opportunity is unchanged); the owner or a founder links it; others cannot", async () => {
      uaeOpp = (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Harbour stand', p_source => 'agency_call',
        p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${client}', p_agency_org_id => '${agencyB}') as id`))[0].id;
      ksaOpp = (await commit<{ id: string }>(U.faisal, `select crm_create_opportunity(p_company_id => '${CO.ksa}', p_title => 'Harbour stand KSA', p_source => 'agency_call',
        p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${client}') as id`))[0].id;
      expect((await admin<{ e: string | null }>(`select event_edition_id e from crm_opportunities where id = '${uaeOpp}'`))[0].e).toBeNull();
      await expect(commit(U.omar, `select crm_set_opportunity_edition('${uaeOpp}', '${e2026}')`)).rejects.toThrow(/Only the owner/);
      await expect(commit(U.faisal, `select crm_set_opportunity_edition('${uaeOpp}', '${e2026}')`)).rejects.toThrow(/Sales access|not found|Only the owner/i);
      await commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', '${e2026}')`);
      await commit(U.faisal, `select crm_set_opportunity_edition('${ksaOpp}', '${e2026}')`);
      expect((await admin<{ e: string }>(`select event_edition_id e from crm_opportunities where id = '${uaeOpp}'`))[0].e).toBe(e2026);
    });
    it("counts come from the enquiries the VIEWER can read: UAE sees its own, KSA its own, a founder both, a person without a grant nothing", async () => {
      const count = (who: string) => q<{ n: string }>(who, `select count(*) n from crm_opportunities where event_edition_id = '${e2026}'`).then((r) => Number(r[0].n));
      expect(await count(U.sara)).toBe(1);
      expect(await count(U.omar)).toBe(1);
      expect(await count(U.faisal)).toBe(1);
      expect(await count(U.founder)).toBe(2);
      expect(await count(U.hr)).toBe(0);
      expect(await count(U.stranger)).toBe(0);
      // the KSA enquiry is not in a UAE viewer's rows at all (no count, no drill-down row)
      expect(await q(U.sara, `select id from crm_opportunities where id = '${ksaOpp}'`)).toHaveLength(0);
    });
    it("clears the link, refuses an unknown or archived edition, a stale version and a lost enquiry, and logs the change on the enquiry's timeline", async () => {
      await commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', null)`);
      expect((await admin<{ e: string | null }>(`select event_edition_id e from crm_opportunities where id = '${uaeOpp}'`))[0].e).toBeNull();
      await commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', '${e2026}')`);
      await expect(commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', '${id()}')`)).rejects.toThrow(/Choose an edition from the list/);
      await expect(commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', '${e2025}', 1)`)).rejects.toThrow(/changed|version|reload/i);
      const events = await admin<{ to_value: string }>(`select to_value from crm_opportunity_events where opportunity_id = '${uaeOpp}' and kind = 'details_changed' order by created_at`);
      expect(events.some((e) => /event: Fictional Expo Global · 2026 · Dubai/.test(e.to_value))).toBe(true);
      expect(events.some((e) => /event link cleared/.test(e.to_value))).toBe(true);
    });
  });

  describe("archive is the only removal, and it is the same whatever is attached", () => {
    it("an empty edition and one linked only to ANOTHER company's enquiry give the same result, the link stays, and nothing can be deleted", async () => {
      const add = async (s: string, e: string) => (await commit<{ id: string }>(U.sara, `select crm_save_edition(null, '${event}', '${s}', '${e}', 'Dubai', 'AE') as id`))[0].id;
      const empty = await add("2030-10-14", "2030-10-18");
      const ksaOnly = await add("2031-10-14", "2031-10-18");
      await commit(U.faisal, `select crm_set_opportunity_edition('${ksaOpp}', '${ksaOnly}')`);
      // the UAE person cannot see the KSA enquiry at all, so the two editions look identical to her: both show no enquiry
      expect(await q(U.sara, `select id from crm_opportunities where event_edition_id = '${ksaOnly}'`)).toHaveLength(0);
      const r1 = (await commit<{ r: string }>(U.sara, `select crm_archive_edition('${empty}') r`))[0].r;
      const r2 = (await commit<{ r: string }>(U.sara, `select crm_archive_edition('${ksaOnly}') r`))[0].r;
      expect(r1).toBe("archived");
      expect(r2).toBe(r1);
      const rows = await admin<{ id: string; a: boolean }>(`select id, archived_at is not null a from crm_event_editions where id = any (array['${empty}','${ksaOnly}']::uuid[])`);
      expect(rows).toHaveLength(2);                                                    // nothing was deleted
      expect(rows.every((x) => x.a)).toBe(true);
      expect((await admin<{ e: string }>(`select event_edition_id e from crm_opportunities where id = '${ksaOpp}'`))[0].e).toBe(ksaOnly);   // the KSA link is preserved
      // archiving again changes nothing and says the same
      expect((await commit<{ r: string }>(U.sara, `select crm_archive_edition('${ksaOnly}') r`))[0].r).toBe("archived");
      // there is no delete path: the function does not exist and a direct delete removes nothing
      await expect(commit(U.sara, `select crm_remove_edition('${empty}')`)).rejects.toThrow(/does not exist/);
      await commit(U.sara, `delete from crm_event_editions where id = '${empty}'`);
      expect(await admin(`select 1 from crm_event_editions where id = '${empty}'`)).toHaveLength(1);
      // only the person who added it, or a founder, archives
      const mine = await add("2032-10-14", "2032-10-18");
      await expect(commit(U.omar, `select crm_archive_edition('${mine}')`)).rejects.toThrow(/Only the person who added/);
      await expect(commit(U.hr, `select crm_archive_edition('${mine}')`)).rejects.toThrow(/Only the person who added|Sales access|No CRM access/i);
      await commit(U.founder, `select crm_archive_edition('${mine}')`);
      await expect(commit(U.sara, `select crm_archive_edition('${id()}')`)).rejects.toThrow(/Edition not found/);
    });
    it("an archived edition stays readable, keeps its observations and takes no NEW enquiry link or observation; clearing an existing link still works", async () => {
      const [ed] = await admin<{ id: string }>(`select event_edition_id id from crm_opportunities where id = '${ksaOpp}'`);
      expect(await q(U.faisal, `select id from crm_event_editions where id = '${ed.id}'`)).toHaveLength(1);
      await expect(commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', '${ed.id}')`)).rejects.toThrow(/Choose an edition from the list/);
      await expect(commit(U.sara, `select crm_record_observation('${ed.id}', '${client}', 'exhibited', null, true)`)).rejects.toThrow(/archived edition/);
      await commit(U.faisal, `select crm_set_opportunity_edition('${ksaOpp}', null)`);
      expect((await admin<{ e: string | null }>(`select event_edition_id e from crm_opportunities where id = '${ksaOpp}'`))[0].e).toBeNull();
    });
    it("archiving an event keeps ALL its editions, observations and enquiry links exactly as they were; they are no longer offered for new links", async () => {
      const before = await admin<{ id: string; a: boolean }>(`select id, archived_at is not null a from crm_event_editions where event_id = '${event}' order by start_date`);
      const obsBefore = (await admin<{ n: string }>(`select count(*) n from crm_event_observations where edition_id = any (select id from crm_event_editions where event_id = '${event}')`))[0].n;
      await expect(commit(U.omar, `select crm_archive_event('${event}')`)).rejects.toThrow(/Only the person who added/);
      expect((await commit<{ r: string }>(U.sara, `select crm_archive_event('${event}') r`))[0].r).toBe("archived");
      expect((await admin<{ a: boolean }>(`select archived_at is not null a from crm_events where id = '${event}'`))[0].a).toBe(true);
      const after = await admin<{ id: string; a: boolean }>(`select id, archived_at is not null a from crm_event_editions where event_id = '${event}' order by start_date`);
      expect(after).toEqual(before);                                                   // not one edition was changed or removed
      expect((await admin<{ n: string }>(`select count(*) n from crm_event_observations where edition_id = any (select id from crm_event_editions where event_id = '${event}')`))[0].n).toBe(obsBefore);
      expect((await admin<{ e: string }>(`select event_edition_id e from crm_opportunities where id = '${uaeOpp}'`))[0].e).toBe(e2026);
      // an edition of an archived event is not offered for a new link, and the archived event takes no new edition
      await expect(commit(U.sara, `select crm_set_opportunity_edition('${ksaOpp}', '${e2027}')`)).rejects.toThrow(/not found|Choose an edition|Only the owner/i);
      await expect(commit(U.faisal, `select crm_set_opportunity_edition('${ksaOpp}', '${e2027}')`)).rejects.toThrow(/Choose an edition from the list/);
      await expect(commit(U.sara, `select crm_save_edition(null, '${event}', '2040-01-01', '2040-01-02')`)).rejects.toThrow(/archived event/);
      // an edition can still never be deleted while an enquiry is linked to it
      await expect(admin(`delete from crm_event_editions where id = '${e2026}'`)).rejects.toThrow(/violates foreign key/);
      // the name can be used again by a NEW event once the old one is archived
      await commit(U.sara, `select crm_save_event(null, 'Fictional Expo Global', 'exhibition')`);
    });
  });

  describe("bulk import of the shared calendar", () => {
    type Row = { row: number; status: string; reason: string | null; note: string | null; event: string; eventIsNew: boolean };
    type Result = { applied: boolean; blocked: boolean; stale: boolean; createdEvents: number; createdEditions: number; summary: Record<string, number>; rows: Row[] };
    const imp = (who: string, rows: unknown[], apply = false, expect_?: number) =>
      commit<{ r: Result }>(who, `select crm_import_events('${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb, ${apply}, ${expect_ ?? "null"}) r`).then((x) => x[0].r);
    const r = (row: number, name: string, start: string, end: string, country = "AE", city = "Dubai", venue = "Fictional Hall") => ({ row, name, country, city, venue, start, end });
    const counts = async () => ({
      events: Number((await admin<{ n: string }>(`select count(*) n from crm_events`))[0].n),
      editions: Number((await admin<{ n: string }>(`select count(*) n from crm_event_editions`))[0].n),
    });
    let show: string;

    it("classifies every row without writing: new event, added edition, already present, conflicts, ambiguous, archived and invalid rows", async () => {
      show = (await commit<{ id: string }>(U.sara, `select crm_save_event(null, 'Fictional Import Show', 'exhibition') as id`))[0].id;
      await commit(U.sara, `select crm_save_edition(null, '${show}', '2026-03-10', '2026-03-12', 'Dubai', 'AE', 'Fictional Hall')`);
      await commit(U.sara, `select crm_save_event(null, 'Fictional Gulf Mega Expo', 'exhibition')`);
      await commit(U.sara, `select crm_save_event(null, 'Fictional Gulf Mini Expo', 'exhibition')`);
      const old = (await commit<{ id: string }>(U.sara, `select crm_save_event(null, 'Fictional Retired Show', 'other') as id`))[0].id;
      await commit(U.sara, `select crm_archive_event('${old}')`);
      const arch = (await commit<{ id: string }>(U.sara, `select crm_save_event(null, 'Fictional Archived Date Show', 'other') as id`))[0].id;
      const archEd = (await commit<{ id: string }>(U.sara, `select crm_save_edition(null, '${arch}', '2026-09-01', '2026-09-03') as id`))[0].id;
      await commit(U.sara, `select crm_archive_edition('${archEd}')`);
      const before = await counts();
      const rows = [
        r(2, "Fictional Import Show", "2026-03-10", "2026-03-12"),                        // already present
        r(3, "Fictional Import Show", "2027-03-09", "2027-03-11"),                        // new edition of an existing event
        r(4, "Fictional New Expo", "2027-05-01", "2027-05-03", "SA", "Riyadh"),            // new event
        r(5, "fictional new-expo", "2028-05-01", "2028-05-03", "SA", "Riyadh"),            // another edition of the SAME new event (same name key)
        r(6, "Fictional Import Show", "2026-03-10", "2026-03-14"),                        // same start, different end: conflict
        r(7, "Fictional Import Show", "2026-03-11", "2026-03-13"),                        // overlaps the recorded edition: conflict
        r(8, "Fictional Retired Show", "2027-01-01", "2027-01-02"),                       // only an archived event has this name: review
        r(9, "Fictional Archived Date Show", "2026-09-01", "2026-09-03"),                 // an archived edition has this start: review
        r(10, "Gulf", "2027-02-01", "2027-02-02"),                                        // could be either Gulf expo: ambiguous
        r(11, "", "2027-02-01", "2027-02-02"),                                            // no name
        r(12, "Fictional Bad Date", "2026-02-30", "2026-03-01"),                          // not a real date
        r(13, "Fictional Bad Range", "2026-04-05", "2026-04-01"),                         // end before start
        r(14, "Fictional No Country", "2026-04-01", "2026-04-02", ""),                    // no country
        r(15, "Fictional New Expo", "2027-05-01", "2027-05-03", "SA", "Riyadh"),          // repeated in the file
      ];
      const res = await imp(U.sara, rows);
      const status = Object.fromEntries(res.rows.map((x) => [x.row, x.status]));
      expect(status).toEqual({ 2: "present", 3: "new_edition", 4: "new_event", 5: "new_edition", 6: "conflict", 7: "conflict", 8: "review", 9: "review", 10: "ambiguous", 11: "invalid", 12: "invalid", 13: "invalid", 14: "invalid", 15: "present" });
      expect(res.rows.find((x) => x.row === 5)!.eventIsNew).toBe(true);
      expect(res.rows.find((x) => x.row === 6)!.reason).toMatch(/Dates are never overwritten/);
      expect(res.rows.find((x) => x.row === 8)!.reason).toMatch(/never reopens an archived event/);
      expect(res.rows.find((x) => x.row === 9)!.reason).toMatch(/never reopens an archived edition/);
      expect(res.rows.find((x) => x.row === 10)!.reason).toMatch(/Mega Expo.*Mini Expo|Mini Expo.*Mega Expo/);
      expect(res.rows.find((x) => x.row === 12)!.reason).toMatch(/real date/);
      expect(res.summary).toMatchObject({ rows: 14, newEvents: 1, newEditions: 3, present: 2, conflict: 2, review: 2, ambiguous: 1, invalid: 4, blocking: 9 });
      expect(res.applied).toBe(false);
      expect(await counts()).toEqual(before);                                              // a preview writes nothing
      // asking to APPLY a file that has rows to correct writes nothing either
      const blocked = await imp(U.sara, rows, true);
      expect(blocked).toMatchObject({ applied: false, blocked: true });
      expect(await counts()).toEqual(before);
    });
    it("applies a clean file in one batch under ONE event, visible to another company, and re-importing the same file adds nothing", async () => {
      const clean = [
        r(2, "Fictional Import Show", "2026-03-10", "2026-03-12"),
        r(3, "Fictional Import Show", "2027-03-09", "2027-03-11"),
        r(4, "Fictional New Expo", "2027-05-01", "2027-05-03", "SA", "Riyadh"),
        r(5, "fictional new-expo", "2028-05-01", "2028-05-03", "SA", "Riyadh"),
      ];
      const before = await counts();
      // a stale expectation (someone changed the calendar since the preview) writes nothing
      expect(await imp(U.sara, clean, true, 7)).toMatchObject({ applied: false, stale: true });
      expect(await counts()).toEqual(before);
      const done = await imp(U.sara, clean, true, 3);
      expect(done).toMatchObject({ applied: true, createdEvents: 1, createdEditions: 3 });
      expect(await counts()).toEqual({ events: before.events + 1, editions: before.editions + 3 });
      const mine = await admin<{ n: string; c: string }>(`select count(distinct d.event_id) n, count(*) c from crm_event_editions d join crm_events e on e.id = d.event_id where e.name = 'Fictional New Expo'`);
      expect(mine[0]).toMatchObject({ n: "1", c: "2" });                                   // both editions under ONE event, spelled as the first row
      expect((await admin<{ created_by: string }>(`select created_by from crm_events where name = 'Fictional New Expo'`))[0].created_by).toBe(U.sara);
      // another company's person (KSA only) sees the imported calendar
      expect(await q(U.faisal, `select d.id from crm_event_editions d join crm_events e on e.id = d.event_id where e.name = 'Fictional New Expo'`)).toHaveLength(2);
      // the same file again: everything is present, nothing is added, nothing duplicates
      const again = await imp(U.sara, clean, true);
      expect(again).toMatchObject({ applied: true, createdEvents: 0, createdEditions: 0 });
      expect(again.rows.every((x) => x.status === "present")).toBe(true);
      expect(await counts()).toEqual({ events: before.events + 1, editions: before.editions + 3 });
    });
    it("same dates count as ALREADY PRESENT only when country, city and venue match after normalisation; a mismatch needs review and blocks the batch (recorded editions and rows in one file)", async () => {
      const before = await counts();
      const rec = (over: Partial<ReturnType<typeof r>>) => ({ ...r(2, "Fictional Import Show", "2026-03-10", "2026-03-12"), ...over });
      const status = async (rows: unknown[]) => Object.fromEntries((await imp(U.sara, rows)).rows.map((x) => [x.row, x.status]));
      // matches after normalisation (case, spaces, punctuation) and a blank city / venue states nothing: present
      expect(await status([rec({ row: 2, city: "  DUBAI ", venue: "fictional  hall." }), rec({ row: 3, city: "", venue: "" })])).toEqual({ 2: "present", 3: "present" });
      // the same dates with another country (the UAE edition recorded, a KSA row), city or venue are flagged for review, not skipped
      const kinds = await imp(U.sara, [rec({ row: 2, country: "SA" }), rec({ row: 3, city: "Abu Dhabi" }), rec({ row: 4, venue: "Another Hall" })]);
      expect(kinds.rows.map((x) => x.status)).toEqual(["review", "review", "review"]);
      expect(kinds.rows[0]!.reason).toMatch(/country \(recorded AE, file SA\)/);
      expect(kinds.rows[1]!.reason).toMatch(/city \(recorded Dubai, file Abu Dhabi\)/);
      expect(kinds.rows[2]!.reason).toMatch(/venue \(recorded Fictional Hall, file Another Hall\)/);
      expect(kinds.rows.every((x) => /not treated as already present/.test(x.reason ?? ""))).toBe(true);
      // a mismatch blocks the WHOLE file: the valid new row beside it is not written either
      const mixed = [rec({ row: 2, country: "SA" }), r(3, "Fictional Import Show", "2029-03-09", "2029-03-11")];
      expect(await imp(U.sara, mixed, true)).toMatchObject({ applied: false, blocked: true, createdEditions: 0 });
      expect(await counts()).toEqual(before);
      // rows inside one file: same event and dates; a different country / city / venue is flagged, an identical row is a clean repeat
      const inFile = await imp(U.sara, [r(2, "Fictional Twin Expo", "2033-04-01", "2033-04-03", "AE", "Dubai", "Hall A"), r(3, "fictional twin-expo", "2033-04-01", "2033-04-03", "SA", "Dubai", "Hall A"),
        r(4, "Fictional Twin Expo", "2033-04-01", "2033-04-03", "AE", "Sharjah", "Hall A"), r(5, "Fictional Twin Expo", "2033-04-01", "2033-04-03", "AE", "dubai", "HALL A")]);
      expect(inFile.rows.map((x) => x.status)).toEqual(["new_event", "review", "review", "present"]);
      expect(inFile.rows[1]!.reason).toMatch(/row 2 of this file.*country \(recorded AE, file SA\)/);
      expect(inFile.rows[2]!.reason).toMatch(/city \(recorded Dubai, file Sharjah\)/);
      expect(await imp(U.sara, [r(2, "Fictional Twin Expo", "2033-04-01", "2033-04-03", "AE", "Dubai", "Hall A"), r(3, "Fictional Twin Expo", "2033-04-01", "2033-04-03", "SA", "Dubai", "Hall A")], true)).toMatchObject({ applied: false, blocked: true });
      expect(await counts()).toEqual(before);
    });
    it("needs a Sales grant; the whole batch rolls back with a clear message when a rule is broken underneath", async () => {
      await expect(imp(U.hr, [r(2, "Fictional No Grant Expo", "2030-01-01", "2030-01-02")])).rejects.toThrow(/Sales access|No CRM access/i);
      await expect(imp(U.stranger, [r(2, "Fictional No Grant Expo", "2030-01-01", "2030-01-02")], true)).rejects.toThrow(/Sales access|No CRM access/i);
      await expect(imp(U.sara, [])).rejects.toThrow(/no rows/);
      expect(await admin(`select 1 from crm_events where name = 'Fictional No Grant Expo'`)).toHaveLength(0);
    });
  });
});
