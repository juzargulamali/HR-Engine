import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM write rules (migration 20261222000100_crm_sales_write_rules.sql). Fictional data only. Proves against a real Postgres:
//   1. Zoho Books references: a field that is not sent is kept, an intentional clear is applied, two people saving different fields at once both keep their change,
//      a stale edit of the same field is refused, the old signature can no longer wipe a field, a Lost enquiry is read-only, Won stays editable, a refused role stays refused,
//      and the Quote sent gate (a non-blank quote reference) is unchanged;
//   1b. owner decision B: an existing quote reference cannot be CLEARED at Quote sent, Negotiation or Won (nor On hold from them), by the owner or a founder, through the new
//      function, the old signature or a direct UPDATE of the table (trigger backstop); a correction to another value, unrelated edits (also on records with a MISSING
//      reference, which are not backfilled), a first value, the invoice and payment fields on Won, clearing at earlier stages, Lost read-only and the Quote sent gate hold;
//   2. proposals: superseded only from draft or sent (accepted and already superseded refused, also under a concurrent "accepted"), normal replacement, estimate
//      finalisation (including a legacy revision already sent) and the estimate-sent guard (EST01) unchanged;
//   3. Won: a future evidence date (Dubai day) is refused with NO side effect; today and past dates work; a refused role stays refused;
//   and the owner pack (preflight, preservation, verify, rollback) behaves as documented.

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
  "20261220000100_crm_estimates_quotations.sql",
  "20261221000100_crm_estimates_only_guards.sql",
];
const MIGRATION = "20261222000100_crm_sales_write_rules.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), ksaStaff: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@salesfix-test.ae')`).join(", ");
const today = "(now() at time zone 'Asia/Dubai')::date";
const FIELDS = ["quote_ref", "quote_sent_on", "invoice_ref", "invoice_issued_on", "payment_received_on", "paid_amount"] as const;

