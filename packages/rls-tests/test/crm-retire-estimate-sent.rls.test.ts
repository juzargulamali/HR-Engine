import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: "Estimate sent" is retired as a pipeline stage; "record as sent" stays (migration 20270111000100_crm_retire_estimate_sent_stage.sql).
// Fictional data only. Against a real Postgres with every earlier migration applied, the enquiries below are put at Estimate sent with the functions the
// DEPLOYED app uses (so they are shaped like hosted rows), then the owner pack and the migration run:
//   * the read-only preflight proposes, per enquiry, exactly what the migration then does, with the evidence, and lists the ambiguous ones;
//   * an enquiry is moved only on its own records: an ordinary proposal recorded as sent -> Proposal sent; otherwise back to the evidence-free stage the
//     history shows it came from; an estimate recorded as sent and a Zoho quote reference move nothing; nothing goes forward past a gate;
//   * ambiguous enquiries keep the stage, still open, and can be moved OUT by the owner or a founder only (not a colleague, not another company);
//   * nobody can be moved INTO it any more: Move stage, record-as-sent with p_move = true (the deployed app's call: still succeeds, records the send with the
//     exact revision, date, person and time, and leaves stage and version alone), reopen;
//   * history is kept: no timeline line is changed or removed; every move adds one system line; closed enquiries are untouched;
//   * a second run changes nothing; the rollback restores the three functions exactly and puts back only the enquiries nobody touched since.

const MIGRATION = "20270111000100_crm_retire_estimate_sent_stage.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), sara: id(), omar: id(), faisal: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@retire-test.ae')`).join(", ");
const today = "(now() at time zone 'Asia/Dubai')::date";

