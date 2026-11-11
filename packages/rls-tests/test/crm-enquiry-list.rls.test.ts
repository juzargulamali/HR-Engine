import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The bounded Enquiries read (migration 20261229000100_crm_enquiry_list.sql). Fictional data only. Proves, against a real Postgres with every earlier migration:
//   * it returns ONE page while its counts cover every match: an old enquiry far beyond the page is found by its exact reference, and by agency or client name;
//   * the quick-filter counts (overdue, due today, awaiting first response, no next action) follow the screens' definitions, are counted over the filters without
//     the need filter, and each equals the rows that need returns;
//   * the board form returns the first cards of each lane with lane counts and per-currency totals over every match;
//   * it runs as the caller: a person with no grant for a company neither sees nor counts its enquiries; without any grant it returns nothing; anon cannot call it;
//   * sorting is stable with missing values last; what is typed is searched as text; it writes nothing; the owner pack verifies and rolls back.

const MIGRATION = "20261229000100_crm_enquiry_list.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), faisal: id(), hr: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@enqlist-test.ae')`).join(", ");

type Row = { id: string; reference: string; title: string; stage: string; owner_id: string; company_id: string; value: number | null; currency: string; agency_name: string | null; client_name: string | null; open_follow_ups: number; next: { title: string; due_at: string } | null; first_response_at: string | null };
type Result = { total: number; matched: number; needs: Record<string, number>; stages: { stage: string; count: number; unvalued: number; totals: Record<string, number> }[]; rows: Row[] };

