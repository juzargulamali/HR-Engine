import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM, Estimates: the database refuses to finalise, or to send for approval, a draft that still carries INHERITED terms
// (migration 20270112000100_crm_quote_terms_guard.sql). Fictional data only. Against a real Postgres with every earlier migration applied:
//   * BEFORE the migration (the state of every hosted database today) a quotation is issued the way the app issued it before the estimates-only change, a
//     revision of it is drafted (it copies the six standard clauses and their label), and a current-format estimate is finalised;
//   * the migration and its owner pack run (twice);
//   * REFUSAL: the owner and a founder calling the database directly cannot finalise the unconverted revision, nor request approval of it, and nothing is written;
//   * SUCCESS: after the confirmed replacement (the same call the app's step makes) it finalises as an estimate; an ordinary current-format estimate and a
//     revision of one finalise as before;
//   * ISSUED DOCUMENTS ARE UNTOUCHED: the snapshot and hash of the quotation issued before are byte-identical before and after the migration, after the
//     refusals and after its revision is finalised; it is still readable and can still be revised;
//   * the rule is the same as `termsReview` in packages/domain (the vectors below are asserted there too);
//   * the rollback restores the two functions exactly.

const MIGRATION = "20270112000100_crm_quote_terms_guard.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), faisal: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@terms-guard-test.ae')`).join(", ");
const OLD_LABEL = "Standard terms (working draft, pending legal review)";
const SIX = "Site access and readiness, Site services and other trades, Changes, Start of work, Scope exclusions, Confidentiality";
const MARKER = "estimate-format:2";

/** The shared vectors of the rule: [label, clause titles, needs review]. The same list is in packages/domain/test/estimates.test.ts. */
export const TERMS_RULE_VECTORS: [string | null, string[], boolean][] = [
  ["estimate-format:2", [], false],
  ["estimate-format:1", [], false],
  ["estimate-format:2", ["Assumptions", "Next steps"], false],
  ["estimate-format:0002", [], false],
  [OLD_LABEL, ["Changes"], true],
  [OLD_LABEL, [], true],
  [null, [], true],
  ["", [], true],
  ["estimate-format:3", [], true],
  ["estimate-format:", [], true],
  ["estimate-format:2 ", [], true],
  ["Estimate-format:2", [], true],
  ["estimate-format:2", ["Confidentiality"], true],
  ["estimate-format:2", ["Assumptions", "Changes"], true],
  ["estimate-format:2", ["assumptions"], true],
];

