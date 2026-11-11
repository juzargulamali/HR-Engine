import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The reads behind the JARVIS Sales lookups and summaries (apps/web/src/lib/jarvis/sales/lookup.ts, summary.ts), against a real Postgres with the real policies. Fictional
// data only. No migration belongs to this work: these capabilities use the existing tables and the existing read policies (crm_has_access / crm_has_any_access).
//   * the column lists of sales/projection.ts are real columns, and none of them is a financial column;
//   * a person reads only the companies they hold a Sales grant for: another company's enquiries, follow-ups, activities and closures return nothing and count as zero,
//     also when asked for by id; a person with no grant reads nothing; a revoked grant stops the next read;
//   * an exact count is independent of the 25-row page.
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const projection = readFileSync(path.join(__dirname, "../../../apps/web/src/lib/jarvis/sales/projection.ts"), "utf8");
const columns = (name: string) => { const m = new RegExp(`export const ${name} = "([^"]+)"`).exec(projection); if (!m) throw new Error(`no column list ${name}`); return m[1]!; };
const FINANCIAL = /export const FINANCIAL_COLUMNS = \[([^\]]+)\]/.exec(projection)![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { sara: id(), omar: id(), ksaStaff: id(), outsider: id() };

describe("JARVIS Sales lookups and summaries: the reads, under the real policies", () => {
  const db = new RlsTestDatabase();
  const commit = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as T[]);
  const ENQ = columns("ENQUIRY_COLUMNS");
  const open = (user: string, company: string) => commit<{ title: string; owner_id: string }>(user, `select ${ENQ} from crm_opportunities where company_id = $1 and stage in ('new','qualified','proposal_prep','proposal_sent','quote_sent','negotiation','on_hold') order by created_at desc limit 25`, [company]);
  const count = async (user: string, sql: string, params: unknown[]) => Number((await commit<{ n: string }>(user, `select count(*) as n from ${sql}`, params))[0]!.n);
  let uaeEnquiry = "", ksaEnquiry = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA LLC', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@jarvis-queries-test.ae')`).join(", ")};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR');
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sara}', '${CO.uae}', '{founder}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaStaff}', '${CO.ksa}', '{founder}');
    `);
    await db.seed(`update profiles set is_active = true where id in ('${U.sara}', '${U.omar}', '${U.ksaStaff}', '${U.outsider}')`);
    const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const mk = async (user: string, company: string, title: string) => {
      const org = (await commit<{ id: string }>(user, `select crm_create_organisation_profile(p_name => $1, p_roles => '{client}', p_country_code => 'AE') as id`, [`Fictional client for ${title}`]))[0]!.id;
      return (await commit<{ id: string }>(user, `select crm_create_opportunity(p_company_id => $1, p_title => $2, p_source => 'whatsapp', p_next_title => $3, p_next_due => $4, p_client_org_id => $5, p_value => 918273, p_budget_note => 'Stored budget AED 918,273') as id`, [company, title, `Call about ${title}`, SOON, org]))[0]!.id;
    };
    uaeEnquiry = await mk(U.sara, CO.uae, "Fictional harbour gala");
    for (let i = 0; i < 29; i++) await mk(i % 2 ? U.sara : U.omar, CO.uae, `Fictional UAE job ${i}`);
    ksaEnquiry = await mk(U.ksaStaff, CO.ksa, "Fictional Riyadh expo");
    await db.seed(`insert into crm_activities (opportunity_id, company_id, kind, body, created_by) values ('${uaeEnquiry}', '${CO.uae}', 'call', 'Spoke to the agency', '${U.sara}'), ('${ksaEnquiry}', '${CO.ksa}', 'call', 'Spoke to the Riyadh client', '${U.ksaStaff}')`);
  });
  afterAll(async () => { await db.teardown(); });

  it("every column list of the projection names real columns, and none is a financial column", async () => {
    for (const [list, table] of [["ENQUIRY_COLUMNS", "crm_opportunities"], ["ENQUIRY_TEXT_COLUMNS", "crm_opportunities"], ["FOLLOW_UP_COLUMNS", "crm_follow_ups"], ["ACTIVITY_COLUMNS", "crm_activities"], ["ACTIVITY_TEXT_COLUMNS", "crm_activities"]] as const) {
      const cols = columns(list);
      expect(await commit(U.sara, `select ${cols} from ${table} limit 0`), list).toEqual([]);
      for (const c of cols.split(",").map((x) => x.trim())) expect(FINANCIAL, `${list}.${c}`).not.toContain(c);
    }
    // the other reads the lookups and summaries make
    for (const sql of ["select id, name from crm_organisations where archived_at is null limit 0", "select id, name from crm_events where archived_at is null limit 0", "select id, event_id from crm_event_editions limit 0", "select id from crm_closures where reopened_at is not null limit 0", "select id, lost_reason from crm_opportunities limit 0", "select id, source, event_edition_id, stage from crm_opportunities limit 0", "select legal_name from companies limit 0"]) expect(await commit(U.sara, sql), sql).toEqual([]);
    // the projected row carries no value or budget, even though the enquiry has both
    const row = (await commit<Record<string, unknown>>(U.sara, `select ${ENQ} from crm_opportunities where id = $1`, [uaeEnquiry]))[0]!;
    expect(JSON.stringify(row)).not.toMatch(/918273|Stored budget/);
    expect(Object.keys(row).sort()).toEqual(ENQ.split(",").map((c) => c.trim()).sort());
  });

  it("the company-wide view is what a Sales grant already allows: every enquiry of the company for any holder, never another company's", async () => {
    // Omar holds a plain Sales grant (no founder capability): he sees the same enquiries of the company that the Enquiries screen shows him
    expect(await count(U.omar, "crm_opportunities where company_id = $1", [CO.uae])).toBe(30);
    expect(await count(U.sara, "crm_opportunities where company_id = $1", [CO.uae])).toBe(30);
    expect((await open(U.omar, CO.uae)).length).toBe(25); // the page
    expect(new Set((await open(U.omar, CO.uae)).map((r) => r.owner_id)).size).toBe(2); // other owners' enquiries included, as on the screen
    // personal scope is a filter on top of it
    expect(await count(U.omar, "crm_opportunities where company_id = $1 and owner_id = $2", [CO.uae, U.omar])).toBe(15);
  });

  it("another company is invisible: rows, counts and lookups by id all return nothing", async () => {
    for (const [user, company, enquiry] of [[U.sara, CO.ksa, ksaEnquiry], [U.omar, CO.ksa, ksaEnquiry], [U.ksaStaff, CO.uae, uaeEnquiry], [U.outsider, CO.uae, uaeEnquiry]] as const) {
      expect(await open(user, company)).toEqual([]);
      for (const t of ["crm_opportunities", "crm_follow_ups", "crm_activities", "crm_closures"]) expect(await count(user, `${t} where company_id = $1`, [company]), `${t}`).toBe(0);
      expect(await commit(user, `select ${ENQ} from crm_opportunities where id = $1`, [enquiry])).toEqual([]);
      expect(await commit(user, `select id from crm_follow_ups where opportunity_id = $1`, [enquiry])).toEqual([]);
      expect(await commit(user, `select id, body from crm_activities where opportunity_id = $1`, [enquiry])).toEqual([]);
    }
    // a person with no grant cannot read the shared directory either
    expect(await count(U.outsider, "crm_organisations", [])).toBe(0);
  });

  it("a revoked grant stops the next read and the next count", async () => {
    await db.seed(`update crm_company_grants set revoked_at = now() where user_id = '${U.omar}'`);
    expect(await open(U.omar, CO.uae)).toEqual([]);
    expect(await count(U.omar, "crm_opportunities where company_id = $1", [CO.uae])).toBe(0);
    expect(await count(U.omar, "crm_follow_ups where company_id = $1 and assigned_to = $2", [CO.uae, U.omar])).toBe(0);
  });
});
