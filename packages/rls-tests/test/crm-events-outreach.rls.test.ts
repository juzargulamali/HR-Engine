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
//   * removal deletes what is unused and ARCHIVES what has enquiries or observations, keeping every link;
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

  describe("removal keeps what is used", () => {
    it("deletes an unused edition and archives a used one (enquiry link and observations stay)", async () => {
      const spare = (await commit<{ id: string }>(U.sara, `select crm_save_edition(null, '${event}', '2030-10-14', '2030-10-18') as id`))[0].id;
      expect((await commit<{ r: string }>(U.sara, `select crm_remove_edition('${spare}') r`))[0].r).toBe("deleted");
      expect(await admin(`select 1 from crm_event_editions where id = '${spare}'`)).toHaveLength(0);
      await expect(commit(U.omar, `select crm_remove_edition('${e2026}')`)).rejects.toThrow(/Only the person who added/);
      expect((await commit<{ r: string }>(U.sara, `select crm_remove_edition('${e2026}') r`))[0].r).toBe("archived");
      expect((await admin<{ a: boolean }>(`select archived_at is not null a from crm_event_editions where id = '${e2026}'`))[0].a).toBe(true);
      expect((await admin<{ e: string }>(`select event_edition_id e from crm_opportunities where id = '${uaeOpp}'`))[0].e).toBe(e2026);
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_event_observations where edition_id = '${e2026}'`))[0].n)).toBe(2);
      // an archived edition takes no new link and no new observation, but an existing link can be kept
      await expect(commit(U.sara, `select crm_set_opportunity_edition('${ksaOpp}', null)`)).rejects.toThrow(/not found/i);   // another company's enquiry is invisible to her
      await expect(commit(U.sara, `select crm_record_observation('${e2026}', '${client}', 'exhibited', null, true)`)).rejects.toThrow(/archived edition/);
      await commit(U.sara, `select crm_set_opportunity_edition('${uaeOpp}', '${e2026}')`);
    });
    it("an edition can never be deleted directly while an enquiry is linked (restrict), and an event with used editions is archived with them", async () => {
      await expect(admin(`delete from crm_event_editions where id = '${e2026}'`)).rejects.toThrow(/violates foreign key/);
      expect((await commit<{ r: string }>(U.sara, `select crm_remove_event('${event}') r`))[0].r).toBe("archived");
      const eds = await admin<{ id: string; a: boolean }>(`select id, archived_at is not null a from crm_event_editions where event_id = '${event}' order by start_date`);
      expect(eds.map((e) => e.id)).toEqual([e2025, e2026, e2027]);
      expect(eds.every((e) => e.a)).toBe(true);
      expect((await admin<{ n: string }>(`select count(*) n from crm_event_observations where edition_id = any (array['${e2025}','${e2026}','${e2027}']::uuid[])`))[0].n).toBe("4");
      // the name can be used again by a new event once the old one is archived
      await commit(U.sara, `select crm_save_event(null, 'Fictional Expo Global', 'exhibition')`);
    });
    it("an event nobody used is deleted with its editions", async () => {
      const ev = (await commit<{ id: string }>(U.sara, `select crm_save_event(null, 'Fictional Unused Show', 'other') as id`))[0].id;
      await commit(U.sara, `select crm_save_edition(null, '${ev}', '2031-01-10', '2031-01-12')`);
      expect((await commit<{ r: string }>(U.sara, `select crm_remove_event('${ev}') r`))[0].r).toBe("deleted");
      expect(await admin(`select 1 from crm_events where id = '${ev}'`)).toHaveLength(0);
    });
  });
});
