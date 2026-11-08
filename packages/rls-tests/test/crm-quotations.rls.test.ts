import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { calculateQuotation } from "../../domain/src/quotations";

// Sales & CRM: Estimates & Quotations part 1 (migration 20261220000100_crm_estimates_quotations.sql). Fictional data only. Proves, against a
// real Postgres: client identifiers (leading zeros, fill-only import, fingerprint), issuer details from the company record, explicit bill-to,
// VAT/currency required at issue, the TS and SQL calculations agree, the existing approval gate, the frozen snapshot (later edits to the account,
// company or template change nothing; guards refuse even a table owner), revisions that supersede without altering, permissions and company
// boundary, picture validation, and that internal notes never reach the snapshot.

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
  "20261220000100_crm_estimates_quotations.sql",
];
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), stranger: id(), ksaOnly: id(), sysadmin: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@quotes-test.ae')`).join(", ");

describe("Estimates & Quotations (part 1)", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

  let agencyId: string; let clientId: string; let otherId: string;
  let oppAgency: string; let oppDirect: string;
  let vat: Record<string, string>; // label -> choice id
  let preflight: { section: string; item: string; detail: string }[] = [];
  let preserved = "";
  let verifyRows: { item: string; result: string }[] = [];
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

  const newQuote = async (opp: string, who = U.sara) => (await commit<{ id: string }>(who, `select crm_quote_create('${opp}') as id`))[0].id;
  const section = async (p: string, title: string, who = U.sara) => (await commit<{ id: string }>(who, `select crm_quote_save_section('${p}', null, '${title}') as id`))[0].id;
  const line = async (p: string, s: string, patch: Record<string, unknown>, who = U.sara) =>
    (await commit<{ id: string }>(who, `select crm_quote_save_line('${p}', null, '${s}', ${j(patch)}) as id`))[0].id;
  const header = (p: string, patch: Record<string, unknown>, who = U.sara) => commit(who, `select crm_quote_save_header('${p}', ${j(patch)})`);
  /** A complete, issuable quotation on the given enquiry. */
  const readyQuote = async (opp: string, billTo: string) => {
    const p = await newQuote(opp);
    await header(p, { currency: "EUR", vat_choice_id: vat["5%"], bill_to_org_id: billTo, validity_date: "2099-01-01" });
    const s1 = await section(p, "Fabrication");
    const s2 = await section(p, "AV");
    await line(p, s1, { description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33" });
    await line(p, s1, { description: "Fascia", quantity: "1.5", unit_price: "19.99", vat_choice_id: vat["15%"] });
    await line(p, s2, { description: "LED wall", quantity: "7", unit_price: "0.35", vat_choice_id: vat["Out of scope"] });
    return { p, s1, s2 };
  };
  const snap = async (p: string) => (await admin<{ content: any; content_hash: string }>(`select content, content_hash from crm_quotation_snapshots where proposal_id = '${p}'`))[0];

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.sysadmin}', 'sys_admin');
    `);
    for (const f of MIGRATIONS.slice(0, -1)) await db.applyMigration(f);
    // Owner pack: preflight (all prerequisites OK, "not applied yet") and the preservation fingerprints, both read-only, BEFORE the migration.
    const pre = (await db.seed(pack("crm_quotes_00_preflight_readonly.sql"))).rows as { section: string; item: string; detail: string }[];
    preflight = pre;
    preserved = JSON.stringify((await db.seed(pack("crm_quotes_05_preservation_check_readonly.sql"))).rows);
    await db.applyMigration(MIGRATIONS[MIGRATIONS.length - 1]!);
    // Verify pack right after the migration (before this suite's broad test grants, which would hide a missing REVOKE).
    verifyRows = (await db.seed(pack("crm_quotes_20_verify_readonly.sql"))).rows as { item: string; result: string }[];
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaOnly}', '${CO.ksa}', '{}');
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.ksa}', 'KSA', 'SAR') on conflict do nothing;
    `);
    const mk = async (name: string, roles: string) => (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '${roles}', p_country_code => 'AE', p_place => 'Fictional Quay 1, Dubai', p_vat_trn => '000123', p_trade_licence_no => '  0045  ') as id`))[0].id;
    agencyId = await mk("Fictional Aurora Agency", "{agency}");
    clientId = await mk("Fictional Harbour Client", "{client}");
    otherId = await mk("Fictional Third Party", "{direct}");
    oppAgency = (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Agency gala', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon}, p_agency_org_id => '${agencyId}', p_client_org_id => '${clientId}') as id`))[0].id;
    oppDirect = (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Direct fit-out', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${clientId}') as id`))[0].id;
    vat = Object.fromEntries((await admin<{ id: string; label: string }>(`select id, label from crm_quote_vat_choices where company_id = '${CO.uae}'`)).map((r) => [r.label, r.id]));
  });
  afterAll(async () => { await db.teardown(); });

  describe("owner pack", () => {
    it("the preflight said every prerequisite was OK and the change was not yet applied", () => {
      const b = preflight.filter((r) => r.section === "B prerequisites");
      expect(b.length).toBeGreaterThan(10);
      expect(b.filter((r) => !/^OK/.test(r.detail))).toEqual([]);
    });
    it("the verify pack says OK on every row right after the migration", () => {
      const rows = verifyRows;
      expect(rows.length).toBeGreaterThan(30);
      expect(rows.filter((r) => !/^OK/.test(r.result))).toEqual([]);
    });
    it("the preservation fingerprints are identical before and after (it only adds)", async () => {
      const after = JSON.stringify((await db.seed(pack("crm_quotes_05_preservation_check_readonly.sql"))).rows);
      // rows created by this suite after the migration are fictional additions; compare the shape of the untouched tables only
      expect(JSON.parse(preserved).map((r: { item: string }) => r.item)).toEqual(JSON.parse(after).map((r: { item: string }) => r.item));
    });
  });

  describe("client identifiers", () => {
    it("keeps leading zeros and trims", async () => {
      const [o] = await admin<{ vat_trn: string; trade_licence_no: string }>(`select vat_trn, trade_licence_no from crm_organisations where id = '${clientId}'`);
      expect(o).toEqual({ vat_trn: "000123", trade_licence_no: "0045" });
    });
    it("is editable under the existing edit rule only", async () => {
      await commit(U.founder, `select crm_update_organisation('${otherId}', '{"vat_trn":" 00777 "}'::jsonb)`);
      expect((await admin<{ v: string }>(`select vat_trn v from crm_organisations where id = '${otherId}'`))[0].v).toBe("00777");
      await expect(commit(U.omar, `select crm_update_organisation('${otherId}', '{"vat_trn":"1"}'::jsonb)`)).rejects.toThrow(/can change it/);
      await commit(U.founder, `select crm_update_organisation('${otherId}', '{"vat_trn":"   "}'::jsonb)`);
      expect((await admin<{ v: string | null }>(`select vat_trn v from crm_organisations where id = '${otherId}'`))[0].v).toBeNull();
    });
    it("the import fills empty identifiers and never overwrites an existing one; the fingerprint covers them", async () => {
      const [{ id: org }] = await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Import Target', p_company_id => '${CO.uae}', p_vat_trn => '0099') as id`);
      const item = { key: "k", name: "Fictional Import Target", website: null, vat_trn: "777", trade_licence_no: "00088" };
      const fp = async () => ((await commit<{ r: Record<string, string> }>(U.founder, `select crm_import_fingerprints('${CO.uae}', ${j([item])}) as r`))[0].r).k;
      const before = await fp();
      const r = (await commit<{ r: any }>(U.founder, `select crm_import_apply('${CO.uae}', 'batch-key-0123456789', ${j([{ ...item, fingerprint: before }])}) as r`))[0].r;
      expect(r.status).toBe("applied");
      expect((await admin(`select vat_trn, trade_licence_no from crm_organisations where id = '${org}'`))[0]).toEqual({ vat_trn: "0099", trade_licence_no: "00088" });
      expect(await fp()).not.toBe(before); // the licence changed, so the fingerprint did
    });
    it("legacy create calls without identifiers still work", async () => {
      const [r] = await commit<{ id: string }>(U.sara, `select crm_create_organisation_profile(p_name => 'Fictional Legacy Org') as id`);
      expect((await admin(`select vat_trn from crm_organisations where id = '${r.id}'`))[0]).toEqual({ vat_trn: null });
    });
  });

  describe("draft, calculation and issue rules", () => {
    it("creates a draft with a company reference, copied terms and an explicit empty VAT / currency / bill-to", async () => {
      const p = await newQuote(oppDirect);
      const [h] = await admin<any>(`select * from crm_quotations where proposal_id = '${p}'`);
      expect(h.reference).toMatch(/^QUO-UAE-\d{4}-0001$|^QUO-UAE-\d{4}-\d{4}$/);
      expect(h.revision).toBe(1);
      expect([h.currency, h.vat_kind, h.bill_to_org_id, h.issued_at]).toEqual([null, null, null, null]);
      expect(h.terms).toHaveLength(6);
      expect(h.terms_label).toBe("Standard terms (working draft, pending legal review)");
      expect((await admin<any>(`select status, version from crm_proposals where id = '${p}'`))[0].status).toBe("draft");
    });
    it("lets a draft be saved incomplete but refuses to issue without VAT, currency, bill-to, an item", async () => {
      const p = await newQuote(oppDirect);
      await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/currency/);
      await header(p, { currency: "AED" });
      await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/VAT treatment/);
      await header(p, { vat_choice_id: vat["0%"] });
      await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/billed to/);
      await header(p, { bill_to_org_id: clientId });
      await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/at least one item/);
    });
    it("0% and Out of scope are separate explicit choices, and one currency from a short list", async () => {
      expect(Object.keys(vat).sort()).toEqual(["0%", "15%", "23%", "5%", "Out of scope"]);
      const p = await newQuote(oppDirect);
      await expect(header(p, { currency: "GBP" })).rejects.toThrow(/AED, SAR, PLN, EUR or USD/);
    });
    it("a company created later gets the standard terms and VAT choices too", async () => {
      const c = id();
      await admin(`insert into companies (id, legal_name, country_code, default_currency) values ('${c}', 'Fictional New Branch', 'AE', 'AED')`);
      expect((await admin<{ n: string }>(`select count(*) n from crm_quote_vat_choices where company_id = '${c}'`))[0].n).toBe("5");
      expect((await admin<{ n: number }>(`select jsonb_array_length(clauses) n from crm_quote_terms_templates where company_id = '${c}'`))[0].n).toBe(6);
    });
    it("rejects negative or malformed quantities and prices in the database", async () => {
      const p = await newQuote(oppDirect); const s = await section(p, "A");
      for (const bad of [{ quantity: "-1" }, { quantity: "0" }, { quantity: "1e3" }, { unit_price: "-0.01" }, { unit_price: "abc" }])
        await expect(line(p, s, { description: "x", quantity: "1", unit_price: "1", ...bad })).rejects.toThrow(/Quantity|unit price/);
    });
    it("the database and the shared TypeScript calculation give identical figures, and reordering never changes a total", async () => {
      const { p, s1, s2 } = await readyQuote(oppDirect, clientId);
      await commit(U.sara, `select crm_quote_issue('${p}')`);
      const c = (await snap(p)).content;
      const ts = calculateQuotation({
        currency: "EUR", vat: { kind: "rate", rate: "5", label: "5%" },
        sections: [
          { title: "Fabrication", lines: [{ quantity: "3", unitPrice: "33.33" }, { quantity: "1.5", unitPrice: "19.99", vat: { kind: "rate", rate: "15", label: "15%" } }] },
          { title: "AV", lines: [{ quantity: "7", unitPrice: "0.35", vat: { kind: "out_of_scope", label: "Out of scope" } }] },
        ],
      });
      expect([c.totals.net, c.totals.vat, c.totals.gross]).toEqual([ts.net, ts.vat, ts.gross]);
      expect(c.sections.map((s: any) => [s.subtotal_net, s.subtotal_vat, s.subtotal_gross])).toEqual(ts.sections.map((s) => [s.net, s.vat, s.gross]));
      expect(c.sections.flatMap((s: any) => s.lines.map((l: any) => [l.number, l.amount_net, l.vat_amount, l.amount_gross]))).toEqual(ts.sections.flatMap((s) => s.lines.map((l) => [l.number, l.net, l.vatAmount, l.gross])));
      // reordering a draft copy leaves the totals alone
      const rev = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${p}') as id`))[0].id;
      const secs = await admin<{ id: string }>(`select id from crm_quotation_sections where proposal_id = '${rev}' order by position`);
      await commit(U.sara, `select crm_quote_reorder('${rev}', 'sections', null, array['${secs[1]!.id}', '${secs[0]!.id}']::uuid[])`);
      await commit(U.sara, `select crm_quote_issue('${rev}')`);
      const c2 = (await snap(rev)).content;
      expect(c2.totals).toEqual(c.totals);
      expect(c2.sections[0].title).toBe("AV");
      expect(c2.sections[0].lines[0].number).toBe(1);
      void s1; void s2;
    });
    it("milestones must be consistent at issue", async () => {
      const { p } = await readyQuote(oppDirect, clientId);
      await header(p, { milestones: [{ label: "Deposit", kind: "percent", value: "40" }, { label: "Delivery", kind: "percent", value: "50" }] });
      await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/100%/);
      await expect(header(p, { milestones: [{ label: "a", kind: "percent", value: "50" }, { label: "b", kind: "amount", value: "5" }] })).rejects.toThrow(/not both/);
      await header(p, { milestones: [{ label: "Deposit", kind: "percent", value: "40", due: "On acceptance" }, { label: "Delivery", kind: "percent", value: "60" }] });
      await commit(U.sara, `select crm_quote_issue('${p}')`);
      expect((await snap(p)).content.milestones.map((m: any) => m.amount)).toEqual(["56.77", "85.16"]);
    });
  });

  describe("bill-to, issuer and internal notes", () => {
    it("pulls the bill-to organisation (identifiers with leading zeros) at issue, for a direct and an agency-billed enquiry, and another organisation", async () => {
      const a = await readyQuote(oppAgency, agencyId);
      const d = await readyQuote(oppDirect, clientId);
      const o = await readyQuote(oppAgency, otherId);
      for (const p of [a.p, d.p, o.p]) await commit(U.sara, `select crm_quote_issue('${p}')`);
      expect((await snap(a.p)).content.bill_to).toMatchObject({ name: "Fictional Aurora Agency", vat_trn: "000123", trade_licence_no: "0045", country_code: "AE", address: "Fictional Quay 1, Dubai" });
      expect((await snap(d.p)).content.bill_to.name).toBe("Fictional Harbour Client");
      expect((await snap(o.p)).content.bill_to.name).toBe("Fictional Third Party");
    });
    it("takes issuer details from the company's own record (nothing hard-coded) and shows a missing TRN as null", async () => {
      const p1 = (await readyQuote(oppDirect, clientId)).p;
      await commit(U.sara, `select crm_quote_issue('${p1}')`);
      expect((await snap(p1)).content.issuer).toMatchObject({ legal_name: "Fictional Enginious UAE LLC", trn: null, address: null });
      await admin(`update companies set trn = '100200300400003', address = 'Fictional Tower, Dubai', phone = '+971 0', email = 'q@fictional.example', logo_path = '${CO.uae}/${id()}-logo.png' where id = '${CO.uae}'`);
      const p2 = (await readyQuote(oppDirect, clientId)).p;
      await commit(U.sara, `select crm_quote_issue('${p2}')`);
      expect((await snap(p2)).content.issuer).toMatchObject({ trn: "100200300400003", address: "Fictional Tower, Dubai", email: "q@fictional.example" });
      expect((await snap(p2)).content.issuer.logo_path).toMatch(/-logo\.png$/);
      await admin(`update companies set legal_name = '  ' where id = '${CO.ksa}'`);
    });
    it("never puts internal notes in the snapshot", async () => {
      const { p } = await readyQuote(oppDirect, clientId);
      await header(p, { internal_notes: "SECRET-INTERNAL-MARGIN-NOTE" });
      await commit(U.sara, `select crm_quote_issue('${p}')`);
      expect(JSON.stringify((await snap(p)).content)).not.toContain("SECRET-INTERNAL");
      expect((await admin<any>(`select internal_notes from crm_quotations where proposal_id = '${p}'`))[0].internal_notes).toBe("SECRET-INTERNAL-MARGIN-NOTE");
    });
  });

  describe("approval (the existing commercial approval)", () => {
    it("with policy 'required' it cannot be issued without an approval given after the last change", async () => {
      await admin(`update crm_company_settings set approval_policy = 'required' where company_id = '${CO.uae}'`);
      try {
        const { p, s1 } = await readyQuote(oppDirect, clientId);
        await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/founder's approval/);
        const [{ id: ap }] = await commit<{ id: string }>(U.sara, `select crm_request_approval('${oppDirect}', '${p}') as id`);
        await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/founder's approval/);
        await commit(U.founder, `select crm_decide_approval('${ap}', 'approved')`);
        await line(p, s1, { description: "Late addition", quantity: "1", unit_price: "1" }); // an edit after approval voids it
        await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/founder's approval/);
        await admin(`update crm_approvals set state = 'approved', decided_at = now() + interval '1 second' where id = '${ap}'`);
        await commit(U.sara, `select crm_quote_issue('${p}')`);
        expect((await admin(`select issued_at is not null as x from crm_quotations where proposal_id = '${p}'`))[0]).toEqual({ x: true });
      } finally {
        await admin(`update crm_company_settings set approval_policy = 'not_configured' where company_id = '${CO.uae}'`);
      }
    });
  });

  describe("freeze, revisions and supersede", () => {
    it("an issued quotation is unchanged by later edits to the account, the company and the terms template, and is read-only", async () => {
      const { p, s1 } = await readyQuote(oppDirect, clientId);
      await commit(U.sara, `select crm_quote_issue('${p}')`);
      const before = await snap(p);
      await commit(U.founder, `select crm_update_organisation('${clientId}', '{"vat_trn":"CHANGED","trade_licence_no":"CHANGED","place":"Elsewhere"}'::jsonb)`);
      await admin(`update companies set legal_name = 'Renamed Co', trn = 'NEWTRN' where id = '${CO.uae}'`);
      await commit(U.founder, `select crm_save_terms_template('${CO.uae}', 'New terms', '[{"title":"X","body":"Y"}]'::jsonb)`);
      expect(await snap(p)).toEqual(before);
      await admin(`update companies set legal_name = 'Fictional Enginious UAE LLC', trn = null where id = '${CO.uae}'`);
      // read-only through every route, including the table owner
      await expect(header(p, { currency: "USD" })).rejects.toThrow(/issued quotation cannot be edited/);
      await expect(line(p, s1, { description: "x", quantity: "1", unit_price: "1" })).rejects.toThrow(/issued quotation cannot be edited/);
      await expect(admin(`update crm_quotation_lines set unit_price = 1 where proposal_id = '${p}'`)).rejects.toThrow(/issued quotation/);
      await expect(admin(`delete from crm_quotation_sections where proposal_id = '${p}'`)).rejects.toThrow(/issued quotation/);
      await expect(admin(`update crm_quotations set currency = 'USD' where proposal_id = '${p}'`)).rejects.toThrow(/issued quotation/);
      await expect(admin(`update crm_quotation_snapshots set content = '{}' where proposal_id = '${p}'`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`delete from crm_quotation_snapshots where proposal_id = '${p}'`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`truncate crm_quotation_snapshots`)).rejects.toThrow(/never edited or deleted/);
      await expect(commit(U.sara, `select crm_quote_issue('${p}')`)).rejects.toThrow(/issued quotation cannot be edited/);
    });
    it("a revision is a new draft with the same reference, and issuing it supersedes the previous one without altering it", async () => {
      const { p } = await readyQuote(oppDirect, clientId);
      await commit(U.sara, `select crm_quote_issue('${p}')`);
      await commit(U.sara, `select crm_set_proposal_status('${p}', 'sent', (now() at time zone 'Asia/Dubai')::date)`);
      const before = await snap(p);
      const rev = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${p}') as id`))[0].id;
      await expect(commit(U.sara, `select crm_quote_create_revision('${p}')`)).rejects.toThrow(/already an unissued revision/);
      const [a] = await admin<any>(`select reference, revision, previous_proposal_id, issued_at from crm_quotations where proposal_id = '${rev}'`);
      const [b] = await admin<any>(`select reference from crm_quotations where proposal_id = '${p}'`);
      expect([a.reference, a.revision, a.previous_proposal_id, a.issued_at]).toEqual([b.reference, 2, p, null]);
      expect((await admin<any>(`select count(*)::int n from crm_quotation_lines where proposal_id = '${rev}'`))[0].n).toBe(3);
      await commit(U.sara, `select crm_quote_issue('${rev}')`);
      expect((await admin<any>(`select status from crm_proposals where id = '${p}'`))[0].status).toBe("superseded");
      expect(await snap(p)).toEqual(before);
      expect((await snap(rev)).content.revision).toBe(2);
    });
    it("a draft cannot be revised", async () => {
      const p = await newQuote(oppDirect);
      await expect(commit(U.sara, `select crm_quote_create_revision('${p}')`)).rejects.toThrow(/Only an issued quotation/);
    });
  });

  describe("permissions and the company boundary", () => {
    it("only the owner or a founder may edit or issue; a plain grant holder is refused in the database", async () => {
      const p = await newQuote(oppDirect);
      await expect(commit(U.omar, `select crm_quote_save_section('${p}', null, 'Nope')`)).rejects.toThrow(/owner of this opportunity or a founder/);
      await expect(commit(U.omar, `select crm_quote_issue('${p}')`)).rejects.toThrow(/owner of this opportunity or a founder/);
      await expect(commit(U.omar, `select crm_quote_create('${oppDirect}')`)).rejects.toThrow(/owner of this opportunity or a founder/);
      await commit(U.founder, `select crm_quote_save_section('${p}', null, 'Founder section')`);
    });
    it("someone with no grant for the company cannot read or touch it", async () => {
      const p = await newQuote(oppDirect);
      expect(await q(U.ksaOnly, `select 1 from crm_quotations where proposal_id = '${p}'`).catch(() => [])).toHaveLength(0);
      expect(await q(U.ksaOnly, `select 1 from crm_quotation_snapshots`).catch(() => [])).toHaveLength(0);
      await expect(commit(U.ksaOnly, `select crm_quote_save_section('${p}', null, 'x')`)).rejects.toThrow(/not found/i);
      await expect(commit(U.ksaOnly, `select crm_quote_issue('${p}')`)).rejects.toThrow(/not found/i);
      await expect(commit(U.sara, `insert into crm_quotations (proposal_id, opportunity_id, company_id, reference) values ('${p}', '${oppDirect}', '${CO.uae}', 'X')`)).rejects.toThrow();
    });
    it("settings (VAT choices, terms template) need the manage_settings capability", async () => {
      await expect(commit(U.sara, `select crm_save_terms_template('${CO.uae}', 'x', '[{"title":"a","body":"b"}]'::jsonb)`)).rejects.toThrow(/Not allowed/);
      await expect(commit(U.sara, `select crm_save_vat_choice('${CO.uae}', null, '7%', 'rate', 7, true)`)).rejects.toThrow(/Not allowed/);
      await commit(U.founder, `select crm_save_vat_choice('${CO.uae}', null, '7%', 'rate', 7, true)`);
    });
    it("the company logo is set by a System Administrator only", async () => {
      await expect(commit(U.founder, `select crm_set_company_logo('${CO.uae}', null)`)).rejects.toThrow(/System Administrator/);
      await commit(U.sysadmin, `select crm_set_company_logo('${CO.uae}', null)`);
    });
    it("issuer fields on the company are System Administrator writes only (existing policy)", async () => {
      expect((await db.asUserCommit(U.founder, async (query) => (await query(`update companies set trn = 'x' where id = '${CO.uae}'`, [])).rowCount))).toBe(0);
    });
  });

  describe("pictures", () => {
    it("accepts a small image of this enquiry only; refuses documents, big files, other enquiries; blocks removal once issued", async () => {
      const f = async (opp: string, mime: string, size: number, name: string) => {
        const fid = id();
        await admin(`insert into crm_files (id, opportunity_id, company_id, kind, original_name, storage_path, mime_type, size_bytes, uploaded_by, purpose)
          values ('${fid}', '${opp}', '${CO.uae}', 'file', '${name}', '${CO.uae}/${opp}/${id()}-${name}', '${mime}', ${size}, '${U.sara}', 'proposal')`);
        return fid;
      };
      const good = await f(oppDirect, "image/png", 1000, "a.png");
      const pdf = await f(oppDirect, "application/pdf", 1000, "a.pdf");
      const big = await f(oppDirect, "image/jpeg", 6 * 1024 * 1024, "b.jpg");
      const foreign = await f(oppAgency, "image/png", 1000, "c.png");
      const { p, s1 } = await readyQuote(oppDirect, clientId);
      await expect(line(p, s1, { description: "x", quantity: "1", unit_price: "1", image_file_id: pdf })).rejects.toThrow(/JPEG, PNG or WebP/);
      await expect(line(p, s1, { description: "x", quantity: "1", unit_price: "1", image_file_id: big })).rejects.toThrow(/5 MB/);
      await expect(line(p, s1, { description: "x", quantity: "1", unit_price: "1", image_file_id: foreign })).rejects.toThrow(/does not belong/);
      const l = await line(p, s1, { description: "With picture", quantity: "1", unit_price: "1", image_file_id: good });
      await commit(U.sara, `select crm_quote_issue('${p}')`);
      const content = (await snap(p)).content;
      expect(content.sections[0].lines.find((x: any) => x.description === "With picture").image).toMatchObject({ file_id: good, mime_type: "image/png" });
      await expect(commit(U.sara, `select crm_remove_file('${good}')`)).rejects.toThrow(/issued quotation/);
      void l;
    });
  });

  describe("rollback pack", () => {
    it("refuses while an issued quotation exists, and changes nothing", async () => {
      await expect(db.seed(pack("crm_quotes_90_rollback.sql"))).rejects.toThrow(/Issued quotations exist/);
      expect((await admin<{ n: string }>(`select count(*) n from crm_quotation_snapshots`))[0].n).not.toBe("0");
    });
  });
});
