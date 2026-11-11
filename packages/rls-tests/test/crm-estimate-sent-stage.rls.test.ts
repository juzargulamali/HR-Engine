import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: the Estimate sent stage and "record estimate as sent" (migration 20261228000100_crm_estimate_sent_stage.sql). Fictional data only.
// Proves, against a real Postgres with every earlier migration applied:
//   * an ESTIMATE-FIRST enquiry reaches Estimate sent from Qualified or Proposal preparation only after an estimate of THAT enquiry was explicitly recorded as
//     sent; drafting, finalising and a proposal recorded as sent do not unlock it;
//   * a PROPOSAL-FIRST enquiry can record an estimate later and move across to Estimate sent; both records stay (the sent proposal is not superseded);
//   * refusals write nothing: a draft, a replaced revision, another enquiry's estimate, an ordinary proposal, a wrong date, a second record, someone who is not
//     the owner or a founder, a company without a grant, a closed enquiry;
//   * an enquiry at Quote sent or Negotiation records the estimate and is never moved backwards;
//   * the estimate guard still stands (an estimate row cannot be marked sent, so it cannot unlock Proposal sent or supersede a sent proposal);
//   * the Proposal sent and Quote sent gates, hold and resume, Won, Lost and reopen behave as before, with Estimate sent as one more working stage;
//   * the three replaced functions differ from the applied ones only by the stated lines; the owner pack verifies and rolls back exactly.

const MIGRATION = "20261228000100_crm_estimate_sent_stage.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), faisal: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@estsent-test.ae')`).join(", ");
const today = "(now() at time zone 'Asia/Dubai')::date";