describe("Estimate terms guard", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as T[]);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  const src = async (fn: string) => (await admin<{ s: string }>(`select prosrc s from pg_proc where oid = '${fn}'::regprocedure`))[0].s;
  const FNS = { issue: "crm_quote_issue(uuid, jsonb)", request: "crm_quote_request_approval(uuid)", create: "crm_quote_create(uuid)", revise: "crm_quote_create_revision(uuid)", header: "crm_quote_save_header(uuid, jsonb)", decide: "crm_quote_decide_approval(uuid, text, text, text)" };

  let client: string; let vat: string; let opp: string; let oppKsa: string;
  let legacy: string; let legacyRev: string; let estimate: string; let ksaDraft: string;
  const before: Record<string, string> = {};
  type PackRow = { n: number; item: string; result: string };
  let preflight: PackRow[] = []; let verifyRows: PackRow[] = [];
  let legacySnap = ""; let estimateSnap = "";

  const newOpp = async (title: string, who = U.sara, company = CO.uae) => (await commit<{ id: string }>(who, `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${client}') as id`))[0].id;
  /** A complete draft. `estimate` = what the app does right after creating one: the marker, and the copied template cleared. */
  const draft = async (o: string, estimateFormat: boolean, who = U.sara) => {
    const p = (await commit<{ id: string }>(who, `select crm_quote_create('${o}') as id`))[0].id;
    await commit(who, `select crm_quote_save_header('${p}', ${j({ currency: "EUR", vat_choice_id: vat, bill_to_org_id: client, ...(estimateFormat ? { terms_label: MARKER, terms: [] } : {}) })})`);
    const s = (await commit<{ id: string }>(who, `select crm_quote_save_section('${p}', null, 'Fabrication') as id`))[0].id;
    await commit(who, `select crm_quote_save_line('${p}', null, '${s}', ${j({ description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33" })})`);
    return p;
  };
  const issue = (p: string, who = U.sara) => commit(who, `select crm_quote_issue('${p}')`);
  const revise = async (p: string, who = U.sara) => (await commit<{ id: string }>(who, `select crm_quote_create_revision('${p}') as id`))[0].id;
  const terms = async (p: string) => (await admin<{ label: string | null; titles: string; issued: boolean }>(`select terms_label label, coalesce((select string_agg(t->>'title', ', ') from jsonb_array_elements(terms) t), '') titles, issued_at is not null issued from crm_quotations where proposal_id = '${p}'`))[0];
  const snap = async (p: string) => (await admin<{ h: string }>(`select md5(content::text) || ':' || content_hash || ':' || issued_at::text h from crm_quotation_snapshots where proposal_id = '${p}'`))[0].h;
  const world = async (p: string) => (await admin<{ h: string }>(`select md5((select qq::text from crm_quotations qq where proposal_id = '${p}') || (select pp::text from crm_proposals pp where id = '${p}') || (select count(*) from crm_quotation_snapshots)::text || (select count(*) from crm_approvals)::text || (select count(*) from crm_opportunity_events)::text) h`))[0].h;

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.faisal}', '${CO.ksa}', '{founder}');
    `);
    client = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    vat = (await admin<{ id: string }>(`select id from crm_quote_vat_choices where company_id = '${CO.uae}' and label = '5%'`))[0].id;
    opp = await newOpp("Fictional terms guard enquiry");
    // Issued the way the app issued before the estimates-only change: the template terms, no marker. And a revision of it, left unconverted.
    legacy = await draft(opp, false); await issue(legacy);
    legacyRev = await revise(legacy);
    // An ordinary current-format estimate, finalised before the migration.
    const opp2 = await newOpp("Fictional current estimate enquiry");
    estimate = await draft(opp2, true); await issue(estimate);
    // Another company: a first draft that was never marked (its template copy is still there).
    oppKsa = (await commit<{ id: string }>(U.faisal, `select crm_create_opportunity(p_company_id => '${CO.ksa}', p_title => 'Fictional other company enquiry', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${client}') as id`))[0].id;
    ksaDraft = (await commit<{ id: string }>(U.faisal, `select crm_quote_create('${oppKsa}') as id`))[0].id;

    legacySnap = await snap(legacy); estimateSnap = await snap(estimate);
    for (const [k, f] of Object.entries(FNS)) before[k] = await src(f);
    preflight = (await db.seed(pack("crm_quote_terms_guard_00_preflight_readonly.sql"))).rows as PackRow[];
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);   // idempotent
    verifyRows = (await db.seed(pack("crm_quote_terms_guard_20_verify_readonly.sql"))).rows as PackRow[];
  }, 240_000);
  afterAll(async () => { await db.teardown(); });

  describe("owner pack and what the migration replaced", () => {
    it("the preflight reports, per company, the drafts that hold inherited terms, and lists each one; issued quotations are counted for information", () => {
      expect(preflight.find((r) => r.n === 1)!.result).toBe("OK");
      expect(preflight.find((r) => r.n === 2)!.result).toBe("not installed yet");
      expect(preflight.filter((r) => r.n > 10 && r.n < 90).map((r) => [r.item.replace(/^company (.*?):.*$/, "$1"), r.result])).toEqual([["Fictional Enginious KSA", "1 / 0 / 0"], ["Fictional Enginious UAE LLC", "1 / 1 / 0"]]);
      expect(preflight.find((r) => r.n === 90)!.result).toBe("1");
      const rows = preflight.filter((r) => r.n > 100);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.item.includes("UAE LLC"))!.item).toMatch(/revision 2 · enquiry OPP-UAE-/);
      expect(rows.find((r) => r.item.includes("UAE LLC"))!.result).toBe(`draft holds inherited terms: label "${OLD_LABEL}", 6 clause(s)`);
    });
    it("the verifier passes; only the two stated functions changed, each by one refusal; nothing issued and no draft was rewritten", async () => {
      expect(verifyRows.filter((r) => r.n <= 6).map((r) => r.result)).toEqual(["OK", "OK", "OK", "OK", "OK", "OK"]);
      expect(verifyRows.find((r) => r.n === 7)!.result).toBe("2");
      expect(verifyRows.find((r) => r.n === 8)!.result).toBe("1");
      for (const k of ["create", "revise", "header", "decide"]) expect(await src(FNS[k as keyof typeof FNS]), k).toBe(before[k]);
      const strip = (s: string) => s.split("\n").filter((l) => !/Terms inherited from an earlier quotation|An approval is bound to the exact version|crm_quote_terms_need_review|Replace the terms carried over|^  end if;$/.test(l)).join("\n");
      const stripWas = (s: string) => s.split("\n").filter((l) => !/^  end if;$/.test(l)).join("\n");
      expect(strip(await src(FNS.issue))).toBe(stripWas(before.issue!));
      expect(strip(await src(FNS.request))).toBe(stripWas(before.request!));
      expect(await terms(legacyRev)).toEqual({ label: OLD_LABEL, titles: SIX, issued: false });
      expect(await snap(legacy)).toBe(legacySnap);
      expect(await snap(estimate)).toBe(estimateSnap);
    });
    it("the rule equals the app's rule on the shared vectors, and signed-in people cannot call it", async () => {
      for (const [label, titles, needed] of TERMS_RULE_VECTORS) {
        const r = (await admin<{ r: boolean }>(`select crm_quote_terms_need_review(${label === null ? "null" : `'${label}'`}, ${j(titles.map((t) => ({ title: t, body: "x" })))}) r`))[0].r;
        expect(r, `${label} / ${titles.join(",")}`).toBe(needed);
      }
      await expect(q(U.founder, `select crm_quote_terms_need_review('x', '[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    });
  });

  describe("REFUSAL: a draft that still carries inherited terms", () => {
    it("the owner and a founder, calling the database directly, cannot finalise the unconverted revision; nothing is written", async () => {
      const w = await world(legacyRev);
      await expect(issue(legacyRev)).rejects.toThrow(/Replace the terms carried over into this draft with the current estimate format before finalising it \(estimate page, Details step\)\. Nothing was changed/);
      await expect(issue(legacyRev, U.founder)).rejects.toThrow(/Replace the terms carried over into this draft/);
      await expect(commit(U.sara, `select crm_quote_issue('${legacyRev}', '{"logo": null, "lines": {}}'::jsonb)`)).rejects.toThrow(/Replace the terms carried over/);
      expect(await world(legacyRev)).toBe(w);
      expect(await terms(legacyRev)).toEqual({ label: OLD_LABEL, titles: SIX, issued: false });
    });
    it("nor can they request approval of it (an approval is never bound to a version that cannot go out)", async () => {
      const w = await world(legacyRev);
      await expect(commit(U.sara, `select crm_quote_request_approval('${legacyRev}')`)).rejects.toThrow(/Replace the terms carried over into this draft with the current estimate format before requesting approval/);
      await expect(commit(U.founder, `select crm_quote_request_approval('${legacyRev}')`)).rejects.toThrow(/Replace the terms carried over/);
      expect(await world(legacyRev)).toBe(w);
    });
    it("a first draft that was never marked as an estimate (the template copy is still in it) is refused the same way, in another company too", async () => {
      await commit(U.faisal, `select crm_quote_save_header('${ksaDraft}', ${j({ currency: "EUR", vat_choice_id: (await admin<{ id: string }>(`select id from crm_quote_vat_choices where company_id = '${CO.ksa}' and label = '5%'`))[0].id, bill_to_org_id: client })})`);
      const s = (await commit<{ id: string }>(U.faisal, `select crm_quote_save_section('${ksaDraft}', null, 'AV') as id`))[0].id;
      await commit(U.faisal, `select crm_quote_save_line('${ksaDraft}', null, '${s}', ${j({ description: "LED", unit: "pc", quantity: "1", unit_price: "10" })})`);
      await expect(issue(ksaDraft, U.faisal)).rejects.toThrow(/Replace the terms carried over/);
      // Half a replacement is not a replacement: the marker with a clause left, or the clauses emptied under the old label.
      await commit(U.faisal, `select crm_quote_save_header('${ksaDraft}', ${j({ terms_label: MARKER })})`);
      await expect(issue(ksaDraft, U.faisal)).rejects.toThrow(/Replace the terms carried over/);
      await commit(U.faisal, `select crm_quote_save_header('${ksaDraft}', ${j({ terms_label: OLD_LABEL, terms: [] })})`);
      await expect(issue(ksaDraft, U.faisal)).rejects.toThrow(/Replace the terms carried over/);
    });
    it("the earlier refusals still come first for people who may not act at all: a colleague and another company", async () => {
      await expect(issue(legacyRev, U.omar)).rejects.toThrow(/owner of this opportunity or a founder/);
      await expect(issue(legacyRev, U.faisal)).rejects.toThrow();
      await expect(commit(U.omar, `select crm_quote_save_header('${legacyRev}', ${j({ terms_label: MARKER, terms: [] })})`)).rejects.toThrow(/owner of this opportunity or a founder/);
      expect(await terms(legacyRev)).toEqual({ label: OLD_LABEL, titles: SIX, issued: false });
    });
  });

  describe("SUCCESS", () => {
    it("after the confirmed replacement (the call the app's step makes) the revision finalises as an estimate, with the person's notes kept", async () => {
      await commit(U.sara, `select crm_quote_save_header('${legacyRev}', ${j({ terms_label: MARKER, terms: [{ title: "Next steps", body: "Review together." }] })})`);
      await issue(legacyRev);
      expect(await terms(legacyRev)).toEqual({ label: MARKER, titles: "Next steps", issued: true });
      expect((await admin<{ l: string; n: number }>(`select content->'terms'->>'label' l, jsonb_array_length(content->'terms'->'clauses') n from crm_quotation_snapshots where proposal_id = '${legacyRev}'`))[0]).toEqual({ l: MARKER, n: 1 });
    });
    it("an ordinary current-format estimate finalises, and so does a revision of one, with no extra step; approval can be requested for them", async () => {
      const o = await newOpp("Fictional ordinary estimate");
      const e1 = await draft(o, true);
      await commit(U.sara, `select crm_quote_request_approval('${e1}')`).catch((e: Error) => { if (/Replace the terms/.test(e.message)) throw e; });   // the policy may not ask for approval; only the guard must not refuse
      await issue(e1);
      const e2 = await revise(e1);
      expect(await terms(e2)).toEqual({ label: MARKER, titles: "", issued: false });
      await issue(e2);
      expect((await terms(e2)).issued).toBe(true);
      // A revision of the estimate finalised BEFORE the migration, and an estimate under the earlier layout version.
      const e3 = await revise(estimate); await issue(e3);
      const o2 = await newOpp("Fictional format one estimate"); const f1 = await draft(o2, true);
      await commit(U.sara, `select crm_quote_save_header('${f1}', ${j({ terms_label: "estimate-format:1" })})`);
      await issue(f1);
      expect((await terms(f1)).issued).toBe(true);
    });
  });

  describe("ISSUED DOCUMENTS ARE UNTOUCHED", () => {
    it("the quotation issued before the migration has the same snapshot and hash, the same row, is still readable by its company only, and can still be revised", async () => {
      expect(await snap(legacy)).toBe(legacySnap);
      expect(await snap(estimate)).toBe(estimateSnap);
      expect(await terms(legacy)).toEqual({ label: OLD_LABEL, titles: SIX, issued: true });
      const read = await q<{ label: string; n: number }>(U.omar, `select content->'terms'->>'label' as label, jsonb_array_length(content->'terms'->'clauses') as n from crm_quotation_snapshots where proposal_id = '${legacy}'`);
      expect(read).toEqual([{ label: OLD_LABEL, n: 6 }]);
      expect(await q(U.faisal, `select 1 from crm_quotation_snapshots where proposal_id = '${legacy}'`)).toEqual([]);
      // Another revision of the same old quotation chain: it again inherits (from the estimate revision: nothing), and the old snapshot stays.
      const again = await revise(legacyRev);
      expect(await terms(again)).toEqual({ label: MARKER, titles: "Next steps", issued: false });
      expect(await snap(legacy)).toBe(legacySnap);
    });
  });

  describe("rollback pack", () => {
    it("restores the two functions exactly, drops the rule function, and is safe to run twice", async () => {
      await db.seed(pack("crm_quote_terms_guard_90_rollback.sql"));
      await db.seed(pack("crm_quote_terms_guard_90_rollback.sql"));
      for (const k of Object.keys(FNS)) expect(await src(FNS[k as keyof typeof FNS]), k).toBe(before[k]);
      expect((await admin<{ f: string | null }>(`select to_regprocedure('public.crm_quote_terms_need_review(text, jsonb)')::text f`))[0].f).toBeNull();
      expect(await snap(legacy)).toBe(legacySnap);
    });
  });
});
