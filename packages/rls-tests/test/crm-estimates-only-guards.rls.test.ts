import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Estimates-only database guard (migration 20261221000100_crm_estimates_only_guards.sql). Fictional data only. Proves, against a real Postgres,
// that the DATABASE refuses an estimate being recorded as sent (owner, founder, a direct table update and another definer function), that the
// refusal rolls back everything (the proposal really sent to the client is not superseded, the stage gates stay shut, nothing is booked),
// that ordinary proposals and the Zoho Books path work exactly as before, that finalising and superseding (including a legacy quotation that was
// already sent) still work, that new estimates get EST- from the same counter while revisions keep the reference they copy, and that the rollback
// pack removes the guard and restores the previous crm_quote_create exactly.

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
  "20261220000100_crm_estimates_quotations.sql",
];
const GUARD_MIGRATION = "20261221000100_crm_estimates_only_guards.sql";
const MESSAGE = /An estimate cannot be marked as sent\. Send official quotations from the Zoho Books workflow\./;
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id() };
const U = { founder: id(), sara: id(), omar: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@estguard-test.ae')`).join(", ");
const today = "(now() at time zone 'Asia/Dubai')::date";

describe("Estimates-only database guard", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error("expected a refusal, but the call succeeded"); };

  let clientId: string; let vat: Record<string, string>;
  let legacy: { p: string; reference: string; opp: string };
  let preflight: { section: string; item: string; detail: string }[] = [];
  let before: { item: string; n: string; fingerprint: string }[] = [];
  let verifyRows: { item: string; result: string }[] = [];
  let createFpBefore = "";

  const newOpp = async (title: string) => (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => '${title}', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${clientId}') as id`))[0].id;
  const newQuote = async (opp: string, who = U.sara) => (await commit<{ id: string }>(who, `select crm_quote_create('${opp}') as id`))[0].id;
  const readyQuote = async (opp: string) => {
    const p = await newQuote(opp);
    await commit(U.sara, `select crm_quote_save_header('${p}', ${j({ currency: "EUR", vat_choice_id: vat["5%"], bill_to_org_id: clientId })})`);
    const s = (await commit<{ id: string }>(U.sara, `select crm_quote_save_section('${p}', null, 'Fabrication') as id`))[0].id;
    await commit(U.sara, `select crm_quote_save_line('${p}', null, '${s}', ${j({ description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33" })})`);
    return p;
  };
  const issue = (p: string) => commit(U.sara, `select crm_quote_issue('${p}')`);
  const setStatus = (who: string, p: string, status: string) => commit(who, `select crm_set_proposal_status('${p}', '${status}', ${status === "sent" ? today : "null"})`);
  const status = async (p: string) => (await admin<{ status: string }>(`select status from crm_proposals where id = '${p}'`))[0].status;
  const ref = async (p: string) => (await admin<{ reference: string }>(`select reference from crm_quotations where proposal_id = '${p}'`))[0].reference;
  const fingerprint = async (fn: string) => (await admin<{ f: string }>(`select md5(pg_get_functiondef('${fn}'::regprocedure)) f`))[0].f;
  /** Everything the refused call must not change: the enquiry row, every proposal of it, and the row counts of the tables that would show a booking, reservation, follow-up, Zoho row or approval. */
  const world = async (opp: string) => ({
    enquiry: (await admin<{ h: string }>(`select md5(o::text) h from crm_opportunities o where id = '${opp}'`))[0].h,
    proposals: (await admin<{ s: string | null }>(`select string_agg(id::text || ':' || status || ':' || coalesce(sent_on::text, ''), ',' order by id) s from crm_proposals where opportunity_id = '${opp}'`))[0].s,
    counts: (await admin<{ c: string }>(`select string_agg(c, ',' order by c) c from (select tablename || '=' || (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.' || quote_ident(tablename), false, true, '')))[1]::text as c from pg_tables where schemaname = 'public' and (tablename ~ 'reserv|booking|follow_up|reminder|zoho|handover|closure|movement|approval|event|proposal')) x`))[0].c,
  });
  const legacySent = (p: string) => admin(`alter table crm_proposals disable trigger crm_proposals_estimate_sent_guard; update crm_proposals set status = 'sent', sent_on = ${today} where id = '${p}'; alter table crm_proposals enable trigger crm_proposals_estimate_sent_guard;`);

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
    `);
    for (const f of MIGRATIONS.slice(0, -1)) await db.applyMigration(f);
    await db.applyMigration(MIGRATIONS[MIGRATIONS.length - 1]!);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}');
    `);
    clientId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    vat = Object.fromEntries((await admin<{ id: string; label: string }>(`select id, label from crm_quote_vat_choices where company_id = '${CO.uae}'`)).map((r) => [r.label, r.id]));
    // A REAL pre-existing estimate made by the OLD function (QUO- reference), finalised and recorded as sent the way the old app allowed.
    const opp = await newOpp("Legacy estimate enquiry");
    const p = await readyQuote(opp);
    await issue(p);
    await setStatus(U.sara, p, "sent");
    legacy = { p, reference: await ref(p), opp };
    createFpBefore = await fingerprint("crm_quote_create(uuid)");
    // Owner pack, BEFORE the guard migration.
    preflight = (await db.seed(pack("crm_estguard_00_preflight_readonly.sql"))).rows as typeof preflight;
    before = (await db.seed(pack("crm_estguard_05_preservation_check_readonly.sql"))).rows as typeof before;
    await db.applyMigration(GUARD_MIGRATION);
    verifyRows = (await db.seed(pack("crm_estguard_20_verify_readonly.sql"))).rows as typeof verifyRows;
  });
  afterAll(async () => { await db.teardown(); });

  describe("owner pack", () => {
    it("the preflight said every prerequisite was OK, the old QUO- function was in place and the guard was not yet applied", () => {
      const b = preflight.filter((r) => r.section === "B prerequisites");
      expect(b.length).toBeGreaterThan(10);
      expect(b.filter((r) => !/^OK/.test(r.detail))).toEqual([]);
      expect(b.find((r) => r.item === "applied already?")!.detail).toBe("OK - not applied yet");
      const info = Object.fromEntries(preflight.filter((r) => r.section === "C what exists today").map((r) => [r.item, r.detail]));
      expect(info["estimate rows ALREADY sent (legacy: they stay as they are; the guard does not touch them)"]).toBe("1");
      expect(info["highest existing reference per prefix and company code"]).toMatch(/^QUO-UAE: QUO-UAE-\d{4}-0001$/);
    });
    it("the verify pack says OK on every row right after the migration", () => {
      expect(verifyRows.length).toBeGreaterThanOrEqual(14);
      expect(verifyRows.filter((r) => !/^OK/.test(r.result))).toEqual([]);
    });
    it("the preservation check is identical before and after, except crm_quote_create and the new trigger (as intended)", async () => {
      const after = (await db.seed(pack("crm_estguard_05_preservation_check_readonly.sql"))).rows as typeof before;
      expect(after.map((r) => r.item)).toEqual(before.map((r) => r.item));
      const changed = after.filter((r, i) => r.n !== before[i]!.n || r.fingerprint !== before[i]!.fingerprint).map((r) => r.item);
      expect(changed.sort()).toEqual([
        "estimate guard trigger on crm_proposals (INTENDED TO CHANGE: absent before, present after)",
        "function crm_quote_create(p_opportunity uuid) (INTENDED TO CHANGE)",
      ].sort());
    });
    it("the verify pack would FAIL on the old state (it is a real check, not a rubber stamp)", async () => {
      await admin(`drop trigger crm_proposals_estimate_sent_guard on crm_proposals`);
      try {
        const rows = (await db.seed(pack("crm_estguard_20_verify_readonly.sql"))).rows as { item: string; result: string }[];
        expect(rows.filter((r) => !/^OK/.test(r.result)).length).toBeGreaterThanOrEqual(1);
      } finally { await db.applyMigration(GUARD_MIGRATION); }
      expect((await db.seed(pack("crm_estguard_20_verify_readonly.sql"))).rows.filter((r: { result: string }) => !/^OK/.test(r.result))).toEqual([]);
    });
    it("applying the migration a second time changes nothing and the verify pack stays OK", async () => {
      const a = (await db.seed(pack("crm_estguard_05_preservation_check_readonly.sql"))).rows;
      await db.applyMigration(GUARD_MIGRATION);
      expect((await db.seed(pack("crm_estguard_05_preservation_check_readonly.sql"))).rows).toEqual(a);
      expect((await db.seed(pack("crm_estguard_20_verify_readonly.sql"))).rows.filter((r: { result: string }) => !/^OK/.test(r.result))).toEqual([]);
    });
  });

  describe("the database refuses an estimate as sent, whoever asks", () => {
    it("the enquiry owner and a founder calling crm_set_proposal_status directly are refused with the guard message and its own SQLSTATE", async () => {
      const opp = await newOpp("Direct call enquiry");
      const est = await readyQuote(opp);
      for (const who of [U.sara, U.founder]) {
        const e = await rejection(setStatus(who, est, "sent"));
        expect(e.message).toMatch(MESSAGE);
        expect(e.code).toBe("EST01");
        expect(await status(est)).toBe("draft");
      }
      // finalised (frozen) estimate: same refusal
      await issue(est);
      for (const who of [U.sara, U.founder]) expect((await rejection(setStatus(who, est, "sent"))).message).toMatch(MESSAGE);
      expect(await status(est)).toBe("draft");
    });
    it("a direct table update is refused by the trigger itself (table owner / service level), and by another definer function", async () => {
      const opp = await newOpp("Table update enquiry");
      const est = await readyQuote(opp);
      const e = await rejection(admin(`update crm_proposals set status = 'sent', sent_on = ${today} where id = '${est}'`));
      expect([e.code, e.message]).toEqual(["EST01", expect.stringMatching(MESSAGE)]);
      await admin(`create or replace function test_force_sent(p uuid) returns void language sql security definer set search_path = public as $$ update crm_proposals set status = 'sent', sent_on = (now() at time zone 'Asia/Dubai')::date where id = p $$; grant execute on function test_force_sent(uuid) to authenticated`);
      expect((await rejection(commit(U.sara, `select test_force_sent('${est}')`))).message).toMatch(MESSAGE);
      // As the signed-in owner through the table: row-level security allows no update at all (it never reached the row); still not sent.
      await commit(U.sara, `update crm_proposals set status = 'sent', sent_on = ${today} where id = '${est}'`).catch(() => undefined);
      expect(await status(est)).toBe("draft");
      // inserting a row already 'sent' for an existing estimate id is impossible (primary key), so insert-time cover is only for completeness
      expect((await admin<{ n: string }>(`select count(*) n from crm_proposals where id = '${est}' and status = 'sent'`))[0].n).toBe("0");
    });
    it("a refusal changes NOTHING: the proposal really sent to the client is not superseded, the stage and version are unchanged, no booking, reservation, follow-up, Zoho or approval row appears, and the gates stay shut", async () => {
      const opp = await newOpp("No side effects enquiry");
      const ord = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${opp}', 'Canva proposal v1') as id`))[0].id;
      await setStatus(U.sara, ord, "sent");
      const est = await readyQuote(opp);
      await issue(est);
      const w0 = await world(opp);
      for (const who of [U.sara, U.founder]) {
        await rejection(setStatus(who, est, "sent"));
        expect(await world(opp)).toEqual(w0);
        expect(await status(ord)).toBe("sent");
        expect(await status(est)).toBe("draft");
      }
      // a fresh enquiry with NO sent proposal: the estimate cannot unlock either stage gate
      const opp2 = await newOpp("Gates enquiry");
      const est2 = await readyQuote(opp2);
      await issue(est2);
      await commit(U.sara, `select crm_move_stage('${opp2}', 'proposal_prep')`);
      const w2 = await world(opp2);
      await rejection(setStatus(U.sara, est2, "sent"));
      await rejection(setStatus(U.founder, est2, "sent"));
      expect(await world(opp2)).toEqual(w2);
      await expect(commit(U.sara, `select crm_move_stage('${opp2}', 'proposal_sent')`)).rejects.toThrow(/Record a proposal as sent/);
      await expect(commit(U.sara, `select crm_move_stage('${opp2}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
    });
  });

  describe("ordinary proposals and the Zoho Books path are exactly as before", () => {
    it("an ordinary proposal is recorded as sent by its owner and by a founder, supersedes the earlier sent one, and unlocks Proposal sent as before", async () => {
      const opp = await newOpp("Ordinary enquiry");
      const a = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${opp}', 'v1') as id`))[0].id;
      const b = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${opp}', 'v2') as id`))[0].id;
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_prep')`);
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`)).rejects.toThrow(/Record a proposal as sent/);
      await setStatus(U.sara, a, "sent");
      expect(await status(a)).toBe("sent");
      await setStatus(U.founder, b, "sent");
      expect([await status(a), await status(b)]).toEqual(["superseded", "sent"]);
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`);
      await setStatus(U.sara, b, "accepted");
      expect(await status(b)).toBe("accepted");
    });
    it("Zoho Books: Quote sent still needs the quote reference, and an ordinary proposal can be recorded as sent next to an estimate", async () => {
      const opp = await newOpp("Zoho enquiry");
      const est = await readyQuote(opp);
      await issue(est);
      const ord = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${opp}', 'Proposal sent from Zoho') as id`))[0].id;
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_prep')`);
      await setStatus(U.sara, ord, "sent");
      await commit(U.sara, `select crm_move_stage('${opp}', 'proposal_sent')`);
      await expect(commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`)).rejects.toThrow(/Zoho Books quote reference/);
      await commit(U.sara, `select crm_upsert_zoho_reference('${opp}', 'QT-1001', ${today})`);
      await commit(U.sara, `select crm_move_stage('${opp}', 'quote_sent')`);
      // the estimate is untouched by all of it
      expect(await status(est)).toBe("draft");
      expect(await status(ord)).toBe("sent");
    });
  });

  describe("finalising and superseding still work", () => {
    it("finalising an estimate freezes it only: status, enquiry and the other tables are unchanged", async () => {
      const opp = await newOpp("Finalise enquiry");
      const ord = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${opp}', 'v1') as id`))[0].id;
      await setStatus(U.sara, ord, "sent");
      const est = await readyQuote(opp);
      const w0 = await world(opp);
      await issue(est);
      const w1 = await world(opp);
      expect(w1.enquiry).toBe(w0.enquiry);
      expect(w1.proposals).toBe(w0.proposals);
      expect(await status(est)).toBe("draft");
      expect(await status(ord)).toBe("sent");
      expect((await admin<{ n: string }>(`select count(*) n from crm_quotation_snapshots where proposal_id = '${est}'`))[0].n).toBe("1");
    });
    it("finalising a later revision supersedes the earlier draft revision and a legacy revision that was ALREADY sent; withdrawing and unrelated updates are not blocked", async () => {
      // the real legacy estimate (QUO-, issued and recorded as sent BEFORE the guard)
      expect(await status(legacy.p)).toBe("sent");
      const rev = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${legacy.p}') as id`))[0].id;
      await issue(rev);
      expect(await status(legacy.p)).toBe("superseded");
      expect(await status(rev)).toBe("draft");
      expect(await ref(rev)).toBe(legacy.reference);
      // a legacy row that stays 'sent': an update that leaves the status unchanged, and one that does not touch it, pass
      const opp = await newOpp("Legacy stays enquiry");
      const p = await readyQuote(opp);
      await issue(p);
      await legacySent(p);
      await admin(`update crm_proposals set status = 'sent', sent_on = sent_on where id = '${p}'`);
      await admin(`update crm_proposals set note = 'Edited note' where id = '${p}'`);
      expect(await status(p)).toBe("sent");
      // withdrawing (superseded) is allowed through the function too
      await setStatus(U.sara, p, "superseded");
      expect(await status(p)).toBe("superseded");
      // a draft estimate can be withdrawn
      const d = await readyQuote(await newOpp("Withdraw enquiry"));
      await setStatus(U.sara, d, "superseded");
      expect(await status(d)).toBe("superseded");
    });
    it("'accepted' is not touched by the guard: only a legacy estimate that was already sent can reach it (owner decision recorded in the deployment guide)", async () => {
      const opp = await newOpp("Accepted enquiry");
      const p = await readyQuote(opp);
      await expect(setStatus(U.sara, p, "accepted")).rejects.toThrow(/Only a sent proposal can be recorded as accepted/);
      await issue(p);
      await legacySent(p);
      await setStatus(U.sara, p, "accepted");
      expect(await status(p)).toBe("accepted");
    });
  });

  describe("EST- references", () => {
    it("a brand-new estimate gets EST- from the SAME counter (the sequence continues, nothing repeats); the legacy QUO- reference is untouched", async () => {
      const opp = await newOpp("Reference enquiry");
      const a = await newQuote(opp); const b = await newQuote(opp);
      const [ra, rb] = [await ref(a), await ref(b)];
      expect(ra).toMatch(/^EST-UAE-\d{4}-\d{4}$/);
      expect(rb).toMatch(/^EST-UAE-\d{4}-\d{4}$/);
      const num = (r: string) => Number(r.split("-")[3]);
      expect(num(rb)).toBe(num(ra) + 1);
      // the legacy estimate took sequence 1, so the first EST- number is above it: one counter per company and year, shared by both prefixes
      expect(num(ra)).toBeGreaterThan(Number(legacy.reference.split("-")[3]));
      expect(legacy.reference).toMatch(/^QUO-UAE-\d{4}-0001$/);
      expect(await ref(legacy.p)).toBe(legacy.reference);
      const dup = await admin<{ n: string }>(`select count(*) n from (select reference, revision from crm_quotations group by 1, 2 having count(*) > 1) x`);
      expect(dup[0].n).toBe("0");
      const [{ last, max }] = await admin<{ last: string; max: string }>(`select (select last_value::text from crm_quote_counters where company_id = '${CO.uae}' order by year desc limit 1) as last, (select max(split_part(reference, '-', 4)::int)::text from crm_quotations) as max`);
      expect(last).toBe(max);
    });
    it("a revision of an EST- estimate keeps its EST- reference and a revision of a QUO- estimate keeps its QUO- reference", async () => {
      const opp = await newOpp("Revision reference enquiry");
      const p = await readyQuote(opp);
      const original = await ref(p);
      expect(original).toMatch(/^EST-/);
      await issue(p);
      const rev = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${p}') as id`))[0].id;
      expect(await ref(rev)).toBe(original);
      expect((await admin<{ revision: number }>(`select revision from crm_quotations where proposal_id = '${rev}'`))[0].revision).toBe(2);
      await issue(rev);
      expect((await admin<{ reference: string; revision: number }>(`select reference, revision from crm_quotation_snapshots where proposal_id = '${rev}'`))[0]).toEqual({ reference: original, revision: 2 });
      // the QUO- legacy estimate: its revisions (made above) kept QUO-
      const rows = await admin<{ reference: string; revision: number }>(`select reference, revision from crm_quotations where reference = '${legacy.reference}' order by revision`);
      expect(rows.map((r) => r.revision)).toEqual([1, 2]);
    });
  });

  describe("rollback pack", () => {
    it("removes the guard and restores the previous crm_quote_create exactly; EST- estimates keep their references; running it twice is fine; re-applying works", async () => {
      const estBefore = await admin<{ h: string; n: string }>(`select md5(string_agg(proposal_id::text || reference || revision::text, ',' order by proposal_id)) h, count(*)::text n from crm_quotations where reference like 'EST-%'`);
      expect(Number(estBefore[0].n)).toBeGreaterThan(0);
      const allBefore = (await admin<{ h: string }>(`select md5(string_agg(id::text || status, ',' order by id)) h from crm_proposals`))[0].h;
      await db.seed(pack("crm_estguard_90_rollback.sql"));
      await db.seed(pack("crm_estguard_90_rollback.sql"));
      expect((await admin<{ n: string }>(`select count(*) n from pg_trigger where tgname = 'crm_proposals_estimate_sent_guard'`))[0].n).toBe("0");
      expect((await admin<{ n: string }>(`select count(*) n from pg_proc where proname = 'crm_estimate_sent_guard'`))[0].n).toBe("0");
      expect(await fingerprint("crm_quote_create(uuid)")).toBe(createFpBefore);
      expect((await admin<{ h: string }>(`select md5(string_agg(proposal_id::text || reference || revision::text, ',' order by proposal_id)) h from crm_quotations where reference like 'EST-%'`))[0].h).toBe(estBefore[0].h);
      expect((await admin<{ h: string }>(`select md5(string_agg(id::text || status, ',' order by id)) h from crm_proposals`))[0].h).toBe(allBefore);
      // grants are those of the original function
      expect((await admin<{ ok: boolean }>(`select has_function_privilege('authenticated', 'crm_quote_create(uuid)', 'execute') and not has_function_privilege('anon', 'crm_quote_create(uuid)', 'execute') ok`))[0].ok).toBe(true);
      // new estimates get QUO- again, drawn from the same counter
      const opp = await newOpp("After rollback enquiry");
      expect(await ref(await newQuote(opp))).toMatch(/^QUO-UAE-\d{4}-\d{4}$/);
      // without the guard the database itself no longer refuses; the app-level refusal (setProposalStatus, covered by its unit test) keys on this same extension row
      const est = await newQuote(opp);
      expect((await admin<{ n: string }>(`select count(*) n from crm_quotations where proposal_id = '${est}'`))[0].n).toBe("1");
      // re-apply: the guard is back and the pack verifies
      await db.applyMigration(GUARD_MIGRATION);
      expect((await db.seed(pack("crm_estguard_20_verify_readonly.sql"))).rows.filter((r: { result: string }) => !/^OK/.test(r.result))).toEqual([]);
      expect((await rejection(setStatus(U.sara, est, "sent"))).message).toMatch(MESSAGE);
      expect(await ref(await newQuote(opp))).toMatch(/^EST-/);
    });
  });
});