describe("Estimate sent stage", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as T[]);
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  const src = async (fn: string) => (await admin<{ s: string }>(`select prosrc s from pg_proc where oid = '${fn}'::regprocedure`))[0].s;

  let clientId: string; let vat: Record<string, string>;
  let before: Record<string, string> = {};
  let preflight: { n: number; check: string; result: string }[] = [];
  let verifyRows: { n: number; item: string; result: string }[] = [];
  const FNS = { move: "crm_move_stage(uuid, text, integer)", reminders: "crm_generate_reminders(timestamptz)", jarvis: "jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)", index: "crm_stage_index(text)" };

  const newOpp = async (title: string, who = U.sara, company = CO.uae) => (await commit<{ id: string }>(who, `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${clientId}') as id`))[0].id;
  const draftEstimate = async (opp: string, who = U.sara) => {
    const p = (await commit<{ id: string }>(who, `select crm_quote_create('${opp}') as id`))[0].id;
    await commit(who, `select crm_quote_save_header('${p}', ${j({ currency: "EUR", vat_choice_id: vat["5%"], bill_to_org_id: clientId })})`);
    const s = (await commit<{ id: string }>(who, `select crm_quote_save_section('${p}', null, 'Fabrication') as id`))[0].id;
    await commit(who, `select crm_quote_save_line('${p}', null, '${s}', ${j({ description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33" })})`);
    return p;
  };
  const finalise = (p: string, who = U.sara) => commit(who, `select crm_quote_issue('${p}')`);
  const finalEstimate = async (opp: string, who = U.sara) => { const p = await draftEstimate(opp, who); await finalise(p, who); return p; };
  const move = (opp: string, to: string, who = U.sara) => commit(who, `select crm_move_stage('${opp}', '${to}')`);
  const record = (p: string, o: { on?: string; move?: boolean; who?: string; version?: number } = {}) =>
    commit<{ r: { send_id: string; moved: boolean; stage: string; version: number } }>(o.who ?? U.sara, `select crm_record_estimate_sent('${p}', ${o.on ?? today}, ${o.move ? "true" : "false"}, ${o.version ?? "null"}) as r`);
  const opp = async (oid: string) => (await admin<{ stage: string; version: number; stage_before_hold: string | null; stage_before_close: string | null }>(`select stage, version, stage_before_hold, stage_before_close from crm_opportunities where id = '${oid}'`))[0];
  const sends = async (oid: string) => admin<{ proposal_id: string; reference: string; revision: number; sent_on: string; recorded_by: string }>(`select proposal_id, reference, revision, sent_on::text, recorded_by from crm_estimate_sends where opportunity_id = '${oid}' order by recorded_at`) as unknown as Promise<{ proposal_id: string; reference: string; revision: number; sent_on: string; recorded_by: string }[]>;
  const events = async (oid: string) => admin<{ kind: string; from_value: string | null; to_value: string | null; reason: string | null }>(`select kind, from_value, to_value, reason from crm_opportunity_events where opportunity_id = '${oid}' order by created_at, id`) as unknown as Promise<{ kind: string; from_value: string | null; to_value: string | null; reason: string | null }[]>;
  const status = async (p: string) => (await admin<{ status: string }>(`select status from crm_proposals where id = '${p}'`))[0].status;
  const sentProposal = async (oid: string) => {
    const p = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${oid}', 'Fictional proposal deck') as id`))[0].id;
    await commit(U.sara, `select crm_set_proposal_status('${p}', 'sent', ${today})`);
    return p;
  };
  /** Everything a refused call must leave alone. */
  const world = async (oid: string) => (await admin<{ h: string }>(`select md5((select o::text from crm_opportunities o where id = '${oid}') || coalesce((select string_agg(p.id::text || p.status, ',' order by p.id) from crm_proposals p where opportunity_id = '${oid}'), '')
    || (select count(*) from crm_estimate_sends)::text || (select count(*) from crm_opportunity_events where opportunity_id = '${oid}')::text) h`))[0].h;

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.faisal}', '${CO.ksa}', '{}');
    `);
    clientId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    vat = Object.fromEntries((await admin<{ id: string; label: string }>(`select id, label from crm_quote_vat_choices where company_id = '${CO.uae}'`)).map((r) => [r.label, r.id]));
    for (const [k, f] of Object.entries(FNS)) before[k] = await src(f);
    preflight = (await db.seed(pack("crm_estimate_sent_00_preflight_readonly.sql"))).rows as typeof preflight;
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);   // idempotent: a second run changes nothing and does not fail
    verifyRows = (await db.seed(pack("crm_estimate_sent_20_verify_readonly.sql"))).rows as typeof verifyRows;
  }, 180_000);
  afterAll(async () => { await db.teardown(); });

  describe("owner pack and what the migration replaced", () => {
    it("the preflight found every prerequisite; the verifier passes every check with nothing moved or recorded", () => {
      expect(preflight.filter((r) => r.n <= 5).map((r) => r.result)).toEqual(["OK", "OK", "OK", "OK", "OK"]);
      expect(preflight.find((r) => r.n === 6)!.result).toBe("not installed yet");
      expect(verifyRows.filter((r) => r.n <= 10).filter((r) => r.result !== "OK")).toEqual([]);
      expect(verifyRows.filter((r) => r.n <= 10)).toHaveLength(10);
      expect(verifyRows.find((r) => r.n === 11)!.result).toBe("0 / 0");
    });
    it("the three replaced functions are the applied bodies plus only the stated lines", async () => {
      const strip = (s: string, drop: RegExp) => s.split("\n").filter((l) => !drop.test(l)).join("\n");
      // crm_move_stage: one condition reworded, one gate added.
      const moveNow = strip(await src(FNS.move), /Proposal sent and Estimate sent are the SAME step|evidence gate below\)|Estimate sent is its own fact|recorded as sent, does not unlock it|crm_estimate_sends|Record an estimate as sent before moving|^  end if;$/);
      const moveWas = strip(before.move!.replace("elsif v_to_i = v_from_i or v_to_i < v_from_i - 1 then", "elsif p_to = v.stage or v_to_i < v_from_i - 1 then"), /^  end if;$/);
      expect(moveNow).toBe(moveWas);
      // crm_generate_reminders: the written-out list of working stages became the shared function.
      expect((await src(FNS.reminders)).replace(/  where crm_stage_index\(o\.stage\) is not null.*\n/, "  where o.stage in ('new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation')\n")).toBe(before.reminders);
      // jarvis_change_stage: one comment and one refusal added.
      expect(strip(await src(FNS.jarvis), /write scope is unchanged by the Estimate sent stage|to or from Estimate sent/)).toBe(before.jarvis);
      // The positions of the six earlier stages are what they were.
      for (const s of ["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost", "nonsense"]) {
        const r = (await admin<{ now: number | null; was: number | null }>(`select crm_stage_index('${s}') as now, array_position(array['new', 'qualified', 'proposal_prep', 'proposal_sent', 'quote_sent', 'negotiation'], '${s}') as was`))[0];
        expect(r.now, s).toBe(r.was);
      }
    });
    it("the reminder sweep still runs", async () => {
      await db.seed(`select crm_generate_reminders()`);
    });
  });

  describe("estimate first", () => {
    let oid: string; let est: string;
    it("drafting or finalising an estimate records nothing and unlocks nothing", async () => {
      oid = await newOpp("Fictional estimate-first enquiry");
      await move(oid, "qualified");
      await expect(move(oid, "estimate_sent")).rejects.toThrow(/Record an estimate as sent before moving to Estimate sent/);
      est = await draftEstimate(oid);
      const w = await world(oid);
      await expect(record(est)).rejects.toThrow(/Finalise the estimate before recording it as sent/);
      await expect(record(est, { move: true })).rejects.toThrow(/Finalise the estimate/);
      expect(await world(oid)).toBe(w);
      await finalise(est);
      expect(await sends(oid)).toEqual([]);                                                        // finalising is not sending
      await expect(move(oid, "estimate_sent")).rejects.toThrow(/Record an estimate as sent/);
      // A proposal recorded as sent unlocks Proposal sent, never Estimate sent.
      await sentProposal(oid);
      await expect(move(oid, "estimate_sent")).rejects.toThrow(/Record an estimate as sent/);
      expect((await opp(oid)).stage).toBe("qualified");
    });
    it("recording it as sent, with the move, takes the enquiry from Qualified straight to Estimate sent and links the exact revision", async () => {
      const v = (await opp(oid)).version;
      const r = (await record(est, { move: true, version: v }))[0].r;
      expect(r).toMatchObject({ moved: true, stage: "estimate_sent", version: v + 1 });
      expect(await opp(oid)).toMatchObject({ stage: "estimate_sent", version: v + 1 });
      const s = await sends(oid);
      expect(s).toHaveLength(1);
      expect(s[0]).toMatchObject({ proposal_id: est, revision: 1, recorded_by: U.sara });
      expect(s[0]!.reference).toMatch(/^EST-/);
      const ev = await events(oid);
      // Both lines are written in the one transaction (same timestamp), so they are found by what they say, not by position.
      const sentLine = ev.find((e) => e.kind === "proposal" && e.reason === est);
      expect(sentLine?.to_value).toMatch(/^Estimate EST-\S+ rev 1 recorded as sent on \d{4}-\d{2}-\d{2}$/);
      expect(ev.filter((e) => e.kind === "stage_changed").at(-1)).toMatchObject({ from_value: "qualified", to_value: "estimate_sent" });
      expect(await status(est)).toBe("draft");                                                     // the estimate row is never marked sent
    });
    it("from Proposal preparation too; then the Quote sent gate is the existing one", async () => {
      const o2 = await newOpp("Fictional prep enquiry");
      await move(o2, "proposal_prep");
      const e2 = await finalEstimate(o2);
      await record(e2);                                                                           // record only
      expect((await opp(o2)).stage).toBe("proposal_prep");
      await move(o2, "estimate_sent");                                                            // then a plain move
      expect((await opp(o2)).stage).toBe("estimate_sent");
      await expect(move(o2, "quote_sent")).rejects.toThrow(/Zoho Books quote reference/);
      await commit(U.sara, `select crm_upsert_zoho_reference('${o2}', 'QT-2001', ${today})`);
      await move(o2, "quote_sent");
      await move(o2, "negotiation");
      expect((await opp(o2)).stage).toBe("negotiation");
    });
    it("the same revision cannot be recorded twice; a second-company viewer sees no record", async () => {
      await expect(record(est)).rejects.toThrow(/already recorded as sent/);
      expect(await q(U.omar, `select 1 from crm_estimate_sends where opportunity_id = '${oid}'`)).toHaveLength(1);
      expect(await q(U.faisal, `select 1 from crm_estimate_sends`)).toHaveLength(0);
      await expect(q(U.sara, `insert into crm_estimate_sends (proposal_id, opportunity_id, company_id, reference, revision, sent_on, recorded_by) select proposal_id, opportunity_id, company_id, reference, 9, sent_on, recorded_by from crm_estimate_sends limit 1`)).rejects.toThrow(/permission denied/);
      await expect(q(U.sara, `delete from crm_estimate_sends`)).rejects.toThrow(/permission denied/);
    });
    it("one step back is Proposal preparation; hold and resume, Lost and reopen, and Won all work from Estimate sent", async () => {
      await move(oid, "proposal_prep");
      await move(oid, "estimate_sent");
      await commit(U.sara, `select crm_hold_opportunity('${oid}', 'Client postponed event', ${today} + 7)`);
      expect(await opp(oid)).toMatchObject({ stage: "on_hold", stage_before_hold: "estimate_sent" });
      await commit(U.sara, `select crm_resume_opportunity('${oid}', 'Call again', ${soon})`);
      expect((await opp(oid)).stage).toBe("estimate_sent");
      await commit(U.sara, `select crm_mark_lost('${oid}', 'Budget lower than scope')`);
      expect(await opp(oid)).toMatchObject({ stage: "lost", stage_before_close: "estimate_sent" });
      await commit(U.founder, `select crm_reopen_opportunity('${oid}', 'Client came back', 'Call', ${soon})`);
      expect((await opp(oid)).stage).toBe("estimate_sent");
      await db.seed(`update crm_opportunities set value = 1000, currency = 'AED' where id = '${oid}'`);
      await commit(U.sara, `select crm_mark_won('${oid}', 'purchase_order', 'PO-7001', ${today})`);
      expect((await opp(oid)).stage).toBe("won");
      expect(await sends(oid)).toHaveLength(1);                                                    // the record stays through all of it
    });
  });

  describe("proposal first, estimate later", () => {
    it("keeps both records: the sent proposal stays sent, the estimate is recorded, and the enquiry can sit at either milestone", async () => {
      const oid = await newOpp("Fictional proposal-first enquiry");
      await move(oid, "proposal_prep");
      const prop = await sentProposal(oid);
      await move(oid, "proposal_sent");
      const est = await finalEstimate(oid);
      // The guard still stands: the estimate row itself cannot be marked sent, so the sent proposal is not superseded.
      await expect(commit(U.sara, `select crm_set_proposal_status('${est}', 'sent', ${today})`)).rejects.toThrow(/An estimate cannot be marked as sent/);
      await expect(commit(U.founder, `select crm_set_proposal_status('${est}', 'sent', ${today})`)).rejects.toThrow(/An estimate cannot be marked as sent/);
      expect(await status(prop)).toBe("sent");
      await expect(move(oid, "estimate_sent")).rejects.toThrow(/Record an estimate as sent/);
      const r = (await record(est, { move: true }))[0].r;
      expect(r).toMatchObject({ moved: true, stage: "estimate_sent" });
      expect(await status(prop)).toBe("sent");
      expect(await status(est)).toBe("draft");
      expect(await sends(oid)).toHaveLength(1);
      const ev = (await events(oid)).map((e) => `${e.kind}:${e.to_value}`);
      expect(ev.some((e) => /^proposal:.*sent/.test(e) && !/Estimate/.test(e))).toBe(true);         // the proposal's own line
      expect(ev.some((e) => /^proposal:Estimate .* recorded as sent on/.test(e))).toBe(true);       // the estimate's line
      expect(ev).toContain("stage_changed:proposal_sent");
      expect(ev).toContain("stage_changed:estimate_sent");
      // Same level: back across to Proposal sent (its gate is met), and across again.
      await move(oid, "proposal_sent");
      await move(oid, "estimate_sent");
      expect((await opp(oid)).stage).toBe("estimate_sent");
    });
    it("an estimate recorded as sent does NOT unlock Proposal sent", async () => {
      const oid = await newOpp("Fictional estimate-only enquiry");
      await move(oid, "proposal_prep");
      const est = await finalEstimate(oid);
      await record(est, { move: true });
      await expect(move(oid, "proposal_sent")).rejects.toThrow(/Record a proposal as sent before moving to Proposal sent/);
      await move(oid, "proposal_prep");
      await expect(move(oid, "proposal_sent")).rejects.toThrow(/Record a proposal as sent/);
    });
    it("a legacy estimate whose row says sent is left as it is and does not count as recorded", async () => {
      const oid = await newOpp("Fictional legacy enquiry");
      const est = await finalEstimate(oid);
      await db.seed(`alter table crm_proposals disable trigger crm_proposals_estimate_sent_guard; update crm_proposals set status = 'sent', sent_on = ${today} where id = '${est}'; alter table crm_proposals enable trigger crm_proposals_estimate_sent_guard;`);
      await expect(move(oid, "estimate_sent")).rejects.toThrow(/Record an estimate as sent/);
      expect(await status(est)).toBe("sent");
      await record(est, { move: true });                                                           // it CAN be recorded explicitly
      expect(await status(est)).toBe("sent");
      expect((await opp(oid)).stage).toBe("estimate_sent");
    });
  });

  describe("refusals write nothing", () => {
    let a: string; let b: string; let estA: string;
    beforeAll(async () => {
      a = await newOpp("Fictional enquiry A"); b = await newOpp("Fictional enquiry B");
      estA = await finalEstimate(a);
    });
    it("another enquiry's recorded estimate does not unlock this one", async () => {
      await record(estA);
      await expect(move(b, "estimate_sent")).rejects.toThrow(/Record an estimate as sent/);
      expect((await opp(b)).stage).toBe("new");
    });
    it("only the owner or a founder; never without a grant for the company; never something that is not an estimate", async () => {
      const est = await finalEstimate(b);
      const ordinary = (await commit<{ id: string }>(U.sara, `select crm_add_proposal('${b}', 'Fictional deck') as id`))[0].id;
      const w = await world(b);
      await expect(record(est, { who: U.omar })).rejects.toThrow(/Only the owner|owner or a founder/i);
      await expect(record(est, { who: U.faisal })).rejects.toThrow(/Estimate not found/);
      await expect(record(ordinary)).rejects.toThrow(/Estimate not found/);
      await expect(record(id())).rejects.toThrow(/Estimate not found/);
      expect(await world(b)).toBe(w);
      await record(est, { who: U.founder });                                                       // a founder may
      expect((await sends(b))[0]).toMatchObject({ proposal_id: est, recorded_by: U.founder });
    });
    it("the date must be given, not in the future and not before the estimate was finalised; a stale version is refused", async () => {
      const o = await newOpp("Fictional date enquiry");
      const est = await finalEstimate(o);
      const w = await world(o);
      await expect(record(est, { on: "null" })).rejects.toThrow(/Enter the date/);
      await expect(record(est, { on: `${today} + 1` })).rejects.toThrow(/cannot be in the future/);
      await expect(record(est, { on: `${today} - 1` })).rejects.toThrow(/before the estimate was finalised/);
      await expect(record(est, { version: 999 })).rejects.toThrow(/changed by someone else/);
      expect(await world(o)).toBe(w);
    });
    it("a revision replaced by a later one cannot be recorded; the current one can; a closed enquiry cannot", async () => {
      const o = await newOpp("Fictional revision enquiry");
      const r1 = await finalEstimate(o);
      const r2 = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${r1}') as id`))[0].id;
      await finalise(r2);
      expect(await status(r1)).toBe("superseded");
      await expect(record(r1)).rejects.toThrow(/replaced by a later one/);
      await record(r2);
      expect((await sends(o))[0]).toMatchObject({ proposal_id: r2, revision: 2 });
      const closed = await newOpp("Fictional closed enquiry");
      const e = await finalEstimate(closed);
      await commit(U.sara, `select crm_mark_lost('${closed}', 'Event cancelled')`);
      await expect(record(e)).rejects.toThrow(/closed opportunity/);
    });
  });

  describe("never backwards", () => {
    it("at Quote sent or Negotiation the estimate is recorded and the stage stays; asking for the move is refused and records nothing", async () => {
      const oid = await newOpp("Fictional late-estimate enquiry");
      await move(oid, "proposal_prep");
      await commit(U.sara, `select crm_upsert_zoho_reference('${oid}', 'QT-3001', ${today})`);
      await move(oid, "quote_sent");
      const est = await finalEstimate(oid);
      const w = await world(oid);
      await expect(record(est, { move: true })).rejects.toThrow(/already past Estimate sent/);
      expect(await world(oid)).toBe(w);
      const r = (await record(est))[0].r;
      expect(r).toMatchObject({ moved: false, stage: "quote_sent" });
      expect((await opp(oid)).stage).toBe("quote_sent");
      await move(oid, "negotiation");
      const r2 = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${est}') as id`))[0].id;
      await finalise(r2);
      await expect(record(r2, { move: true })).rejects.toThrow(/already past Estimate sent/);
      expect((await record(r2))[0].r).toMatchObject({ moved: false, stage: "negotiation" });
      expect(await sends(oid)).toHaveLength(2);                                                    // both revisions' records are kept
      expect((await opp(oid)).stage).toBe("negotiation");
    });
    it("on hold: recorded without a move; the move is refused", async () => {
      const oid = await newOpp("Fictional held enquiry");
      const est = await finalEstimate(oid);
      await commit(U.sara, `select crm_hold_opportunity('${oid}', 'Internal capacity', ${today} + 7)`);
      await expect(record(est, { move: true })).rejects.toThrow(/Resume the opportunity before moving it/);
      expect(await sends(oid)).toEqual([]);
      await record(est);
      expect((await opp(oid)).stage).toBe("on_hold");
    });
  });

  describe("rollback pack", () => {
    it("stops while an enquiry is at Estimate sent; once none is, it restores the previous functions and checks exactly", async () => {
      await expect(db.seed(pack("crm_estimate_sent_90_rollback.sql"))).rejects.toThrow(/ROLLBACK STOPPED/);
      expect((await admin<{ n: string }>(`select count(*)::text n from crm_estimate_sends`))[0].n).not.toBe("0");
      await db.seed(`alter table crm_opportunities disable trigger user;
        update crm_opportunities set stage = 'proposal_prep' where stage = 'estimate_sent';
        update crm_opportunities set stage_before_hold = 'proposal_prep' where stage_before_hold = 'estimate_sent';
        update crm_opportunities set stage_before_close = 'proposal_prep' where stage_before_close = 'estimate_sent';
        alter table crm_opportunities enable trigger user;`);
      await db.seed(pack("crm_estimate_sent_90_rollback.sql"));
      await db.seed(pack("crm_estimate_sent_90_rollback.sql"));   // safe to run twice
      for (const [k, f] of Object.entries(FNS)) expect(await src(f), k).toBe(before[k]);
      expect((await admin<{ t: string | null; f: string | null }>(`select to_regclass('public.crm_estimate_sends')::text t, to_regprocedure('public.crm_record_estimate_sent(uuid, date, boolean, integer)')::text f`))[0]).toEqual({ t: null, f: null });
      await expect(db.seed(`update crm_opportunities set stage_before_close = 'estimate_sent' where id = (select id from crm_opportunities limit 1)`)).rejects.toThrow(/check constraint/);
    });
  });
});