describe("crm_enquiry_list: one page, counts over every match, read as the caller", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as T[];
  const call = async (user: string | null, args = "") => (await db.asUser(user, async (query) => (await query(`select crm_enquiry_list(${args}) as r`, [])).rows as { r: Result }[]))[0]!.r;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  let harbour: string; let agency: string; let generic: string;
  let oldest: string;

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.ksa}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.faisal}', '${CO.ksa}', '{}');
      insert into user_roles (user_id, role) values ('${U.hr}', 'hr_admin');
    `);
    harbour = (await db.asUserCommit(U.founder, async (q) => (await q(`select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`, [])).rows as { id: string }[]))[0]!.id;
    agency = (await db.asUserCommit(U.founder, async (q) => (await q(`select crm_create_organisation_profile(p_name => 'Fictional 100% Agency_Co', p_roles => '{agency}', p_country_code => 'AE') as id`, [])).rows as { id: string }[]))[0]!.id;
    generic = (await db.asUserCommit(U.founder, async (q) => (await q(`select crm_create_organisation_profile(p_name => 'Fictional Generic Client', p_roles => '{client}', p_country_code => 'AE') as id`, [])).rows as { id: string }[]))[0]!.id;
    // 1,300 UAE enquiries inserted directly (fixtures only): number 1 is the OLDEST. Stages cycle; values in two currencies; every tenth has no value.
    await db.seed(`
      alter table crm_opportunities disable trigger user;
      insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, stage, created_at, currency, value, first_response_at, closed_at, lost_reason,
                                     evidence_type, evidence_reference, evidence_date, client_org_id, agency_org_id)
      select '${CO.uae}', 'OPP-UAE-2020-' || lpad(n::text, 4, '0'), 'Fictional enquiry ' || n, 'website',
             case when n % 3 = 0 then '${U.omar}'::uuid else '${U.sara}'::uuid end, '${U.sara}',
             case when n % 20 = 0 then 'won' when n % 23 = 0 then 'lost' when n % 7 = 0 then 'estimate_sent' else 'qualified' end,
             timestamptz '2020-01-01 08:00+00' + (n || ' hours')::interval,
             case when n % 2 = 0 then 'AED' else 'EUR' end, case when n % 10 = 0 then null else 1000 + n end,
             case when n % 5 = 0 then null else timestamptz '2020-01-02 08:00+00' + (n || ' hours')::interval end,
             case when n % 20 = 0 or n % 23 = 0 then now() end, case when n % 23 = 0 and n % 20 <> 0 then 'Event cancelled' end,
             case when n % 20 = 0 then 'purchase_order' end, case when n % 20 = 0 then 'PO-' || n end, case when n % 20 = 0 then current_date end,
             case when n = 1 then '${harbour}'::uuid when n = 2 then null else '${generic}'::uuid end, case when n = 2 then '${agency}'::uuid end
      from generate_series(1, 1300) n;
      insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, stage, currency, client_org_id)
      select '${CO.ksa}', 'OPP-KSA-2020-' || lpad(n::text, 4, '0'), 'Fictional Saudi enquiry ' || n, 'website', '${U.faisal}', '${U.faisal}', 'qualified', 'SAR', '${generic}' from generate_series(1, 5) n;
      alter table crm_opportunities enable trigger user;
    `);
    oldest = (await admin<{ id: string }>(`select id from crm_opportunities where reference = 'OPP-UAE-2020-0001'`))[0]!.id;
    // Follow-ups: the oldest enquiry has an overdue one and a later one; enquiry 3 is due later today (Dubai); enquiry 4 is upcoming; the rest have none.
    await db.seed(`
      alter table crm_follow_ups disable trigger user;
      insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, status, created_by)
      select o.id, o.company_id, o.owner_id, v.title, 'call', v.due, 'open', o.owner_id
      from (values ('OPP-UAE-2020-0001', 'Fictional overdue call', now() - interval '3 days'), ('OPP-UAE-2020-0001', 'Fictional later call', now() + interval '9 days'),
                   ('OPP-UAE-2020-0003', 'Fictional call today', least(now() + interval '1 minute', ((now() at time zone 'Asia/Dubai')::date + time '23:59:59') at time zone 'Asia/Dubai')),
                   ('OPP-UAE-2020-0004', 'Fictional call next week', now() + interval '7 days'),
                   ('OPP-UAE-2020-0020', 'Fictional follow-up on a won enquiry', now() - interval '5 days')) as v(reference, title, due)
      join crm_opportunities o on o.reference = v.reference;
      alter table crm_follow_ups enable trigger user;
    `);
    await db.seed(pack("crm_enquiry_list_00_preflight_readonly.sql"));
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);
  }, 180_000);
  afterAll(async () => { await db.teardown(); });

  it("the owner pack verifies", async () => {
    const rows = await admin<{ n: number; result: string }>(pack("crm_enquiry_list_20_verify_readonly.sql"));
    expect(rows.map((r) => r.result)).toEqual(["OK", "OK", "OK", "OK"]);
  });

  it("returns one page and counts every match; the oldest enquiry is found by exact reference far beyond the page", async () => {
    const first = await call(U.sara, `p_status => 'all', p_sort => 'created', p_dir => 'desc', p_limit => 100`);
    expect(first.total).toBe(1300);                                       // Sara has no KSA grant: its five enquiries are not counted
    expect(first.matched).toBe(1300);
    expect(first.rows).toHaveLength(100);
    expect(first.rows[0]!.reference).toBe("OPP-UAE-2020-1300");
    const second = await call(U.sara, `p_status => 'all', p_sort => 'created', p_dir => 'desc', p_limit => 100, p_offset => 100`);
    expect(second.rows[0]!.reference).toBe("OPP-UAE-2020-1200");
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(200);   // stable paging: no row twice
    const hit = await call(U.sara, `p_q => 'OPP-UAE-2020-0001'`);
    expect(hit.matched).toBe(1);
    expect(hit.rows[0]).toMatchObject({ reference: "OPP-UAE-2020-0001", client_name: "Fictional Harbour Client", open_follow_ups: 2, next: { title: "Fictional overdue call" } });
  });

  it("searches the agency and end-client names and the title as plain text (a % or _ typed is not a wildcard)", async () => {
    expect((await call(U.sara, `p_q => 'harbour'`)).rows.map((r) => r.reference)).toEqual(["OPP-UAE-2020-0001"]);
    expect((await call(U.sara, `p_q => '100% agency_co'`)).rows.map((r) => r.reference)).toEqual(["OPP-UAE-2020-0002"]);
    expect((await call(U.sara, `p_q => '%'`)).matched).toBe(1);            // only the organisation whose NAME contains a percent sign
    expect((await call(U.sara, `p_q => '_'`)).matched).toBe(1);
    expect((await call(U.sara, `p_q => 'fictional enquiry 1299'`)).rows.map((r) => r.reference)).toEqual(["OPP-UAE-2020-1299"]);
    expect((await call(U.sara, `p_q => 'no such thing'`))).toMatchObject({ matched: 0, rows: [] });
  });

  it("the quick-filter counts follow the screens' definitions, ignore the need filter, and each equals the rows that need returns", async () => {
    const all = await call(U.sara, `p_status => 'open'`);
    const expected = (await admin<{ overdue: number; due_today: number; nfr: number; nna: number; open: number }>(`
      select count(*) filter (where reference = 'OPP-UAE-2020-0001')::int as overdue, count(*) filter (where reference = 'OPP-UAE-2020-0003')::int as due_today,
             count(*) filter (where first_response_at is null)::int as nfr,
             count(*) filter (where reference not in ('OPP-UAE-2020-0001', 'OPP-UAE-2020-0003', 'OPP-UAE-2020-0004'))::int as nna, count(*)::int as open
      from crm_opportunities where company_id = '${CO.uae}' and stage not in ('won', 'lost')`))[0]!;
    expect(all.matched).toBe(expected.open);
    expect(all.needs).toEqual({ overdue: expected.overdue, due_today: expected.due_today, no_first_response: expected.nfr, no_next_action: expected.nna });
    for (const need of ["overdue", "due_today", "no_first_response", "no_next_action"]) {
      const r = await call(U.sara, `p_status => 'open', p_need => '${need}', p_limit => 500`);
      expect(r.matched, need).toBe(all.needs[need]);
      expect(r.needs, need).toEqual(all.needs);                          // the chips keep their counts while one is chosen
      if (r.matched <= 500) expect(r.rows, need).toHaveLength(r.matched);
    }
    expect((await call(U.sara, `p_need => 'overdue'`)).rows.map((r) => r.reference)).toEqual(["OPP-UAE-2020-0001"]);
    expect((await call(U.sara, `p_need => 'due_today'`)).rows.map((r) => r.reference)).toEqual(["OPP-UAE-2020-0003"]);
    // A closed enquiry needs nothing, even with an old open follow-up on it.
    expect((await call(U.sara, `p_status => 'closed'`)).needs).toEqual({ overdue: 0, due_today: 0, no_first_response: 0, no_next_action: 0 });
    // The counts follow the other filters: Omar's enquiries only.
    const omar = await call(U.sara, `p_owner => '${U.omar}'`);
    expect(omar.needs.overdue).toBe(0);
    expect(omar.rows.every((r) => r.owner_id === U.omar)).toBe(true);
  });

  it("company, owner, stage and status are applied; a stage wins over the status; an id list restricts", async () => {
    const won = await call(U.sara, `p_stage => 'won', p_status => 'open'`);
    expect(won.matched).toBe(65);
    expect(won.rows.every((r) => r.stage === "won")).toBe(true);
    const closed = await call(U.sara, `p_status => 'closed'`);
    const open = await call(U.sara, `p_status => 'open'`);
    expect(closed.matched + open.matched).toBe(1300);
    expect((await call(U.founder, `p_company => '${CO.ksa}'`)).matched).toBe(5);
    expect((await call(U.sara, `p_ids => array['${oldest}']::uuid[], p_status => 'all'`)).rows.map((r) => r.id)).toEqual([oldest]);
    expect((await call(U.sara, `p_ids => '{}'::uuid[], p_status => 'all'`)).matched).toBe(0);
  });

  it("board form: the first cards of each lane by next due time, with lane counts and per-currency totals over every match", async () => {
    const board = await call(U.sara, `p_status => 'all', p_per_stage => 3`);
    const lanes = Object.fromEntries(board.stages.map((s) => [s.stage, s]));
    const truth = await admin<{ stage: string; n: number; unvalued: number; aed: number | null; eur: number | null }>(`
      select stage, count(*)::int n, count(*) filter (where value is null)::int unvalued, sum(value) filter (where currency = 'AED')::float aed, sum(value) filter (where currency = 'EUR')::float eur
      from crm_opportunities where company_id = '${CO.uae}' group by stage`);
    for (const t of truth) {
      expect(lanes[t.stage], t.stage).toMatchObject({ count: t.n, unvalued: t.unvalued });
      expect(lanes[t.stage]!.totals.AED ?? null, t.stage).toBe(t.aed);
      expect(lanes[t.stage]!.totals.EUR ?? null, t.stage).toBe(t.eur);
    }
    for (const stage of Object.keys(lanes)) expect(board.rows.filter((r) => r.stage === stage), stage).toHaveLength(3);
    expect(board.rows.filter((r) => r.stage === "qualified")[0]!.reference).toBe("OPP-UAE-2020-0001");   // the overdue one leads its lane
    expect(board.matched).toBe(1300);
  });

  it("sorting: by next due with missing values last in both directions, by value within a currency, by owner in the order given, by stage", async () => {
    const asc = await call(U.sara, `p_sort => 'due', p_dir => 'asc', p_limit => 4`);
    expect(asc.rows.map((r) => r.reference)).toEqual(["OPP-UAE-2020-0001", "OPP-UAE-2020-0003", "OPP-UAE-2020-0004", "OPP-UAE-2020-0002"]);
    const desc = await call(U.sara, `p_sort => 'due', p_dir => 'desc', p_limit => 4`);
    expect(desc.rows.slice(0, 3).map((r) => r.reference)).toEqual(["OPP-UAE-2020-0004", "OPP-UAE-2020-0003", "OPP-UAE-2020-0001"]);
    expect(desc.rows[3]!.next).toBeNull();
    const value = await call(U.sara, `p_sort => 'value', p_dir => 'desc', p_limit => 3`);
    expect(value.rows.map((r) => r.currency)).toEqual(["AED", "AED", "AED"]);
    expect(value.rows[0]!.value!).toBeGreaterThan(value.rows[1]!.value!);
    const byOwner = await call(U.sara, `p_sort => 'owner', p_owner_order => array['${U.omar}', '${U.sara}']::uuid[], p_limit => 1`);
    expect(byOwner.rows[0]!.owner_id).toBe(U.omar);
    const byStage = await call(U.sara, `p_status => 'all', p_sort => 'stage', p_dir => 'desc', p_limit => 1`);
    expect(byStage.rows[0]!.stage).toBe("lost");
  });

  it("is read as the caller: another company's enquiries are neither returned nor counted; no grant returns nothing; anon cannot call it; nothing is written", async () => {
    const faisal = await call(U.faisal, `p_status => 'all'`);
    expect(faisal).toMatchObject({ total: 5, matched: 5 });
    expect(faisal.rows.every((r) => r.company_id === CO.ksa)).toBe(true);
    expect((await call(U.faisal, `p_q => 'OPP-UAE-2020-0001', p_status => 'all'`)).matched).toBe(0);
    expect((await call(U.faisal, `p_company => '${CO.uae}', p_status => 'all'`)).matched).toBe(0);
    expect((await call(U.founder, `p_status => 'all'`)).total).toBe(1305);
    expect(await call(U.hr, `p_status => 'all'`)).toMatchObject({ total: 0, matched: 0, rows: [] });
    await expect(call(null, "")).rejects.toThrow(/permission denied/);
    const before = (await admin<{ h: string }>(`select md5(string_agg(id::text || version::text || stage, ',' order by id)) h from crm_opportunities`))[0]!.h;
    await call(U.sara, `p_status => 'all', p_need => 'overdue'`);
    expect((await admin<{ h: string }>(`select md5(string_agg(id::text || version::text || stage, ',' order by id)) h from crm_opportunities`))[0]!.h).toBe(before);
  });

  it("the rollback pack drops only the function", async () => {
    await db.seed(pack("crm_enquiry_list_90_rollback.sql"));
    await db.seed(pack("crm_enquiry_list_90_rollback.sql"));
    expect((await admin<{ f: string | null; n: number }>(`select to_regprocedure('public.crm_enquiry_list(uuid, uuid, text, text, text, text, uuid[], text, text, uuid[], integer, integer, integer)')::text f, (select count(*)::int from crm_opportunities) n`))[0]).toEqual({ f: null, n: 1305 });
  });
});