describe("Estimate sent retired as a stage", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as T[]);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  const src = async (fn: string) => (await admin<{ s: string }>(`select prosrc s from pg_proc where oid = '${fn}'::regprocedure`))[0].s;
  const FNS = {
    move: "crm_move_stage(uuid, text, integer)", record: "crm_record_estimate_sent(uuid, date, boolean, integer)", reopen: "crm_reopen_opportunity(uuid, text, text, timestamptz, text, text, integer)",
    index: "crm_stage_index(text)", reminders: "crm_generate_reminders(timestamptz)", jarvis: "jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)",
  };

  let clientUae: string; let clientKsa: string; let vat: Record<string, Record<string, string>> = {};
  const before: Record<string, string> = {};
  type PackRow = { n: number; item: string; result: string; facts?: string | null };
  let preflight: PackRow[] = []; let verifyRows: PackRow[] = [];
  const E: Record<string, string> = {};          // enquiry ids by scenario
  const EST: Record<string, string> = {};        // the finalised estimate of each
  let eventsBefore: Record<string, string> = {};

  const newOpp = async (title: string, who = U.sara, company = CO.uae) => (await commit<{ id: string }>(who, `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'direct_client', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${company === CO.uae ? clientUae : clientKsa}') as id`))[0].id;
  const finalEstimate = async (opp: string, who = U.sara, company = CO.uae) => {
    const p = (await commit<{ id: string }>(who, `select crm_quote_create('${opp}') as id`))[0].id;
    await commit(who, `select crm_quote_save_header('${p}', ${j({ currency: "EUR", vat_choice_id: vat[company]!["5%"], bill_to_org_id: company === CO.uae ? clientUae : clientKsa })})`);
    const s = (await commit<{ id: string }>(who, `select crm_quote_save_section('${p}', null, 'Fabrication') as id`))[0].id;
    await commit(who, `select crm_quote_save_line('${p}', null, '${s}', ${j({ description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33" })})`);
    await commit(who, `select crm_quote_issue('${p}')`);
    return p;
  };
  const move = (opp: string, to: string, who = U.sara) => commit(who, `select crm_move_stage('${opp}', '${to}')`);
  const record = (p: string, o: { move?: boolean; who?: string } = {}) =>
    commit<{ r: { send_id: string; moved: boolean; stage: string; version: number } }>(o.who ?? U.sara, `select crm_record_estimate_sent('${p}', ${today}, ${o.move ? "true" : "false"}, null) as r`);
  const opp = async (oid: string) => (await admin<{ stage: string; version: number; stage_before_hold: string | null; stage_before_close: string | null; stage_changed_at: string }>(`select stage, version, stage_before_hold, stage_before_close, stage_changed_at::text from crm_opportunities where id = '${oid}'`))[0];
  const events = async (oid: string) => admin<{ kind: string; from_value: string | null; to_value: string | null; reason: string | null; actor_id: string | null }>(`select kind, from_value, to_value, reason, actor_id from crm_opportunity_events where opportunity_id = '${oid}' order by created_at, id`) as unknown as Promise<{ kind: string; from_value: string | null; to_value: string | null; reason: string | null; actor_id: string | null }[]>;
  const eventsHash = async (oid: string) => (await admin<{ h: string }>(`select coalesce(md5(string_agg(e::text, '|' order by e.created_at, e.id)), '') h from crm_opportunity_events e where e.opportunity_id = '${oid}'`))[0].h;
  const sentProposal = async (oid: string, who = U.sara) => {
    const p = (await commit<{ id: string }>(who, `select crm_add_proposal('${oid}', 'Fictional proposal deck') as id`))[0].id;
    await commit(who, `select crm_set_proposal_status('${p}', 'sent', ${today})`);
    return p;
  };
  /** Put an enquiry at Estimate sent the way the deployed app does: from `via`, by recording a finalised estimate as sent with the move ticked. */
  const toEstimateSent = async (key: string, title: string, via: "new" | "qualified" | "proposal_prep" | "proposal_sent", who = U.sara, company = CO.uae) => {
    const oid = await newOpp(title, who, company);
    if (via === "proposal_sent") { await sentProposal(oid, who); await move(oid, "proposal_sent", who); } else if (via !== "new") await move(oid, via, who);
    const est = await finalEstimate(oid, who, company);
    const r = (await record(est, { move: true, who }))[0].r;
    expect(r.moved, key).toBe(true);
    E[key] = oid; EST[key] = est;
    return oid;
  };

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
    clientUae = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    clientKsa = (await commit<{ id: string }>(U.faisal, `select crm_create_organisation_profile(p_name => 'Fictional Dune Client', p_roles => '{client}', p_country_code => 'SA') as id`))[0].id;
    for (const c of [CO.uae, CO.ksa]) vat[c] = Object.fromEntries((await admin<{ id: string; label: string }>(`select id, label from crm_quote_vat_choices where company_id = '${c}'`)).map((r) => [r.label, r.id]));

    // ---- Enquiries at Estimate sent, made exactly as the deployed app makes them ----
    await toEstimateSent("proposalFirst", "Fictional A proposal first", "proposal_sent");           // an ordinary proposal is recorded as sent
    await toEstimateSent("fromQualified", "Fictional B from qualified", "qualified");
    await toEstimateSent("fromPrep", "Fictional C from preparation", "proposal_prep");
    // D: came from Proposal sent, but that proposal was withdrawn afterwards: nothing ordinary is recorded as sent now.
    await toEstimateSent("withdrawn", "Fictional D proposal withdrawn", "proposal_sent");
    await db.seed(`update crm_proposals set status = 'superseded' where opportunity_id = '${E.withdrawn}' and status = 'sent'`);
    // E: went on to Quote sent (Zoho reference recorded), then one step back to Estimate sent.
    await toEstimateSent("steppedBack", "Fictional E stepped back from quote", "qualified");
    await commit(U.sara, `select crm_upsert_zoho_reference('${E.steppedBack}', 'QT-9001', ${today})`);
    await move(E.steppedBack!, "quote_sent"); await move(E.steppedBack!, "estimate_sent");
    // F: on hold from Estimate sent (it came from Qualified).
    await toEstimateSent("held", "Fictional F on hold", "qualified");
    await commit(U.sara, `select crm_hold_opportunity('${E.held}', 'Client postponed event', ${today} + 7)`);
    // G: closed (Lost) from Estimate sent.
    await toEstimateSent("closed", "Fictional G closed", "proposal_prep");
    await commit(U.sara, `select crm_mark_lost('${E.closed}', 'Event cancelled')`);
    // H: another company.
    await toEstimateSent("ksa", "Fictional H other company", "new", U.faisal, CO.ksa);
    // I: at the stage with no history line into it (reopened straight into it by a founder, which writes a 'reopened' line, not a stage change).
    E.noHistory = await newOpp("Fictional I no history"); EST.noHistory = await finalEstimate(E.noHistory);
    await record(EST.noHistory);
    await commit(U.sara, `select crm_mark_lost('${E.noHistory}', 'Event cancelled')`);
    await commit(U.founder, `select crm_reopen_opportunity('${E.noHistory}', 'Client came back', 'Call', ${soon}, 'other', 'estimate_sent')`);
    // J: on hold from Estimate sent, and it had stepped back from Quote sent: ambiguous while held.
    await toEstimateSent("heldAmbiguous", "Fictional J on hold ambiguous", "qualified");
    await commit(U.sara, `select crm_upsert_zoho_reference('${E.heldAmbiguous}', 'QT-9002', ${today})`);
    await move(E.heldAmbiguous!, "quote_sent"); await move(E.heldAmbiguous!, "estimate_sent");
    await commit(U.sara, `select crm_hold_opportunity('${E.heldAmbiguous}', 'Internal capacity', ${today} + 7)`);
    // K: a legacy quotation row marked 'sent' (possible before the estimate guard existed) is NOT an ordinary proposal: it does not place the enquiry.
    await toEstimateSent("legacySentQuote", "Fictional K legacy quotation marked sent", "proposal_sent");
    await db.seed(`update crm_proposals set status = 'superseded' where opportunity_id = '${E.legacySentQuote}' and status = 'sent';
      alter table crm_proposals disable trigger user;
      update crm_proposals set status = 'sent', sent_on = ${today} where id = '${EST.legacySentQuote}';
      alter table crm_proposals enable trigger user;`);

    for (const [k, f] of Object.entries(FNS)) before[k] = await src(f);
    for (const [k, oid] of Object.entries(E)) eventsBefore[k] = await eventsHash(oid);
    preflight = (await db.seed(pack("crm_retire_estimate_sent_00_preflight_readonly.sql"))).rows as PackRow[];
    await db.applyMigration(MIGRATION);
    verifyRows = (await db.seed(pack("crm_retire_estimate_sent_20_verify_readonly.sql"))).rows as PackRow[];
  }, 240_000);
  afterAll(async () => { await db.teardown(); });

  const EXPECT: Record<string, { field: "stage" | "stage_before_hold"; to: string | null }> = {
    proposalFirst: { field: "stage", to: "proposal_sent" }, fromQualified: { field: "stage", to: "qualified" }, fromPrep: { field: "stage", to: "proposal_prep" },
    withdrawn: { field: "stage", to: null }, steppedBack: { field: "stage", to: null }, held: { field: "stage_before_hold", to: "qualified" },
    ksa: { field: "stage", to: "new" }, noHistory: { field: "stage", to: null }, heldAmbiguous: { field: "stage_before_hold", to: null }, legacySentQuote: { field: "stage", to: null },
  };

  describe("owner pack: preflight, migration, verify", () => {
    it("the preflight finds the prerequisites and reports, per company, how many hold the stage, how many will move and how many are ambiguous", () => {
      expect(preflight.filter((r) => r.n <= 2).map((r) => r.result)).toEqual(["OK", "OK"]);
      expect(preflight.find((r) => r.n === 3)!.result).toBe("not installed yet");
      const companies = preflight.filter((r) => r.n > 10 && r.n < 100);
      expect(companies.map((r) => [r.item.replace(/^company (.*?):.*$/, "$1"), r.result, r.facts])).toEqual([
        ["Fictional Enginious KSA", "1 / 0 / 0", "will move: 1, ambiguous (not moved): 0"],
        ["Fictional Enginious UAE LLC", "7 / 2 / 1", "will move: 4, ambiguous (not moved): 5"],
      ]);
    });
    it("the preflight proposes for every enquiry exactly what the migration then did, with the evidence used", async () => {
      const rows = preflight.filter((r) => r.n > 100);
      expect(rows).toHaveLength(Object.keys(EXPECT).length);      // the closed one is not listed: closed enquiries are history
      for (const [k, want] of Object.entries(EXPECT)) {
        const title = (await admin<{ title: string }>(`select title from crm_opportunities where id = '${E[k]}'`))[0].title;
        const row = rows.find((r) => r.item.includes(title))!;
        expect(row, k).toBeTruthy();
        if (want.to) expect(row.result, k).toMatch(new RegExp(`^MOVE to ${want.to}: `)); else expect(row.result, k).toMatch(/^AMBIGUOUS - NOT MOVED: /);
        const now = await opp(E[k]!);
        expect(now[want.field], k).toBe(want.to ?? "estimate_sent");
      }
      const text = (k: string) => rows.find((r) => r.item.includes(k))!;
      expect(text("Fictional A proposal first").result).toMatch(/a proposal \(not an estimate\) is recorded as sent/);
      expect(text("Fictional B from qualified").result).toMatch(/entered Estimate sent from qualified/);
      expect(text("Fictional D proposal withdrawn").result).toMatch(/entered from Proposal sent, but no ordinary proposal is recorded as sent now/);
      expect(text("Fictional E stepped back").result).toMatch(/stepped back from Quote sent/);
      expect(text("Fictional E stepped back").facts).toMatch(/estimates recorded as sent \(not counted\): 1; Zoho quote reference \(not counted\): yes/);
      expect(text("Fictional I no history").result).toMatch(/no stage-history line/);
      expect(text("Fictional K legacy").facts).toMatch(/ordinary proposals sent: 0; quotation rows marked sent \(not counted\): 1/);
      expect(text("Fictional F on hold").item).toMatch(/on hold: the stage it returns to/);
    });
    it("an estimate send and a Zoho quote reference moved nothing forward: nobody landed on Quote sent or Negotiation", async () => {
      expect((await admin<{ n: string }>(`select count(*)::text n from crm_stage_retirement_moves where to_value not in ('new', 'qualified', 'proposal_prep', 'proposal_sent')`))[0].n).toBe("0");
      expect((await opp(E.steppedBack!)).stage).toBe("estimate_sent");
    });
    it("the verifier passes every check and lists what is left for a person", () => {
      expect(verifyRows.filter((r) => r.n <= 8).filter((r) => r.result !== "OK")).toEqual([]);
      expect(verifyRows.filter((r) => r.n <= 8)).toHaveLength(8);
      expect(verifyRows.find((r) => r.n === 9)!.result).toBe("1 / 1 / 2 / 1");
      expect(verifyRows.find((r) => r.n === 10)!.result).toBe("4 / 1");
      expect(verifyRows.find((r) => r.n === 11)!.result).toBe("1");
      expect(verifyRows.filter((r) => r.n > 100)).toHaveLength(5);
    });
    it("a moved enquiry gets one system timeline line; every earlier line, and every line of an unmoved or closed enquiry, is untouched", async () => {
      for (const [k, want] of Object.entries(EXPECT)) {
        const ev = await events(E[k]!);
        if (!want.to) { expect(await eventsHash(E[k]!), k).toBe(eventsBefore[k]); continue; }
        const last = ev.at(-1)!;
        expect(last, k).toMatchObject({ kind: "stage_changed", from_value: "estimate_sent", to_value: want.to, actor_id: null });
        expect(last.reason, k).toMatch(/^Estimate sent is no longer a pipeline stage\./);
        // The lines that mention Estimate sent are still there, exactly as written.
        expect(ev.filter((e) => e.kind === "stage_changed" && e.to_value === "estimate_sent").length, k).toBeGreaterThan(0);
        expect(ev.some((e) => e.kind === "proposal" && /recorded as sent on/.test(e.to_value ?? "")), k).toBe(true);
      }
      expect(await eventsHash(E.closed!)).toBe(eventsBefore.closed);
      expect(await opp(E.closed!)).toMatchObject({ stage: "lost", stage_before_close: "estimate_sent" });
    });
    it("only the three stated functions changed; the send records are all kept; a second run changes nothing", async () => {
      for (const k of ["index", "reminders", "jarvis"]) expect(await src(FNS[k as keyof typeof FNS]), k).toBe(before[k]);
      for (const k of ["move", "record", "reopen"]) expect(await src(FNS[k as keyof typeof FNS]), k).not.toBe(before[k]);
      expect((await admin<{ n: string }>(`select count(*)::text n from crm_estimate_sends`))[0].n).toBe(String(Object.keys(EST).length));
      const world = async () => (await admin<{ h: string }>(`select md5((select string_agg(o::text, '|' order by o.id) from crm_opportunities o) || (select count(*) from crm_opportunity_events)::text || (select string_agg(m::text, '|' order by m.id) from crm_stage_retirement_moves m)) h`))[0].h;
      const w = await world();
      await db.applyMigration(MIGRATION);
      expect(await world()).toBe(w);
    });
    it("the record of what was moved is not readable or writable by signed-in people", async () => {
      await expect(q(U.founder, `select * from crm_stage_retirement_moves`)).rejects.toThrow(/permission denied/);
      await expect(q(U.founder, `delete from crm_stage_retirement_moves`)).rejects.toThrow(/permission denied/);
    });
  });

  describe("nobody is moved into Estimate sent any more", () => {
    it("Move stage refuses it for the owner and a founder, from every stage, and writes nothing", async () => {
      const oid = await newOpp("Fictional fresh enquiry");
      const est = await finalEstimate(oid);
      await record(est);
      const h = async () => `${JSON.stringify(await opp(oid))}${await eventsHash(oid)}`;
      const w = await h();
      await expect(move(oid, "estimate_sent")).rejects.toThrow(/Estimate sent is no longer a pipeline stage/);
      await expect(move(oid, "estimate_sent", U.founder)).rejects.toThrow(/Estimate sent is no longer a pipeline stage/);
      expect(await h()).toBe(w);
      await expect(move(E.proposalFirst!, "estimate_sent")).rejects.toThrow(/Estimate sent is no longer a pipeline stage/);
    });
    it("record as sent with the deployed app's p_move = true still records the exact revision, date, person and time, and leaves stage and version alone", async () => {
      const oid = await newOpp("Fictional record only");
      await move(oid, "qualified");
      const est = await finalEstimate(oid);
      const was = await opp(oid);
      const r = (await record(est, { move: true }))[0].r;
      expect(r).toMatchObject({ moved: false, stage: "qualified", version: was.version });
      expect(await opp(oid)).toMatchObject({ stage: "qualified", version: was.version, stage_changed_at: was.stage_changed_at });
      const send = (await admin<{ proposal_id: string; revision: number; sent_on: string; recorded_by: string; fresh: boolean; reference: string }>(`select proposal_id, revision, sent_on::text, recorded_by, recorded_at > now() - interval '1 minute' as fresh, reference from crm_estimate_sends where id = '${r.send_id}'`))[0];
      expect(send).toMatchObject({ proposal_id: est, revision: 1, recorded_by: U.sara, fresh: true });
      expect(send.reference).toMatch(/^EST-UAE-/);
      expect((await events(oid)).at(-1)).toMatchObject({ kind: "proposal", actor_id: U.sara });
      expect((await events(oid)).at(-1)!.to_value).toMatch(/^Estimate EST-UAE-\S+ rev 1 recorded as sent on \d{4}-\d{2}-\d{2}$/);
      // On hold too: the earlier function raised "Resume the opportunity" when asked to move; now it records and that is all.
      const held = await newOpp("Fictional record while held"); const est2 = await finalEstimate(held);
      await commit(U.sara, `select crm_hold_opportunity('${held}', 'Internal capacity', ${today} + 7)`);
      expect((await record(est2, { move: true }))[0].r).toMatchObject({ moved: false, stage: "on_hold" });
      // The other refusals are as they were.
      await expect(record(est)).rejects.toThrow(/already recorded as sent/);
      await expect(record(est2, { who: U.omar })).rejects.toThrow();
      await expect(record(est2, { who: U.faisal })).rejects.toThrow(/Estimate not found/);
    });
    it("an estimate recorded as sent unlocks neither Proposal sent nor Quote sent", async () => {
      const oid = await newOpp("Fictional gates"); const est = await finalEstimate(oid); await record(est);
      await expect(move(oid, "proposal_sent")).rejects.toThrow(/Record a proposal as sent before moving to Proposal sent/);
      await expect(move(oid, "quote_sent")).rejects.toThrow(/Record the Zoho Books quote reference before moving to Quote sent/);
      await expect(commit(U.sara, `select crm_set_proposal_status('${est}', 'sent', ${today})`)).rejects.toThrow(/An estimate cannot be marked as sent/);
    });
    it("a closed enquiry cannot be reopened into it: neither asked for, nor as the default of one that was closed from it", async () => {
      await expect(commit(U.founder, `select crm_reopen_opportunity('${E.closed}', 'Client came back', 'Call', ${soon})`)).rejects.toThrow(/Estimate sent is no longer a pipeline stage\. Choose the stage to reopen into/);
      await expect(commit(U.founder, `select crm_reopen_opportunity('${E.closed}', 'Client came back', 'Call', ${soon}, 'other', 'estimate_sent')`)).rejects.toThrow(/Estimate sent is no longer a pipeline stage/);
      expect(await opp(E.closed!)).toMatchObject({ stage: "lost", stage_before_close: "estimate_sent" });
      await commit(U.founder, `select crm_reopen_opportunity('${E.closed}', 'Client came back', 'Call', ${soon}, 'other', 'proposal_prep')`);
      expect((await opp(E.closed!)).stage).toBe("proposal_prep");
    });
  });

  describe("an ambiguous enquiry is not stranded", () => {
    it("it is still readable by its company only, and still counts as a working enquiry", async () => {
      expect(await q(U.omar, `select stage from crm_opportunities where id = '${E.withdrawn}'`)).toEqual([{ stage: "estimate_sent" }]);
      expect(await q(U.faisal, `select stage from crm_opportunities where id = '${E.withdrawn}'`)).toEqual([]);
      expect((await admin<{ i: number }>(`select crm_stage_index('estimate_sent') i`))[0].i).toBe(4);
    });
    it("only its owner or a founder moves it out: a colleague and another company cannot", async () => {
      await expect(move(E.withdrawn!, "proposal_prep", U.omar)).rejects.toThrow();
      await expect(move(E.withdrawn!, "proposal_prep", U.faisal)).rejects.toThrow();
      expect((await opp(E.withdrawn!)).stage).toBe("estimate_sent");
      // Forward past a gate still needs that gate's own evidence.
      await expect(move(E.withdrawn!, "proposal_sent")).rejects.toThrow(/Record a proposal as sent/);
      await expect(move(E.withdrawn!, "quote_sent")).rejects.toThrow(/Zoho Books quote reference/);
      await move(E.withdrawn!, "proposal_prep");
      expect((await opp(E.withdrawn!)).stage).toBe("proposal_prep");
      await expect(move(E.withdrawn!, "estimate_sent")).rejects.toThrow(/no longer a pipeline stage/);      // and never back in
      // The one that stepped back from Quote sent goes forward again only because a person says so (its Zoho reference is on record).
      await move(E.steppedBack!, "quote_sent", U.founder);
      expect((await opp(E.steppedBack!)).stage).toBe("quote_sent");
    });
    it("it can be put on hold and resumed (it returns to where it was, and is then moved by a person), and it can be closed", async () => {
      await commit(U.sara, `select crm_hold_opportunity('${E.noHistory}', 'Internal capacity', ${today} + 7)`);
      await commit(U.sara, `select crm_resume_opportunity('${E.noHistory}', 'Call again', ${soon})`);
      expect((await opp(E.noHistory!)).stage).toBe("estimate_sent");
      await commit(U.sara, `select crm_mark_lost('${E.noHistory}', 'Event cancelled')`);
      expect(await opp(E.noHistory!)).toMatchObject({ stage: "lost", stage_before_close: "estimate_sent" });
      // The held one the migration could place resumes into the placed stage.
      await commit(U.sara, `select crm_resume_opportunity('${E.held}', 'Call again', ${soon})`);
      expect((await opp(E.held!)).stage).toBe("qualified");
    });
    it("the reminder sweep still runs with such enquiries present", async () => {
      await db.seed(`select crm_generate_reminders()`);
    });
  });

  describe("rollback pack", () => {
    it("restores the three functions exactly, puts back only enquiries nobody touched since, drops its record, and is safe to run twice", async () => {
      // proposalFirst, fromPrep and ksa were not touched since the migration; fromQualified is moved on by its owner first; held was resumed by a person.
      await move(E.fromQualified!, "proposal_prep");
      await db.seed(pack("crm_retire_estimate_sent_90_rollback.sql"));
      await db.seed(pack("crm_retire_estimate_sent_90_rollback.sql"));
      for (const k of Object.keys(FNS)) expect(await src(FNS[k as keyof typeof FNS]), k).toBe(before[k]);
      expect((await admin<{ t: string | null }>(`select to_regclass('public.crm_stage_retirement_moves')::text t`))[0].t).toBeNull();
      expect((await opp(E.proposalFirst!)).stage).toBe("estimate_sent");
      expect((await opp(E.fromPrep!)).stage).toBe("estimate_sent");
      expect((await opp(E.ksa!)).stage).toBe("estimate_sent");
      expect((await opp(E.fromQualified!)).stage).toBe("proposal_prep");      // a person moved it: left alone
      expect((await opp(E.held!)).stage).toBe("qualified");                    // a person resumed it: left alone
      expect((await events(E.proposalFirst!)).at(-1)).toMatchObject({ kind: "stage_changed", from_value: "proposal_sent", to_value: "estimate_sent", actor_id: null });
      // The previous behaviour is back: the stage can be entered again, and record-as-sent can move.
      const oid = await newOpp("Fictional after rollback"); const est = await finalEstimate(oid);
      expect((await record(est, { move: true }))[0].r).toMatchObject({ moved: true, stage: "estimate_sent" });
    });
  });

  describe("why a revision of an earlier quotation needs a person's review (the unchanged revision function)", () => {
    it("crm_quote_create_revision copies the terms and their label as they are: six standard clauses from a quotation issued without the estimate marker, the marker from an estimate", async () => {
      const oid = await newOpp("Fictional revision terms");
      // A quotation as the app issued it before the estimates-only change: the template terms, no marker.
      const legacy = (await commit<{ id: string }>(U.sara, `select crm_quote_create('${oid}') as id`))[0].id;
      await commit(U.sara, `select crm_quote_save_header('${legacy}', ${j({ currency: "EUR", vat_choice_id: vat[CO.uae]!["5%"], bill_to_org_id: clientUae })})`);
      const s = (await commit<{ id: string }>(U.sara, `select crm_quote_save_section('${legacy}', null, 'Fabrication') as id`))[0].id;
      await commit(U.sara, `select crm_quote_save_line('${legacy}', null, '${s}', ${j({ description: "Legacy deck", unit: "m2", quantity: "1", unit_price: "10" })})`);
      await commit(U.sara, `select crm_quote_issue('${legacy}')`);
      const snapBefore = (await admin<{ h: string }>(`select md5(content::text) || content_hash h from crm_quotation_snapshots where proposal_id = '${legacy}'`))[0].h;
      const rev = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${legacy}') as id`))[0].id;
      const terms = async (p: string) => (await admin<{ label: string | null; titles: string }>(`select terms_label label, coalesce((select string_agg(t->>'title', ', ') from jsonb_array_elements(terms) t), '') titles from crm_quotations where proposal_id = '${p}'`))[0];
      expect(await terms(rev)).toEqual({ label: "Standard terms (working draft, pending legal review)", titles: "Site access and readiness, Site services and other trades, Changes, Start of work, Scope exclusions, Confidentiality" });
      // The explicit step the app runs when the person confirms (the same call): the draft takes the estimate marker and loses the clauses; the issued revision is untouched.
      await commit(U.sara, `select crm_quote_save_header('${rev}', ${j({ terms_label: "estimate-format:2", terms: [] })})`);
      expect(await terms(rev)).toEqual({ label: "estimate-format:2", titles: "" });
      expect(await terms(legacy)).toMatchObject({ label: "Standard terms (working draft, pending legal review)" });
      expect((await admin<{ h: string }>(`select md5(content::text) || content_hash h from crm_quotation_snapshots where proposal_id = '${legacy}'`))[0].h).toBe(snapBefore);
      // A colleague who is not the owner cannot run that step; nor can another company.
      await commit(U.sara, `select crm_quote_issue('${rev}')`);
      const rev3 = (await commit<{ id: string }>(U.sara, `select crm_quote_create_revision('${rev}') as id`))[0].id;
      expect(await terms(rev3)).toEqual({ label: "estimate-format:2", titles: "" });      // a revision of an estimate needs no review
      await expect(commit(U.omar, `select crm_quote_save_header('${rev3}', ${j({ terms_label: "x", terms: [] })})`)).rejects.toThrow(/owner of this opportunity or a founder/);
      await expect(commit(U.faisal, `select crm_quote_save_header('${rev3}', ${j({ terms_label: "x", terms: [] })})`)).rejects.toThrow();
    });
  });
});