describe("Sales & CRM write rules", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error("expected a refusal, but the call succeeded"); };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fingerprint = async (fn: string) => (await admin<{ f: string }>(`select md5(pg_get_functiondef('${fn}'::regprocedure)) f`))[0].f;
  const FN = {
    save: "crm_save_zoho_reference(uuid, jsonb, jsonb)",
    upsert: "crm_upsert_zoho_reference(uuid, text, date, text, date, date, numeric)",
    status: "crm_set_proposal_status(uuid, text, date)",
    won: "crm_mark_won(uuid, text, text, date, text, integer)",
  };

  let clientId: string; let vat: Record<string, string>;
  let legacy: { p: string; opp: string };
  /** Enquiries that already sat at an advanced stage BEFORE the migration (as hosted data may): without a quote reference, and one with it. */
  let adv: { q: string; n: string; w: string; hold: string; withRef: string; refsMissing: string[] };
  let oldFp: Record<"upsert" | "status" | "won", string>;
  let preflight: { section: string; item: string; detail: string }[] = [];
  let before: { item: string; n: string; fingerprint: string }[] = [];
  let verifyBefore: { item: string; result: string }[] = [];
  let verifyRows: { item: string; result: string }[] = [];

  const newOpp = async (title: string, who = U.sara, company = CO.uae) =>
    (await commit<{ id: string }>(who, `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${clientId}') as id`))[0].id;
  const withValue = (opp: string, who = U.sara) => commit(who, `select crm_update_opportunity('${opp}', null, '{"value": 90000}')`);
  const stage = async (opp: string) => (await admin<{ stage: string }>(`select stage from crm_opportunities where id = '${opp}'`))[0].stage;
  const zoho = async (opp: string) => (await admin<Record<string, string | null>>(`select quote_ref, quote_sent_on::text, invoice_ref, invoice_issued_on::text, payment_received_on::text, paid_amount::text, updated_by::text from crm_zoho_references where opportunity_id = '${opp}'`))[0];
  const save = (who: string, opp: string, fields: Record<string, unknown>, expected?: Record<string, unknown>) =>
    commit(who, `select crm_save_zoho_reference('${opp}', ${j(fields)}${expected ? `, ${j(expected)}` : ""})`);
  const FULL = { quote_ref: "QT-2001", quote_sent_on: "2026-11-02", invoice_ref: "INV-77", invoice_issued_on: "2026-11-10", payment_received_on: "2026-11-20", paid_amount: 1250.5 };
  const addProposal = async (opp: string, note: string, who = U.sara) => (await commit<{ id: string }>(who, `select crm_add_proposal('${opp}', '${note}') as id`))[0].id;
  const setStatus = (who: string, p: string, st: string) => commit(who, `select crm_set_proposal_status('${p}', '${st}', ${st === "sent" ? today : "null"})`);
  const pstatus = async (p: string) => (await admin<{ status: string }>(`select status from crm_proposals where id = '${p}'`))[0].status;
  /** Everything a refused call must not change: the enquiry row, every proposal, Zoho row, closures, follow-ups, handover and events. */
  const world = async (opp: string) => (await admin<Record<string, string | null>>(`select
      (select md5(o::text) from crm_opportunities o where id = '${opp}') as enquiry,
      (select string_agg(id::text || ':' || status || ':' || coalesce(sent_on::text, ''), ',' order by id) from crm_proposals where opportunity_id = '${opp}') as proposals,
      (select md5(z::text) from crm_zoho_references z where opportunity_id = '${opp}') as zoho,
      (select count(*)::text from crm_closures where opportunity_id = '${opp}') as closures,
      (select string_agg(id::text || ':' || status, ',' order by id) from crm_follow_ups where opportunity_id = '${opp}') as follow_ups,
      (select md5(h::text) from crm_handovers h where opportunity_id = '${opp}') as handover,
      (select count(*)::text from crm_opportunity_events where opportunity_id = '${opp}') as events`))[0];
  // estimates (as in the estimates-only guard suite)
  const readyQuote = async (opp: string) => {
    const p = (await commit<{ id: string }>(U.sara, `select crm_quote_create('${opp}') as id`))[0].id;
    await commit(U.sara, `select crm_quote_save_header('${p}', ${j({ currency: "EUR", vat_choice_id: vat["5%"], bill_to_org_id: clientId })})`);
    const s = (await commit<{ id: string }>(U.sara, `select crm_quote_save_section('${p}', null, 'Fabrication') as id`))[0].id;
    await commit(U.sara, `select crm_quote_save_line('${p}', null, '${s}', ${j({ description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33" })})`);
    return p;
  };
  const issue = (p: string) => commit(U.sara, `select crm_quote_issue('${p}')`);
  const legacySent = (p: string) => admin(`alter table crm_proposals disable trigger crm_proposals_estimate_sent_guard; update crm_proposals set status = 'sent', sent_on = ${today} where id = '${p}'; alter table crm_proposals enable trigger crm_proposals_estimate_sent_guard;`);

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA LLC', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
    `);
    for (const f of MIGRATIONS) await db.applyMigration(f);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'),
        ('${U.founder}', '${CO.ksa}', '{founder}'), ('${U.ksaStaff}', '${CO.ksa}', '{}');
    `);
    clientId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    vat = Object.fromEntries((await admin<{ id: string; label: string }>(`select id, label from crm_quote_vat_choices where company_id = '${CO.uae}'`)).map((r) => [r.label, r.id]));
    // A real pre-existing estimate, finalised and recorded as sent the way the old app allowed.
    const opp = await newOpp("Legacy estimate enquiry");
    const p = await readyQuote(opp);
    await issue(p);
    await legacySent(p);
    legacy = { p, opp };
    const mk = async (title: string) => { const o = await newOpp(title); await withValue(o); return o; };
    adv = { q: await mk("Pre-existing Quote sent without reference"), n: await mk("Pre-existing Negotiation without reference"), w: await mk("Pre-existing Won without reference"),
            hold: await mk("Pre-existing hold from Quote sent without reference"), withRef: await mk("Pre-existing Quote sent with reference"), refsMissing: [] };
    await admin(`update crm_opportunities set stage = 'quote_sent' where id = '${adv.q}'; update crm_opportunities set stage = 'negotiation' where id = '${adv.n}';
      update crm_opportunities set stage = 'on_hold', stage_before_hold = 'quote_sent', hold_reason = 'Client postponed', hold_review_date = current_date + 10 where id = '${adv.hold}';
      update crm_opportunities set stage = 'quote_sent' where id = '${adv.withRef}'`);
    await commit(U.sara, `select crm_upsert_zoho_reference('${adv.withRef}', 'QT-LEGACY-1')`);
    await commit(U.sara, `select crm_mark_won('${adv.w}', 'purchase_order', 'PO-LEGACY', ${today})`);
    adv.refsMissing = (await admin<{ reference: string }>(`select reference from crm_opportunities where id in ('${adv.q}', '${adv.n}', '${adv.w}', '${adv.hold}') order by reference`)).map((r) => r.reference);
    oldFp = { upsert: await fingerprint(FN.upsert), status: await fingerprint(FN.status), won: await fingerprint(FN.won) };
    // Owner pack, BEFORE the migration.
    preflight = (await db.seed(pack("crm_salesfix_00_preflight_readonly.sql"))).rows as typeof preflight;
    before = (await db.seed(pack("crm_salesfix_05_preservation_check_readonly.sql"))).rows as typeof before;
    verifyBefore = (await db.seed(pack("crm_salesfix_20_verify_readonly.sql"))).rows as typeof verifyBefore;
    await db.applyMigration(MIGRATION);
    verifyRows = (await db.seed(pack("crm_salesfix_20_verify_readonly.sql"))).rows as typeof verifyRows;
  });
  afterAll(async () => { await db.teardown(); });

  describe("owner pack", () => {
    it("the preflight said every prerequisite was OK and the change was not applied yet", () => {
      const b = preflight.filter((r) => r.section === "B prerequisites");
      expect(b.length).toBeGreaterThan(15);
      expect(b.filter((r) => !/^OK/.test(r.detail))).toEqual([]);
      expect(b.find((r) => r.item === "applied already?")!.detail).toBe("OK - not applied yet");
      const info = Object.fromEntries(preflight.filter((r) => r.section === "C what exists today").map((r) => [r.item, r.detail]));
      expect(Object.keys(info).length).toBe(8);
      const missing = Object.entries(info).filter(([k]) => /WITHOUT a quote reference, by stage/.test(k));
      expect(missing).toHaveLength(1);
      expect(missing[0]![0]).toMatch(/NOT backfilled and NOT blocked/);
      // the rehearsal's pre-existing advanced-stage records without a quote reference are REPORTED (information rows, not failures), by stage and by reference code
      expect(missing[0]![1]).toBe("negotiation: 1, on_hold (from quote_sent): 1, quote_sent: 1, won: 1");
      expect(info["the enquiry references of those records (reference codes only; first 50)"]).toBe(adv.refsMissing.join(", "));
      expect(Object.entries(info).find(([k]) => /WITH a quote reference/.test(k))![1]).toBe("1");
    });
    it("the verify pack FAILS before the migration (it is a real check) and says OK on every row after it", () => {
      expect(verifyBefore.filter((r) => !/^OK/.test(r.result)).length).toBeGreaterThanOrEqual(5);
      expect(verifyRows.length).toBe(18);
      expect(verifyRows.filter((r) => !/^OK/.test(r.result))).toEqual([]);
    });
    it("the preservation check is identical before and after, except the three replaced functions and the new objects (as intended)", async () => {
      const after = (await db.seed(pack("crm_salesfix_05_preservation_check_readonly.sql"))).rows as typeof before;
      const key = (r: { item: string }) => r.item;
      // the new function row is the only row that exists only in the AFTER result? No: it is present in both with a count, so the lists have the same items
      expect(after.map(key)).toEqual(before.map(key));
      const changed = after.filter((r, i) => r.n !== before[i]!.n || r.fingerprint !== before[i]!.fingerprint).map((r) => r.item);
      expect(changed.sort()).toEqual([
        "function crm_mark_won(p_id uuid, p_evidence_type text, p_evidence_reference text, p_evidence_date date, p_note text, p_expected_version integer) (INTENDED TO CHANGE)",
        "function crm_set_proposal_status(p_proposal_id uuid, p_status text, p_sent_on date) (INTENDED TO CHANGE)",
        "function crm_upsert_zoho_reference(p_opportunity_id uuid, p_quote_ref text, p_quote_sent_on date, p_invoice_ref text, p_invoice_issued_on date, p_payment_received_on date, p_paid_amount numeric) (INTENDED TO CHANGE)",
        "new function crm_save_zoho_reference (INTENDED TO CHANGE: absent before, present after)",
        "new function crm_zoho_quote_ref_guard (INTENDED TO CHANGE: absent before, present after)",
        "new function crm_zoho_quote_ref_protected (INTENDED TO CHANGE: absent before, present after)",
        "new trigger crm_zoho_quote_ref_guard on crm_zoho_references (INTENDED TO CHANGE: absent before, present after)",
      ].sort());
    });
    it("applying the migration a second time changes nothing and the verify pack stays OK", async () => {
      const a = (await db.seed(pack("crm_salesfix_05_preservation_check_readonly.sql"))).rows;
      await db.applyMigration(MIGRATION);
      expect((await db.seed(pack("crm_salesfix_05_preservation_check_readonly.sql"))).rows).toEqual(a);
      expect((await db.seed(pack("crm_salesfix_20_verify_readonly.sql"))).rows.filter((r: { result: string }) => !/^OK/.test(r.result))).toEqual([]);
    });
    it("grants are exactly those of the functions they replace: signed-in users execute, anon and public do not", async () => {
      for (const fn of Object.values(FN)) {
        const [r] = await admin<{ a: boolean; n: boolean; p: boolean }>(`select has_function_privilege('authenticated', '${fn}', 'execute') a, has_function_privilege('anon', '${fn}', 'execute') n,
          exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = '${fn}'::regprocedure and x.grantee = 0) p`);
        expect(r).toEqual({ a: true, n: false, p: false });
      }
    });
  });

  describe("1. Zoho Books references: merge, clear, concurrency, stale edit", () => {
    it("saving one field keeps every other field, and a field that is not sent is never cleared", async () => {
      const opp = await newOpp("Zoho merge enquiry");
      await save(U.sara, opp, FULL);
      const full = await zoho(opp);
      expect(full).toMatchObject({ quote_ref: "QT-2001", quote_sent_on: "2026-11-02", invoice_ref: "INV-77", invoice_issued_on: "2026-11-10", payment_received_on: "2026-11-20", paid_amount: "1250.50" });
      await save(U.sara, opp, { invoice_ref: "INV-78" });
      expect(await zoho(opp)).toMatchObject({ ...full, invoice_ref: "INV-78" });
      for (const f of FIELDS) {
        const one = await newOpp(`Zoho one-field ${f}`);
        await save(U.sara, one, FULL);
        const was = await zoho(one);
        await save(U.founder, one, { [f]: f === "paid_amount" ? 5 : f.endsWith("_on") ? "2026-12-01" : "NEW-1" });
        const now = await zoho(one);
        for (const other of FIELDS) if (other !== f) expect(now[other], `${f} changed ${other}`).toBe(was[other]);
        expect(now[f]).not.toBe(was[f]);
      }
    });
    it("an intentional clear (JSON null or an empty/blank value) clears only that field; an absent key does not", async () => {
      const opp = await newOpp("Zoho clear enquiry");
      await save(U.sara, opp, FULL);
      await save(U.sara, opp, { invoice_ref: null });
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-2001", invoice_ref: null, invoice_issued_on: "2026-11-10", paid_amount: "1250.50" });
      await save(U.sara, opp, { payment_received_on: "", paid_amount: null, quote_sent_on: "  " });
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-2001", quote_sent_on: null, payment_received_on: null, paid_amount: null, invoice_issued_on: "2026-11-10" });
      await save(U.sara, opp, { quote_ref: "   " });
      expect((await zoho(opp)).quote_ref).toBeNull();
      // a first save with only one field creates the row with the others empty
      const fresh = await newOpp("Zoho first save enquiry");
      await save(U.sara, fresh, { invoice_ref: "INV-1" });
      expect(await zoho(fresh)).toMatchObject({ quote_ref: null, invoice_ref: "INV-1", paid_amount: null });
    });
    it("two people saving DIFFERENT fields at the same moment both keep their change (the second waits for the first, then merges)", async () => {
      const opp = await newOpp("Zoho two editors enquiry");
      await save(U.sara, opp, { quote_ref: "QT-3000", paid_amount: 10 });
      let second: Promise<unknown> | undefined; let secondDone = false;
      // The first transaction has saved but not committed: the second must WAIT for it (row lock), not run ahead of it.
      await db.asUserCommit(U.sara, async (query) => {
        await query(`select crm_save_zoho_reference('${opp}', ${j({ invoice_ref: "INV-FIRST" })}, ${j({ invoice_ref: null })})`);
        second = save(U.founder, opp, { payment_received_on: "2026-12-05", paid_amount: 99 }, { payment_received_on: null, paid_amount: 10 }).then(() => { secondDone = true; });
        await sleep(400);
        expect(secondDone).toBe(false);
      });
      await second;
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-3000", invoice_ref: "INV-FIRST", payment_received_on: "2026-12-05", paid_amount: "99.00" });
      // and in the other order of arrival, with real parallelism
      const opp2 = await newOpp("Zoho parallel editors enquiry");
      await Promise.all([save(U.sara, opp2, { quote_ref: "QT-4000" }), save(U.founder, opp2, { invoice_ref: "INV-4000" }), save(U.sara, opp2, { paid_amount: 4 })]);
      expect(await zoho(opp2)).toMatchObject({ quote_ref: "QT-4000", invoice_ref: "INV-4000", paid_amount: "4.00" });
    });
    it("a stale edit of the SAME field is refused at once (23514, never the retried 40001) and changes nothing; an edit of another field with its own seen value is accepted", async () => {
      const opp = await newOpp("Zoho stale enquiry");
      await save(U.sara, opp, { quote_ref: "QT-5000", invoice_ref: "INV-5000" });
      await save(U.founder, opp, { quote_ref: "QT-5000-B" });                                   // someone else changed the quote reference
      const w0 = await world(opp);
      const e = await rejection(save(U.sara, opp, { quote_ref: "QT-MINE" }, { quote_ref: "QT-5000" })); // I still saw the old value
      expect(e.code, e.message).toBe("23514");
      expect(e.message).toMatch(/changed the quote reference since you opened this form/);
      expect(await world(opp)).toEqual(w0);
      // my edit of a different field (seen value unchanged) merges
      await save(U.sara, opp, { invoice_ref: "INV-5000-B" }, { invoice_ref: "INV-5000" });
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-5000-B", invoice_ref: "INV-5000-B" });
      // a stale CLEAR is refused too; a clear of the value I saw works
      await rejection(save(U.sara, opp, { quote_ref: null }, { quote_ref: "QT-5000" }));
      await save(U.sara, opp, { quote_ref: null }, { quote_ref: "QT-5000-B" });
      expect((await zoho(opp)).quote_ref).toBeNull();
      // numbers compare by value (12.5 equals 12.50) and dates by day
      await save(U.sara, opp, { paid_amount: 12.5, payment_received_on: "2026-12-01" });
      await save(U.sara, opp, { paid_amount: 13 }, { paid_amount: "12.5" });
      await save(U.sara, opp, { payment_received_on: "2026-12-02" }, { payment_received_on: "2026-12-01" });
    });
    it("an empty change does nothing (no row is created) but the permission checks still apply", async () => {
      const opp = await newOpp("Zoho empty enquiry");
      await save(U.sara, opp, {});
      expect((await admin<{ n: string }>(`select count(*) n from crm_zoho_references where opportunity_id = '${opp}'`))[0].n).toBe("0");
      await expect(save(U.omar, opp, {})).rejects.toThrow(/Only the owner of this opportunity or a founder/);
    });
    it("bad input is refused: unknown field, a non-object, a negative amount, a malformed date", async () => {
      const opp = await newOpp("Zoho input enquiry");
      await save(U.sara, opp, { quote_ref: "QT-6000" });
      const w0 = await world(opp);
      await expect(save(U.sara, opp, { stage: "won" })).rejects.toThrow(/Unknown Zoho Books field: stage/);
      await expect(commit(U.sara, `select crm_save_zoho_reference('${opp}', '[1]'::jsonb)`)).rejects.toThrow(/object of the fields/);
      await expect(commit(U.sara, `select crm_save_zoho_reference('${opp}', null)`)).rejects.toThrow(/object of the fields/);
      await expect(save(U.sara, opp, { paid_amount: -1 })).rejects.toThrow(/cannot be negative/);
      await expect(save(U.sara, opp, { invoice_issued_on: "31/12/2026" })).rejects.toThrow();
      expect(await world(opp)).toEqual(w0);
    });
    it("who may save: the owner and a founder; another person of the company, a person of another company and a stranger are refused, and stay refused", async () => {
      const opp = await newOpp("Zoho roles enquiry");
      await save(U.sara, opp, { quote_ref: "QT-7000" });
      const w0 = await world(opp);
      await expect(save(U.omar, opp, { quote_ref: "HIJACK" })).rejects.toThrow(/Only the owner of this opportunity or a founder/);
      await expect(save(U.ksaStaff, opp, { quote_ref: "HIJACK" })).rejects.toThrow(/Opportunity not found/);
      await expect(save(U.outsider, opp, { quote_ref: "HIJACK" })).rejects.toThrow(/Opportunity not found/);
      await expect(commit(U.omar, `select crm_upsert_zoho_reference('${opp}', 'HIJACK')`)).rejects.toThrow(/Only the owner of this opportunity or a founder/);
      await expect(commit(U.ksaStaff, `select crm_upsert_zoho_reference('${opp}', 'HIJACK')`)).rejects.toThrow(/Opportunity not found/);
      expect(await world(opp)).toEqual(w0);
      await save(U.founder, opp, { quote_ref: "QT-7000-F" });
      expect((await zoho(opp)).quote_ref).toBe("QT-7000-F");
      // anon cannot call it at all
      await expect(db.asUser(null, async (query) => query(`select crm_save_zoho_reference('${opp}', '{"quote_ref":"x"}'::jsonb)`))).rejects.toThrow(/permission denied/);
    });
    it("stages: open and on-hold enquiries and a WON one (invoice and payment follow a win) can be saved; a LOST one is read-only until reopened", async () => {
      const opp = await newOpp("Zoho stages enquiry");
      await save(U.sara, opp, { quote_ref: "QT-8000" });
      await commit(U.sara, `select crm_hold_opportunity('${opp}', 'Client postponed', current_date + 14)`);
      await save(U.sara, opp, { invoice_ref: "INV-ON-HOLD" });
      await commit(U.sara, `select crm_resume_opportunity('${opp}', 'Check in', ${soon})`);
      await withValue(opp);
      await commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', 'PO-8000', ${today})`);
      await save(U.sara, opp, { invoice_ref: "INV-WON", payment_received_on: "2026-12-10", paid_amount: 500 });
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-8000", invoice_ref: "INV-WON", payment_received_on: "2026-12-10" });
      const lost = await newOpp("Zoho lost enquiry");
      await save(U.sara, lost, { quote_ref: "QT-9000" });
      await commit(U.sara, `select crm_mark_lost('${lost}', 'Went with another supplier')`);
      const w0 = await world(lost);
      for (const who of [U.sara, U.founder]) {
        await expect(save(who, lost, { quote_ref: "CHANGED" })).rejects.toThrow(/lost opportunity's Zoho Books references are read-only/);
        await expect(commit(who, `select crm_upsert_zoho_reference('${lost}', 'CHANGED')`)).rejects.toThrow(/read-only/);
      }
      expect(await world(lost)).toEqual(w0);
    });
    it("the OLD signature is kept: an empty argument leaves a field as it is (it can no longer wipe a field), a given one changes only that field, and the permissions are the same", async () => {
      const opp = await newOpp("Zoho old signature enquiry");
      await save(U.sara, opp, FULL);
      const full = await zoho(opp);
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}')`);                      // all defaults: nothing is touched
      expect(await zoho(opp)).toMatchObject({ ...full });
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', p_invoice_ref => 'INV-OLD')`);
      expect(await zoho(opp)).toMatchObject({ ...full, invoice_ref: "INV-OLD" });
      await commit(U.founder, `select crm_upsert_zoho_reference('${opp}', 'QT-OLD', '2026-12-31', 'INV-OLD', '2026-12-30', '2026-12-29', 1)`);
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-OLD", quote_sent_on: "2026-12-31", paid_amount: "1.00" });
      await expect(commit(U.omar, `select crm_upsert_zoho_reference('${opp}', 'X')`)).rejects.toThrow(/Only the owner/);
    });
    it("the Quote sent gate is unchanged: it still needs a non-blank Zoho quote reference, and a normal proposal with that reference can be recorded as sent and unlock the stages", async () => {
      const opp = await newOpp("Zoho gate enquiry");
      const ord = await addProposal(opp, "Proposal sent from Zoho");
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_prep')`);
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`)).rejects.toThrow(/Record a proposal as sent/);
      await setStatus(U.sara, ord, "sent");
      expect(await pstatus(ord)).toBe("sent");
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`);
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
      await save(U.sara, opp, { invoice_ref: "INV-ONLY" });                                      // an invoice reference alone does not unlock it
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
      await save(U.sara, opp, { quote_ref: "   " });                                           // blank does not unlock it either
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
      await save(U.sara, opp, { quote_ref: "QT-1001", quote_sent_on: new Date().toISOString().slice(0, 10) });
      await commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`);
      expect(await stage(opp)).toBe("quote_sent");
      expect((await zoho(opp)).invoice_ref).toBe("INV-ONLY");
    });
  });

  describe("1b. Owner decision B: an existing quote reference cannot be cleared once the enquiry has reached Quote sent", () => {
    const PROTECTED = ["quote_sent", "negotiation", "won"] as const;
    const CLEAR_REFUSAL = /cannot be cleared once the enquiry has reached Quote sent/;
    /** A real enquiry taken through the real gates to the stage, with a quote reference and an invoice reference recorded. */
    const reach = async (to: (typeof PROTECTED)[number], ref: string | null = "QT-B-1") => {
      const opp = await newOpp(`Decision B ${to} ${randomUUID().slice(0, 6)}`);
      await withValue(opp);
      if (to === "won") {
        if (ref) await save(U.sara, opp, { quote_ref: ref, invoice_ref: "INV-B-1" });
        await commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', 'PO-B-1', ${today})`);
        return opp;
      }
      if (ref) {
        const prop = await addProposal(opp, "Proposal for decision B");
        await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_prep')`);
        await setStatus(U.sara, prop, "sent");
        await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`);
        await save(U.sara, opp, { quote_ref: ref, invoice_ref: "INV-B-1" });
        await commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`);
        if (to === "negotiation") await commit(U.sara, `select crm_move_stage('${opp}', 'negotiation')`);
      } else {
        // An existing record from before the gate: it is at the stage with NO quote reference at all.
        await admin(`update crm_opportunities set stage = '${to}' where id = '${opp}'`);
      }
      expect(await stage(opp)).toBe(to);
      return opp;
    };
    const attempts: [string, (who: string, opp: string) => Promise<unknown>][] = [
      ["new function, JSON null", (who, opp) => save(who, opp, { quote_ref: null })],
      ["new function, empty string", (who, opp) => save(who, opp, { quote_ref: "" })],
      ["new function, blank string", (who, opp) => save(who, opp, { quote_ref: "   " })],
      ["new function, with the seen value (the app's form)", (who, opp) => save(who, opp, { quote_ref: null }, { quote_ref: "QT-B-1" })],
      ["new function, clearing together with another change", (who, opp) => save(who, opp, { quote_ref: null, invoice_ref: "INV-CHANGED" })],
      ["OLD signature with an empty string (the compatibility path)", (who, opp) => commit(who, `select crm_upsert_zoho_reference('${opp}', '')`)],
      ["OLD signature with an empty string and another field", (who, opp) => commit(who, `select crm_upsert_zoho_reference('${opp}', '  ', null, 'INV-CHANGED')`)],
    ];

    for (const st of PROTECTED) {
      it(`${st}: clearing an existing quote reference is refused (23514, clear message) for the owner and a founder, through every route, and NOTHING changes`, async () => {
        const opp = await reach(st);
        const w0 = await world(opp);
        for (const who of [U.sara, U.founder]) {
          for (const [name, run] of attempts) {
            const e = await rejection(run(who, opp));
            expect(e.code, `${name}: ${e.message}`).toBe("23514");
            expect(e.message, name).toMatch(CLEAR_REFUSAL);
            expect(e.code).not.toBe("40001");
          }
        }
        expect(await world(opp)).toEqual(w0);
        expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-B-1", invoice_ref: "INV-B-1" });
      });
      it(`${st}: correcting to ANOTHER non-blank reference works, as does an unrelated edit, an omitted quote reference and re-sending the same reference`, async () => {
        const opp = await reach(st);
        await save(U.sara, opp, { quote_ref: "QT-B-2" });
        expect((await zoho(opp)).quote_ref).toBe("QT-B-2");
        await save(U.founder, opp, { quote_ref: "  QT-B-3  " }, { quote_ref: "QT-B-2" });
        expect((await zoho(opp)).quote_ref).toBe("QT-B-3");
        await save(U.sara, opp, { quote_ref: "QT-B-3", quote_sent_on: "2026-11-05" });          // the same value is not a clear
        await save(U.sara, opp, { invoice_ref: "INV-B-2" });                                    // quote_ref omitted
        await save(U.sara, opp, { invoice_issued_on: "2026-11-10", payment_received_on: "2026-11-20", paid_amount: 100 });
        await commit(U.founder, `select crm_upsert_zoho_reference('${opp}', null, null, 'INV-B-3')`);   // old signature leaving the quote reference alone
        await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', 'QT-B-4')`);                    // old signature correcting it
        expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-B-4", quote_sent_on: "2026-11-05", invoice_ref: "INV-B-3", invoice_issued_on: "2026-11-10", payment_received_on: "2026-11-20", paid_amount: "100.00" });
        expect(await stage(opp)).toBe(st);
      });
      it(`${st}: an existing record with a MISSING quote reference is not backfilled and does not block edits (other fields, a no-op blank, a first value)`, async () => {
        const opp = await reach(st, null);
        expect((await admin<{ n: string }>(`select count(*) n from crm_zoho_references where opportunity_id = '${opp}'`))[0].n).toBe("0");   // nothing was backfilled
        await save(U.sara, opp, { invoice_ref: "INV-LEGACY" });
        expect(await zoho(opp)).toMatchObject({ quote_ref: null, invoice_ref: "INV-LEGACY" });
        await save(U.sara, opp, { quote_ref: null, paid_amount: 5 });                           // clearing what is already empty is not a clear
        await save(U.founder, opp, { quote_ref: "", invoice_issued_on: "2026-11-12" });
        await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', '', null, 'INV-LEGACY-2')`);
        expect(await zoho(opp)).toMatchObject({ quote_ref: null, invoice_ref: "INV-LEGACY-2", paid_amount: "5.00" });
        await save(U.sara, opp, { quote_ref: "QT-FIRST" });                                      // setting a first value works
        expect((await zoho(opp)).quote_ref).toBe("QT-FIRST");
        const e = await rejection(save(U.sara, opp, { quote_ref: null }));                       // and from then on it is protected
        expect(e.code).toBe("23514");
        expect(await stage(opp)).toBe(st);
      });
    }

    it("records that sat at an advanced stage WITHOUT a quote reference before the migration are untouched by it (no row created), and unrelated edits and a first value work on them", async () => {
      const zohoRows = await admin<{ n: string }>(`select count(*)::text n from crm_zoho_references where opportunity_id in ('${adv.q}', '${adv.n}', '${adv.w}', '${adv.hold}')`);
      expect(zohoRows[0].n).toBe("0");                                                          // nothing was backfilled by the migration (it changes no row)
      expect(await stage(adv.q)).toBe("quote_sent"); expect(await stage(adv.n)).toBe("negotiation"); expect(await stage(adv.w)).toBe("won"); expect(await stage(adv.hold)).toBe("on_hold");
      for (const o of [adv.q, adv.n, adv.w, adv.hold]) await save(U.sara, o, { invoice_ref: "INV-PRE-EXISTING" });
      await save(U.sara, adv.q, { quote_ref: "QT-FIRST-VALUE" });
      expect((await zoho(adv.q)).quote_ref).toBe("QT-FIRST-VALUE");
      // the one that had a reference before is protected from now on, and a correction works
      await expect(save(U.sara, adv.withRef, { quote_ref: null })).rejects.toThrow(CLEAR_REFUSAL);
      await save(U.sara, adv.withRef, { quote_ref: "QT-LEGACY-1-CORRECTED" });
      expect((await zoho(adv.withRef)).quote_ref).toBe("QT-LEGACY-1-CORRECTED");
    });

    it("won: invoice and payment updates stay available, the enquiry stays Won, and clearing the invoice or payment fields is still allowed (only the quote reference is protected)", async () => {
      const opp = await reach("won");
      await save(U.sara, opp, { invoice_ref: "INV-W-2", invoice_issued_on: "2026-12-01", payment_received_on: "2026-12-20", paid_amount: 900 });
      await save(U.sara, opp, { invoice_ref: null, invoice_issued_on: null, payment_received_on: null, paid_amount: null, quote_sent_on: null });
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-B-1", invoice_ref: null, invoice_issued_on: null, payment_received_on: null, paid_amount: null, quote_sent_on: null });
      expect(await stage(opp)).toBe("won");
    });

    it("on hold: a hold put on from Quote sent / Negotiation keeps the protection (no clear while held), a hold from an earlier stage does not, and Resume returns with the reference intact", async () => {
      const q = await reach("quote_sent");
      await commit(U.sara, `select crm_hold_opportunity('${q}', 'Client postponed', current_date + 14)`);
      expect(await stage(q)).toBe("on_hold");
      const e = await rejection(save(U.sara, q, { quote_ref: null }));
      expect(e.code).toBe("23514"); expect(e.message).toMatch(CLEAR_REFUSAL);
      await save(U.sara, q, { quote_ref: "QT-B-HOLD", invoice_ref: "INV-HELD" });
      await commit(U.sara, `select crm_resume_opportunity('${q}', 'Check in', ${soon})`);
      expect(await stage(q)).toBe("quote_sent");
      expect(await zoho(q)).toMatchObject({ quote_ref: "QT-B-HOLD", invoice_ref: "INV-HELD" });
      const early = await newOpp("Decision B hold from an early stage");
      await save(U.sara, early, { quote_ref: "QT-EARLY" });
      await commit(U.sara, `select crm_hold_opportunity('${early}', 'Client postponed', current_date + 14)`);
      await save(U.sara, early, { quote_ref: null });
      expect((await zoho(early)).quote_ref).toBeNull();
    });

    it("earlier stages behave as before: the quote reference can be cleared at New, Qualified, Proposal prep and Proposal sent (the Quote sent gate then needs it again)", async () => {
      const opp = await newOpp("Decision B earlier stages");
      await withValue(opp);
      await save(U.sara, opp, { quote_ref: "QT-E-1" });
      await save(U.sara, opp, { quote_ref: null });
      expect((await zoho(opp)).quote_ref).toBeNull();
      await save(U.sara, opp, { quote_ref: "QT-E-2" });
      for (const stg of ["qualified", "proposal_prep", "proposal_sent"]) {
        await save(U.sara, opp, { quote_ref: "QT-E-3" });
        await admin(`update crm_opportunities set stage = '${stg}' where id = '${opp}'`);
        await save(U.sara, opp, { quote_ref: null });
        expect((await zoho(opp)).quote_ref, stg).toBeNull();
      }
      await save(U.sara, opp, { quote_ref: "QT-E-4" });
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', '')`);                  // the old signature given an empty STRING clears below Quote sent, as it did before
      expect((await zoho(opp)).quote_ref).toBeNull();
    });

    it("the Quote sent gate still behaves both ways: without a quote reference the move is refused; with one it works; stepping back one stage allows a clear and the gate then asks again", async () => {
      const opp = await newOpp("Decision B gate");
      const prop = await addProposal(opp, "Gate proposal");
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_prep')`);
      await setStatus(U.sara, prop, "sent");
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`);
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
      await save(U.sara, opp, { quote_ref: "QT-G-1" });
      await commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`);
      await expect(save(U.sara, opp, { quote_ref: null })).rejects.toThrow(CLEAR_REFUSAL);
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`);                // one step back is an existing rule
      await save(U.sara, opp, { quote_ref: null });                                            // now an earlier stage: allowed as before
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
      await save(U.sara, opp, { quote_ref: "QT-G-2" });
      await commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`);
      expect(await stage(opp)).toBe("quote_sent");
    });

    it("a LOST enquiry stays read-only (any save refused with the read-only message, also one that would clear), whichever stage it was lost from", async () => {
      for (const from of ["quote_sent", "negotiation"] as const) {
        const opp = await reach(from);
        await commit(U.sara, `select crm_mark_lost('${opp}', 'Went with another supplier')`);
        const w0 = await world(opp);
        for (const who of [U.sara, U.founder]) {
          await expect(save(who, opp, { quote_ref: null })).rejects.toThrow(/lost opportunity's Zoho Books references are read-only/);
          await expect(save(who, opp, { invoice_ref: "X" })).rejects.toThrow(/read-only/);
          await expect(commit(who, `select crm_upsert_zoho_reference('${opp}', 'X')`)).rejects.toThrow(/read-only/);
        }
        expect(await world(opp)).toEqual(w0);
      }
    });

    it("who may save is unchanged: another person of the company, a person of another company and a stranger are refused (permission first), and stay refused", async () => {
      const opp = await reach("negotiation");
      const w0 = await world(opp);
      await expect(save(U.omar, opp, { quote_ref: null })).rejects.toThrow(/Only the owner/);
      await expect(save(U.ksaStaff, opp, { quote_ref: null })).rejects.toThrow(/Opportunity not found/);
      await expect(save(U.outsider, opp, { quote_ref: null })).rejects.toThrow();
      await expect(save(U.omar, opp, { quote_ref: "QT-X" })).rejects.toThrow(/Only the owner/);
      expect(await world(opp)).toEqual(w0);
    });

    it("no other path can clear it: a direct UPDATE of the table (owner or admin, trigger backstop) is refused at those stages, allowed for a correction and at earlier stages; signed-in users cannot update the table at all", async () => {
      const opp = await reach("negotiation");
      const w0 = await world(opp);
      for (const sql of [`update crm_zoho_references set quote_ref = null where opportunity_id = '${opp}'`,
                         `update crm_zoho_references set quote_ref = '  ' where opportunity_id = '${opp}'`,
                         `update crm_zoho_references set quote_ref = '', invoice_ref = 'INV-DIRECT' where opportunity_id = '${opp}'`]) {
        const e = await rejection(admin(sql));
        expect(e.code, e.message).toBe("23514");
        expect(e.message).toMatch(CLEAR_REFUSAL);
      }
      expect(await world(opp)).toEqual(w0);
      // a correction and another column are fine for the table owner
      await admin(`update crm_zoho_references set quote_ref = 'QT-DIRECT' where opportunity_id = '${opp}'`);
      await admin(`update crm_zoho_references set invoice_ref = null where opportunity_id = '${opp}'`);
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-DIRECT", invoice_ref: null });
      // signed-in users: no update policy, so a direct UPDATE touches no row (the table grants SELECT only in production; the harness also grants UPDATE)
      const n = await commit<{ n: string }>(U.sara, `with u as (update crm_zoho_references set quote_ref = null where opportunity_id = '${opp}' returning 1) select count(*)::text as n from u`);
      expect(n[0].n).toBe("0");
      expect((await zoho(opp)).quote_ref).toBe("QT-DIRECT");
      // at an earlier stage the table owner can still clear (the trigger only protects the stages above)
      await admin(`update crm_opportunities set stage = 'proposal_prep' where id = '${opp}'`);
      await admin(`update crm_zoho_references set quote_ref = null where opportunity_id = '${opp}'`);
      expect((await zoho(opp)).quote_ref).toBeNull();
    });

    it("signed-in users have no INSERT, UPDATE or DELETE policy on the table: rows are only written by the SECURITY DEFINER functions (so there is no other write route to guard)", async () => {
      const [r] = await admin<{ n: string }>(`select count(*)::text n from pg_policies where tablename = 'crm_zoho_references' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')`);
      expect(r.n).toBe("0");
      // every function in the database that INSERTs, UPDATEs or DELETEs rows of the table: only the new save function (the old signature delegates to it)
      const writers = await admin<{ proname: string }>(`select proname from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?crm_zoho_references' order by 1`);
      expect(writers.map((w) => w.proname)).toEqual(["crm_save_zoho_reference"]);
      const old = await admin<{ s: string }>(`select prosrc s from pg_proc where oid = to_regprocedure('${FN.upsert.replace("public.", "")}')`);
      expect(old[0].s).toMatch(/crm_save_zoho_reference/);
    });
  });

  describe("1c. The OLD app against the MIGRATED database (the old signature is kept as a compatibility function)", () => {
    it("an old form sends the whole form: blank fields arrive as NULL = leave as is, so it cannot clear anything; nonblank fields overwrite what is stored, including another person's concurrent edit (documented residual risk)", async () => {
      const opp = await newOpp("Old app new database");
      await save(U.sara, opp, { quote_ref: "QT-O-1", invoice_ref: "INV-O-1", paid_amount: 10 });
      // Sara's OLD screen opened with these values; meanwhile the founder corrects the invoice reference.
      await save(U.founder, opp, { invoice_ref: "INV-O-FOUNDER" });
      // Sara saves her old form untouched except the quote sent date: the old app sends EVERY nonblank field with the values it loaded.
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', 'QT-O-1', '2026-11-03', 'INV-O-1', null, null, 10)`);
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-O-1", quote_sent_on: "2026-11-03", invoice_ref: "INV-O-1" });   // the founder's change is overwritten
      // Blank (the old app sends NULL for an emptied field) leaves the field as it is: it cannot clear it.
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', null, null, null, null, null, null)`);
      expect(await zoho(opp)).toMatchObject({ quote_ref: "QT-O-1", invoice_ref: "INV-O-1", paid_amount: "10.00" });
    });
  });

  describe("2. Proposals: superseded only from draft or sent", () => {
    it("draft and sent proposals can be marked superseded by the owner and by a founder", async () => {
      const opp = await newOpp("Supersede ok enquiry");
      const a = await addProposal(opp, "v1"); const b = await addProposal(opp, "v2"); const c = await addProposal(opp, "v3");
      await setStatus(U.sara, a, "superseded");
      expect(await pstatus(a)).toBe("superseded");
      await setStatus(U.sara, b, "sent");
      await setStatus(U.founder, b, "superseded");
      expect(await pstatus(b)).toBe("superseded");
      await setStatus(U.founder, c, "superseded");
      expect(await pstatus(c)).toBe("superseded");
    });
    it("an ACCEPTED proposal and an already SUPERSEDED one are refused (23514) and nothing changes", async () => {
      const opp = await newOpp("Supersede refused enquiry");
      const a = await addProposal(opp, "v1"); const b = await addProposal(opp, "v2");
      await setStatus(U.sara, a, "sent");
      await setStatus(U.sara, a, "accepted");
      await setStatus(U.sara, b, "superseded");
      const w0 = await world(opp);
      for (const [who, p] of [[U.sara, a], [U.founder, a], [U.sara, b], [U.founder, b]] as const) {
        const e = await rejection(setStatus(who, p, "superseded"));
        expect(e.code).toBe("23514");
        expect(e.message).toMatch(/Only a draft or sent proposal can be marked superseded/);
        expect(await world(opp)).toEqual(w0);
      }
      expect([await pstatus(a), await pstatus(b)]).toEqual(["accepted", "superseded"]);
    });
    it("a refused role stays refused: another person of the company, a person of another company and a stranger cannot supersede", async () => {
      const opp = await newOpp("Supersede roles enquiry");
      const a = await addProposal(opp, "v1");
      const w0 = await world(opp);
      await expect(setStatus(U.omar, a, "superseded")).rejects.toThrow(/Only the owner of this opportunity or a founder/);
      await expect(setStatus(U.ksaStaff, a, "superseded")).rejects.toThrow(/Proposal not found/);
      await expect(setStatus(U.outsider, a, "superseded")).rejects.toThrow(/Proposal not found/);
      expect(await world(opp)).toEqual(w0);
    });
    it("a concurrent 'accepted' is not overwritten: the superseder waits for the lock, re-reads and is refused", async () => {
      const opp = await newOpp("Supersede race enquiry");
      const a = await addProposal(opp, "v1");
      await setStatus(U.sara, a, "sent");
      let second: Promise<unknown> | undefined;
      await db.asUserCommit(U.sara, async (query) => {
        await query(`select crm_set_proposal_status('${a}', 'accepted', null)`);
        second = rejection(setStatus(U.founder, a, "superseded"));      // reads 'sent' before the lock, then waits for it
        await sleep(400);
      });
      const e = await second as { message: string };
      expect(e.message).toMatch(/Only a draft or sent proposal can be marked superseded/);
      expect(await pstatus(a)).toBe("accepted");
    });
    it("normal proposal replacement is unchanged: recording a new proposal as sent supersedes the earlier sent one; sent and accepted rules are as before", async () => {
      const opp = await newOpp("Replacement enquiry");
      const a = await addProposal(opp, "v1"); const b = await addProposal(opp, "v2");
      await setStatus(U.sara, a, "sent");
      await setStatus(U.sara, b, "sent");
      expect([await pstatus(a), await pstatus(b)]).toEqual(["superseded", "sent"]);
      await expect(setStatus(U.sara, a, "sent")).rejects.toThrow(/Only a draft proposal can be recorded as sent/);
      await expect(setStatus(U.sara, a, "accepted")).rejects.toThrow(/Only a sent proposal can be recorded as accepted/);
      await setStatus(U.sara, b, "accepted");
      expect(await pstatus(b)).toBe("accepted");
      await expect(commit(U.sara, `select crm_set_proposal_status('${b}', 'archived', null)`)).rejects.toThrow(/Unknown proposal status/);
      await expect(commit(U.sara, `select crm_set_proposal_status('${b}', 'sent', (now() at time zone 'Asia/Dubai')::date + 1)`)).rejects.toThrow(/Only a draft proposal|not in the future/);
      // closed enquiries: accepted still possible on a won enquiry, nothing else
      await withValue(opp);
      await commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', 'PO-REPL', ${today})`);
      await expect(setStatus(U.sara, a, "superseded")).rejects.toThrow(/closed opportunity cannot change proposals/);
    });
    it("estimate finalisation is unchanged: a later revision supersedes the earlier draft revision and a legacy revision that was ALREADY sent", async () => {
      expect(await pstatus(legacy.p)).toBe("sent");
      const rev = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${legacy.p}') as id`))[0].id;
      await issue(rev);
      expect(await pstatus(legacy.p)).toBe("superseded");
      expect(await pstatus(rev)).toBe("draft");
      // a draft estimate revision is superseded by the next finalised revision
      const opp = await newOpp("Estimate drafts enquiry");
      const est = await readyQuote(opp);
      await issue(est);
      const rev2 = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${est}') as id`))[0].id;
      await issue(rev2);
      expect(await pstatus(est)).toBe("superseded");
      // and a draft estimate can still be withdrawn through the function (draft -> superseded), but not twice
      const d = await readyQuote(await newOpp("Withdraw estimate enquiry"));
      await setStatus(U.sara, d, "superseded");
      expect(await pstatus(d)).toBe("superseded");
      await expect(setStatus(U.sara, d, "superseded")).rejects.toThrow(/Only a draft or sent proposal can be marked superseded/);
    });
    it("the estimate-sent guard (EST01) is unchanged: an estimate cannot be recorded as sent, and the refusal rolls back everything", async () => {
      const opp = await newOpp("Estimate guard enquiry");
      const ord = await addProposal(opp, "Proposal really sent");
      await setStatus(U.sara, ord, "sent");
      const est = await readyQuote(opp);
      await issue(est);
      const w0 = await world(opp);
      for (const who of [U.sara, U.founder]) {
        const e = await rejection(setStatus(who, est, "sent"));
        expect(e.code).toBe("EST01");
        expect(e.message).toMatch(/An estimate cannot be marked as sent/);
        expect(await world(opp)).toEqual(w0);
      }
      expect(await pstatus(ord)).toBe("sent");
    });
  });

  describe("3. Won: the evidence date cannot be in the future (Dubai day, as the form)", () => {
    it("a date after the Dubai day is refused (22023) and NOTHING changes: enquiry, version, closures, follow-ups, handover, events", async () => {
      for (const [type, who] of [["purchase_order", U.sara], ["authorised_email", U.founder]] as const) {
        const opp = await newOpp(`Won future ${type}`);
        await withValue(opp);
        const w0 = await world(opp);
        expect(w0.closures).toBe("0");
        expect(w0.handover).toBeNull();
        for (const offset of ["+ 1", "+ 30", "+ 400"]) {
          const e = await rejection(commit(who, `select crm_mark_won('${opp}', '${type}', 'PO-FUTURE', ${today} ${offset})`));
          expect(e.code).toBe("22023");
          expect(e.message).toMatch(/cannot be in the future/);
          expect(await world(opp)).toEqual(w0);
        }
        expect(await stage(opp)).toBe("new");
      }
    });
    it("the boundary is the Dubai calendar day, exactly the form's `max`: today in Dubai and any past date are accepted; the day after is refused", async () => {
      const [{ dubai, utc }] = await admin<{ dubai: string; utc: string }>(`select crm_today_dubai()::text dubai, (now() at time zone 'UTC')::date::text utc`);
      expect(dubai >= utc).toBe(true); // Dubai is ahead of UTC, so a UTC-based boundary would refuse some valid Dubai days
      const oneToday = await newOpp("Won today"); await withValue(oneToday);
      await commit(U.sara, `select crm_mark_won('${oneToday}', 'purchase_order', 'PO-TODAY', date '${dubai}')`);
      expect((await admin<{ d: string }>(`select evidence_date::text d from crm_opportunities where id = '${oneToday}'`))[0].d).toBe(dubai);
      const past = await newOpp("Won past"); await withValue(past);
      await commit(U.sara, `select crm_mark_won('${past}', 'authorised_email', 'Mail 2 Nov', date '2026-11-02')`);
      expect((await admin<{ d: string }>(`select evidence_date::text d from crm_opportunities where id = '${past}'`))[0].d).toBe("2026-11-02");
      const old = await newOpp("Won long ago"); await withValue(old);
      await commit(U.founder, `select crm_mark_won('${old}', 'purchase_order', 'PO-OLD', date '2020-01-01')`);
      const tomorrow = await newOpp("Won tomorrow"); await withValue(tomorrow);
      await expect(commit(U.sara, `select crm_mark_won('${tomorrow}', 'purchase_order', 'PO-TOMORROW', date '${dubai}' + 1)`)).rejects.toThrow(/cannot be in the future/);
    });
    it("a valid Won still does everything it did: closure row, handover row, follow-ups cancelled, stage, version; the other rules and a refused role are unchanged", async () => {
      const opp = await newOpp("Won valid enquiry");
      await expect(commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', 'PO-1', ${today})`)).rejects.toThrow(/Set the confirmed value/);
      await withValue(opp);
      await expect(commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', '', ${today})`)).rejects.toThrow(/Won needs evidence/);
      await expect(commit(U.sara, `select crm_mark_won('${opp}', 'whatsapp', 'x', ${today})`)).rejects.toThrow(/Won needs evidence/);
      await expect(commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', 'PO-1', null)`)).rejects.toThrow(/Won needs evidence/);
      await expect(commit(U.omar, `select crm_mark_won('${opp}', 'purchase_order', 'PO-1', ${today})`)).rejects.toThrow(/Only the owner of this opportunity or a founder/);
      await expect(commit(U.ksaStaff, `select crm_mark_won('${opp}', 'purchase_order', 'PO-1', ${today})`)).rejects.toThrow(/Opportunity not found/);
      const v0 = (await admin<{ version: number }>(`select version from crm_opportunities where id = '${opp}'`))[0].version;
      await commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', ' PO-1 ', ${today}, 'Signed by the client')`);
      const w = await admin<Record<string, unknown>>(`select o.stage, o.version, o.evidence_reference, o.evidence_date::text d, o.closed_by,
        (select count(*) from crm_closures c where c.opportunity_id = o.id and c.outcome = 'won') closures,
        (select count(*) from crm_follow_ups f where f.opportunity_id = o.id and f.status = 'open') open_follow_ups,
        (select status from crm_handovers h where h.opportunity_id = o.id) handover from crm_opportunities o where o.id = '${opp}'`);
      expect(w[0]).toMatchObject({ stage: "won", version: v0 + 1, evidence_reference: "PO-1", closures: "1", open_follow_ups: "0", handover: "draft" });
    });
  });

  describe("8. Sales settings hint: references are not generated differently (the hint only names the prefix)", () => {
    it("a new enquiry reference is OPP-<company code>-<year>-<4 digits>, from the same generator as before this change", async () => {
      const opp = await newOpp("Reference prefix enquiry");
      const [{ reference }] = await admin<{ reference: string }>(`select reference from crm_opportunities where id = '${opp}'`);
      expect(reference).toMatch(/^OPP-UAE-\d{4}-\d{4}$/);
    });
  });

  describe("rollback pack", () => {
    it("restores the EXACT previous function bodies, drops the new function, keeps the grants, changes no row, runs twice, and the migration re-applies", async () => {
      const dataBefore = await world(legacy.opp);
      const allRows = async () => (await admin<{ h: string }>(`select md5(string_agg(x, ',' order by x)) h from (
          select 'p:' || id::text || status as x from crm_proposals union all select 'z:' || z::text from crm_zoho_references z
          union all select 'o:' || o::text from crm_opportunities o union all select 'c:' || c::text from crm_closures c) s`))[0].h;
      const rowsBefore = await allRows();
      await db.seed(pack("crm_salesfix_90_rollback.sql"));
      await db.seed(pack("crm_salesfix_90_rollback.sql"));
      expect(await fingerprint(FN.upsert)).toBe(oldFp.upsert);
      expect(await fingerprint(FN.status)).toBe(oldFp.status);
      expect(await fingerprint(FN.won)).toBe(oldFp.won);
      expect((await admin<{ n: string }>(`select count(*) n from pg_proc where proname in ('crm_save_zoho_reference', 'crm_zoho_quote_ref_protected', 'crm_zoho_quote_ref_guard')`))[0].n).toBe("0");
      expect((await admin<{ n: string }>(`select count(*) n from pg_trigger where tgname = 'crm_zoho_quote_ref_guard'`))[0].n).toBe("0");
      expect(await allRows()).toBe(rowsBefore);
      expect(await world(legacy.opp)).toEqual(dataBefore);
      for (const fn of [FN.upsert, FN.status, FN.won]) {
        const [r] = await admin<{ a: boolean; n: boolean; p: boolean }>(`select has_function_privilege('authenticated', '${fn}', 'execute') a, has_function_privilege('anon', '${fn}', 'execute') n,
          exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = '${fn}'::regprocedure and x.grantee = 0) p`);
        expect(r).toEqual({ a: true, n: false, p: false });
      }
      // the OLD behaviour is back: overwrite-all, supersede from accepted, a future Won date (these are the bugs the migration fixes)
      const opp = await newOpp("After rollback enquiry"); await withValue(opp);
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', 'QT-R', null, 'INV-R')`);
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', 'QT-R2')`);
      expect((await zoho(opp)).invoice_ref).toBeNull();
      // decision B is rolled back with it: a quote reference at Negotiation can be cleared again through the old function
      await admin(`update crm_opportunities set stage = 'negotiation' where id = '${opp}'`);
      await admin(`update crm_zoho_references set quote_ref = null where opportunity_id = '${opp}'`);
      expect((await zoho(opp)).quote_ref).toBeNull();
      await admin(`update crm_opportunities set stage = 'new' where id = '${opp}'`);
      const a = await addProposal(opp, "v1"); await setStatus(U.sara, a, "sent"); await setStatus(U.sara, a, "accepted"); await setStatus(U.sara, a, "superseded");
      expect(await pstatus(a)).toBe("superseded");
      await commit(U.sara, `select crm_mark_won('${opp}', 'purchase_order', 'PO-R', ${today} + 5)`);
      expect(await stage(opp)).toBe("won");
      // re-apply: everything verifies again, and the rules are back
      await db.applyMigration(MIGRATION);
      expect((await db.seed(pack("crm_salesfix_20_verify_readonly.sql"))).rows.filter((r: { result: string }) => !/^OK/.test(r.result))).toEqual([]);
      const o2 = await newOpp("Re-applied enquiry"); await withValue(o2);
      await expect(commit(U.sara, `select crm_mark_won('${o2}', 'purchase_order', 'PO-R', ${today} + 5)`)).rejects.toThrow(/cannot be in the future/);
      await save(U.sara, o2, { quote_ref: "QT-A", invoice_ref: "INV-A" });
      await save(U.sara, o2, { quote_ref: "QT-B" });
      expect((await zoho(o2)).invoice_ref).toBe("INV-A");
      // ... and decision B is back after the re-apply
      await admin(`update crm_opportunities set stage = 'negotiation' where id = '${o2}'`);
      await expect(save(U.sara, o2, { quote_ref: null })).rejects.toThrow(/cannot be cleared once the enquiry has reached Quote sent/);
    });
  });
});
