import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { callArgs, PROOF_KEY, proofCall, wrapperSql } from "../src/jarvis-proof";

// Every wrapper is called here DIRECTLY as the signed-in person, with a REAL server-issued proof (signed with the key the database holds): the proof checks themselves, and what a caller
// with an invented proof can and cannot do, are in jarvis-proof.rls.test.ts.
// JARVIS part 2: the ledger-backed wrappers of the other write actions (migration 20261223000100_jarvis_platform.sql, extended in place). Fictional data only. For each wrapper:
//   * the work is done by the EXISTING function under the caller's own identity (a refused person is refused by the underlying rule, with no ledger row);
//   * the ledger row and the work commit together; N parallel calls with one confirmation id do the work exactly ONCE; a repeat returns the ORIGINAL result;
//   * another person, company, target or different reviewed values on a used confirmation id are refused; a refusal by the existing rules is recorded once and replayed.

const MIGRATION = "20261223000100_jarvis_platform.sql";
const id = () => randomUUID();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const CO = { uae: id(), ksa: id() };
const U = { sara: id(), omar: id(), founder: id(), noGrant: id(), ksaStaff: id(), outsider: id() };
const j = (o: unknown) => JSON.stringify(o);

describe("JARVIS part 2: write wrappers", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error("expected a refusal, but the call succeeded"); };
  const ledgerCount = async () => Number((await admin<{ n: string }>(`select count(*)::text n from jarvis_action_ledger`))[0].n);

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA LLC', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@jarvis-actions-test.ae')`).join(", ")};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR');
    `);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaStaff}', '${CO.ksa}', '{}');
    `);
    await db.applyMigration(MIGRATION);
    await admin(`update jarvis_settings set enabled = true, writes_enabled = true`);
    await admin(`select jarvis_set_proof_key('${PROOF_KEY}')`);
    await admin(`insert into jarvis_pilot_users (user_id) values ('${U.sara}'), ('${U.omar}'), ('${U.founder}'), ('${U.noGrant}'), ('${U.ksaStaff}')`);
  });
  afterAll(async () => { await db.teardown(); });

  let clientId = ""; let agencyId = "";
  const soon = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
  /** A fictional enquiry created by `user` through the EXISTING function; returns its id. */
  const newEnquiry = async (user: string, title = "Fictional harbour gala", company = CO.uae) =>
    (await commit<{ id: string }>(user, `select crm_create_opportunity(p_company_id => $1::uuid, p_title => $2, p_source => 'whatsapp', p_next_title => 'Call', p_next_due => $3::timestamptz, p_client_org_id => $4::uuid, p_location => 'Harbour Hall', p_technologies => '[{"name":"LED wall","qty":2}]'::jsonb) as id`, [company, title, soon(), clientId]))[0].id;
  const opp = async (oid: string) => (await admin<Record<string, unknown>>(`select title, location, event_start::text, version, stage, owner_id, value, currency, technologies, scope from crm_opportunities where id = '${oid}'`))[0];
  const events = async (oid: string) => admin<{ kind: string; from_value: string | null; to_value: string | null; reason: string | null; actor_id: string }>(`select kind, from_value, to_value, reason, actor_id from crm_opportunity_events where opportunity_id = '${oid}' order by created_at, id`);
  const ensureOrgs = async () => {
    if (clientId) return;
    clientId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    agencyId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Wave Agency 2', p_roles => '{agency}', p_country_code => 'AE') as id`))[0].id;
  };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("jarvis_register_organisation", () => {
    const ACT = "jarvis.sales.organisation.register";
    const args = (over: Record<string, unknown> = {}) => ({ company_id: CO.uae, name: "Fictional Lantern Events", roles: ["agency"], country_code: "AE", website: "https://www.lantern-events.example/about", place: "Dubai", note: "SECRET-NOTE-TEXT-777", acknowledged_org_ids: [], ...over });
    /** The acknowledgement (`acknowledged_org_ids`) is part of the SIGNED payload text: there is no other parameter. `as` = who presents the proof (default: who it was signed for). */
    const reg = (user: string, conf: string, a: Record<string, unknown> = args(), o: { as?: string; company?: string } = {}) => {
      const c = proofCall({ user, company: o.company ?? (typeof a.company_id === "string" ? a.company_id : CO.uae), action: ACT, target: "new", payload: a, jti: conf });
      return commit<{ r: Record<string, unknown> }>(o.as ?? user, wrapperSql("jarvis_register_organisation"), callArgs(c));
    };
    const orgCount = async (name?: string) => Number((await admin<{ n: string }>(`select count(*)::text n from crm_organisations ${name ? `where name = '${name}'` : ""}`))[0].n);
    type R = { status: string; result_id: string | null; reference: string | null; extra: { company_id: string } | null; replayed: boolean; error_code: string | null; error_message: string | null };

    it("registers the organisation once through the EXISTING create function under the caller's identity, with this company's profile and no owner, lead source or contacts", async () => {
      const conf = id();
      const r = (await reg(U.sara, conf))[0].r as R;
      expect(r).toMatchObject({ status: "done", reference: "Fictional Lantern Events", replayed: false, extra: { company_id: CO.uae } });
      const org = (await admin<Record<string, unknown>>(`select name, kind, roles, country_code, website, website_domain, place, created_by from crm_organisations where id = '${r.result_id}'`))[0];
      expect(org).toMatchObject({ name: "Fictional Lantern Events", kind: "agency", roles: ["agency"], country_code: "AE", website_domain: "lantern-events.example", place: "Dubai", created_by: U.sara });
      const prof = await admin<Record<string, unknown>>(`select owner_id, lead_source, exhibition from crm_account_profiles where organisation_id = '${r.result_id}' and company_id = '${CO.uae}'`);
      expect(prof).toEqual([{ owner_id: null, lead_source: null, exhibition: null }]);
      expect((await admin(`select 1 from crm_contacts where organisation_id = '${r.result_id}'`)).length).toBe(0);
      const led = (await admin<Record<string, unknown>>(`select user_id, company_id, action_id, target, status, result_id, result_ref, result_extra from jarvis_action_ledger where confirmation_id = '${conf}'`))[0];
      expect(led).toMatchObject({ user_id: U.sara, company_id: CO.uae, action_id: "jarvis.sales.organisation.register", target: "new", status: "done", result_id: r.result_id, result_ref: "Fictional Lantern Events", result_extra: { company_id: CO.uae } });
    });
    it("the ledger never stores the note, website or any field text beyond the organisation's name (the reference)", async () => {
      const dump = JSON.stringify(await admin(`select * from jarvis_action_ledger`));
      for (const needle of ["SECRET-NOTE-TEXT-777", "lantern-events.example", "Dubai"]) expect(dump).not.toContain(needle);
    });
    it("a repeat returns the ORIGINAL result and registers nothing; N parallel calls with one confirmation id register exactly ONE organisation", async () => {
      const conf = id();
      const first = (await reg(U.sara, conf, args({ name: "Fictional Repeat Studio", website: null })))[0].r as R;
      const n = await orgCount();
      for (let i = 0; i < 3; i++) expect((await reg(U.sara, conf, args({ name: "Fictional Repeat Studio", website: null })))[0].r).toMatchObject({ status: "done", replayed: true, result_id: first.result_id });
      expect(await orgCount()).toBe(n);
      const par = id();
      const before = await orgCount();
      const rs = (await Promise.all(Array.from({ length: 12 }, () => reg(U.sara, par, args({ name: "Fictional Parallel Studio", website: null }))))).map((x) => x[0].r as R);
      expect(new Set(rs.map((r) => r.result_id)).size).toBe(1);
      expect(rs.filter((r) => !r.replayed).length).toBe(1);
      expect(await orgCount()).toBe(before + 1);
    });
    it("another person, a different company or different reviewed values on a used confirmation id are refused", async () => {
      const conf = id();
      await reg(U.sara, conf, args({ name: "Fictional Bound Studio", website: null }));
      const n = await orgCount();
      // another person presenting sara's proof: the MAC binds the approving person, so the database refuses it as not valid (nothing is revealed about the confirmation)
      expect((await rejection(reg(U.sara, conf, args({ name: "Fictional Bound Studio", website: null }), { as: U.founder }))).code).toBe("JV002");
      // the same confirmation id used for different (separately signed) values: refused by the ledger
      expect((await rejection(reg(U.sara, conf, args({ name: "Fictional Bound Studio", website: null, place: "Elsewhere" })))).code).toBe("42501");
      expect(await orgCount()).toBe(n);
    });
    it("a same-name or same-website organisation that was not named as different is refused with NOTHING written (no organisation, no ledger row); naming exactly it lets the save through", async () => {
      const existing = (await admin<{ id: string }>(`select id from crm_organisations where name = 'Fictional Lantern Events' limit 1`))[0].id;
      const n = await orgCount();
      const conf = id();
      const r = (await reg(U.sara, conf, args({ name: "FICTIONAL LANTERN EVENTS L.L.C", website: null })))[0].r as R;
      expect(r.status).toBe("done"); // 'LLC' changes the normalised name: not the same name
      const l = await ledgerCount();
      const same = args({ name: "fictional lantern events", website: null });
      const e1 = await rejection(reg(U.sara, id(), same));
      expect(e1.code).toBe("JV001");
      expect(e1.message).toMatch(/similar organisation/);
      expect((await rejection(reg(U.sara, id(), args({ name: "A Completely Different Name", website: "http://lantern-events.example/" })))).code).toBe("JV001");
      expect(await orgCount()).toBe(n + 1);
      expect(await ledgerCount()).toBe(l);
      const ok = (await reg(U.sara, id(), args({ name: "fictional lantern events", website: null, acknowledged_org_ids: [existing] })))[0].r as R;
      expect(ok.status).toBe("done");
      expect(await orgCount()).toBe(n + 2);
    });
    it("archived organisations are not duplicates", async () => {
      const o = (await reg(U.sara, id(), args({ name: "Fictional Archived Studio", website: null })))[0].r as R;
      await admin(`update crm_organisations set archived_at = now() where id = '${o.result_id}'`);
      expect(((await reg(U.sara, id(), args({ name: "Fictional Archived Studio", website: null })))[0].r as R).status).toBe("done");
    });
    it("the type is required and checked in SQL: no roles, an unknown role or an empty name are refused with no ledger row", async () => {
      const before = await ledgerCount();
      for (const a of [args({ roles: [] }), args({ roles: ["boss"] }), args({ roles: "agency" }), args({ name: "   " })]) {
        expect(["22023", "22P02"]).toContain((await rejection(reg(U.sara, id(), a))).code);
      }
      // a payload that names another company than the signed one is not valid
      expect((await rejection(reg(U.sara, id(), args({ company_id: CO.ksa }), { company: CO.uae }))).code).toBe("JV002");
      expect((await rejection(reg(U.sara, id(), args({ company_id: null }), { company: CO.uae }))).code).toBe("JV002");
      expect((await rejection(commit(U.sara, `select jarvis_register_organisation($1::uuid, $2::uuid, 'new', null, 5::bigint, 'nope', '{}')`, [id(), CO.uae]))).code).toBe("JV002");
      expect(await ledgerCount()).toBe(before);
    });
    it("cannot bypass permissions: no Sales grant, another company's grant, a revoked grant, JARVIS off or writes off are refused with no ledger row and no organisation", async () => {
      const n = await orgCount(); const l = await ledgerCount();
      expect((await rejection(reg(U.noGrant, id()))).code).toBe("42501");
      expect((await rejection(reg(U.ksaStaff, id(), args({ company_id: CO.uae })))).code).toBe("42501");
      expect((await rejection(reg(U.outsider, id()))).code).toBe("42501");
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.omar}'`);
      expect((await rejection(reg(U.omar, id()))).code).toBe("42501");
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.omar}'`);
      await admin(`update jarvis_settings set writes_enabled = false`);
      expect((await rejection(reg(U.sara, id()))).code).toBe("42501");
      await admin(`update jarvis_settings set writes_enabled = true, enabled = false`);
      expect((await rejection(reg(U.sara, id()))).code).toBe("42501");
      await admin(`update jarvis_settings set enabled = true`);
      expect(await orgCount()).toBe(n);
      expect(await ledgerCount()).toBe(l);
    });
    it("signed out (anon) and direct calls of the internal helpers are refused", async () => {
      const H = sha("any");
      for (const sql of [`select jarvis_register_organisation('${id()}', '${CO.uae}', 'new', null, 5, '${H}', '{}')`, `select jarvis_ledger_enter('${id()}', '${H}', 'x', '${CO.uae}', 'new')`]) {
        expect((await rejection(db.asUser(null, async (q) => (await q(sql)).rows))).message).toMatch(/permission denied/);
      }
      for (const sql of [`select jarvis_ledger_enter('${id()}', '${H}', 'x', '${CO.uae}', 'new')`, `select jarvis_ledger_done('${id()}', '${id()}', 'x', null)`, `select jarvis_ledger_fail('${id()}', 'x', 'y')`]) {
        expect((await rejection(commit(U.sara, sql))).message).toMatch(/permission denied/);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("jarvis_update_enquiry", () => {
    const ACT = "jarvis.sales.enquiry.update";
    /** `version` is the signed record version (null = signed as "no version", which this wrapper refuses). `o.as` = who presents the proof. */
    const upd = (user: string, conf: string, oid: string, version: number | null, patch: unknown, o: { as?: string; company?: string } = {}) =>
      commit<{ r: Record<string, unknown> }>(o.as ?? user, wrapperSql("jarvis_update_enquiry"), callArgs(proofCall({ user, company: o.company ?? CO.uae, action: ACT, target: oid, version, payload: patch, jti: conf })));
    type R = { status: string; result_id: string | null; reference: string | null; extra: { company_id: string; version: number; fields: string[] } | null; replayed: boolean; error_code: string | null; error_message: string | null };

    it("changes only the patched allowlisted columns through the EXISTING function, under the caller's identity, bumps the version once and writes both timeline lines", async () => {
      await ensureOrgs();
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      const conf = id();
      const r = (await upd(U.sara, conf, oid, v, { location: "Marina Arena", event_start: "2026-12-10", technologies: [{ name: "LED wall", qty: 3 }] }))[0].r as R;
      expect(r).toMatchObject({ status: "done", replayed: false, result_id: oid });
      expect(r.extra).toMatchObject({ company_id: CO.uae, version: v + 1, fields: ["event_start", "location", "technologies"] });
      expect(await opp(oid)).toMatchObject({ location: "Marina Arena", event_start: "2026-12-10", version: v + 1, stage: "new", owner_id: U.sara, value: null, technologies: [{ name: "LED wall", qty: 3 }] });
      const ev = await events(oid);
      expect(ev.filter((e) => e.kind === "details_changed").map((e) => `${e.from_value}|${e.to_value}`).sort()).toEqual(["jarvis|update", "null|event_start, location, technologies"]);
      expect(ev.find((e) => e.from_value === "jarvis")).toMatchObject({ actor_id: U.sara, reason: "event_start, location, technologies" });
      const led = (await admin<Record<string, unknown>>(`select action_id, target, status, result_id, result_extra from jarvis_action_ledger where confirmation_id = '${conf}'`))[0];
      expect(led).toMatchObject({ action_id: "jarvis.sales.enquiry.update", target: oid, status: "done", result_id: oid });
    });
    it("the ledger holds no field text", async () => {
      const dump = JSON.stringify(await admin(`select * from jarvis_action_ledger`));
      for (const needle of ["Marina Arena", "LED wall", "Harbour Hall"]) expect(dump).not.toContain(needle);
    });
    it("a repeat returns the ORIGINAL result although the version moved on, and changes nothing; N parallel calls change it exactly ONCE", async () => {
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      const conf = id();
      await upd(U.sara, conf, oid, v, { scope: "Supply and operate" });
      const after = await opp(oid);
      for (let i = 0; i < 3; i++) expect((await upd(U.sara, conf, oid, v, { scope: "Supply and operate" }))[0].r).toMatchObject({ status: "done", replayed: true, result_id: oid });
      expect(await opp(oid)).toEqual(after);
      const oid2 = await newEnquiry(U.sara);
      const v2 = Number((await opp(oid2)).version);
      const par = id();
      const rs = (await Promise.all(Array.from({ length: 12 }, () => upd(U.sara, par, oid2, v2, { scope: "Parallel scope" })))).map((x) => x[0].r as R);
      expect(rs.filter((r) => !r.replayed).length).toBe(1);
      expect(rs.every((r) => r.status === "done")).toBe(true);
      expect((await opp(oid2)).version).toBe(v2 + 1);
      expect((await events(oid2)).filter((e) => e.from_value === "jarvis")).toHaveLength(1);
    });
    it("STALE: a proof for a version that is no longer current is refused by the wrapper (40001) with NOTHING written, not even a ledger row", async () => {
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      await upd(U.sara, id(), oid, v, { scope: "First change" });
      const l = await ledgerCount();
      const conf = id();
      const e = await rejection(upd(U.sara, conf, oid, v, { scope: "Second change on an old version" }));
      expect(e.code).toBe("40001");
      expect(e.message).toMatch(/changed by someone else/);
      expect((await opp(oid)).scope).toBe("First change");
      expect(await ledgerCount()).toBe(l);
      expect((await admin(`select 1 from jarvis_action_ledger where confirmation_id = '${conf}'`)).length).toBe(0);
    });
    it("two people editing at once from the same version: exactly one wins, the other is refused as stale (nothing written for it)", async () => {
      const oid = await newEnquiry(U.sara);
      await admin(`update crm_opportunities set owner_id = '${U.sara}' where id = '${oid}'`);
      const v = Number((await opp(oid)).version);
      const l = await ledgerCount();
      const out = await Promise.allSettled([upd(U.sara, id(), oid, v, { scope: "Sara's scope" }), upd(U.founder, id(), oid, v, { scope: "Founder's scope" })]);
      expect(out.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const lost = out.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect((lost.reason as { code?: string }).code).toBe("40001");
      expect((await opp(oid)).version).toBe(v + 1);
      expect(await ledgerCount()).toBe(l + 1);
    });
    it("ONLY the allowlist passes: owner, stage, agency or end client, value, currency, payment terms, exclusions, risks, source and anything unknown are refused before the ledger, nothing changes", async () => {
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      const before = await opp(oid); const l = await ledgerCount();
      for (const k of ["owner_id", "stage", "agency_org_id", "client_org_id", "value", "currency", "payment_terms", "exclusions", "risks", "source", "reference", "company_id", "version", "evidence_reference", "bogus"]) {
        const e = await rejection(upd(U.sara, id(), oid, v, { [k]: k === "risks" ? [] : "x", scope: "Allowed together with a forbidden one" }));
        expect(e.code, k).toBe("22023");
        expect(e.message).toMatch(/cannot be changed through JARVIS/);
      }
      expect(await opp(oid)).toEqual(before);
      expect(await ledgerCount()).toBe(l);
    });
    it("incomplete requests are refused with no ledger row (no signed version, empty patch, not an object, a MAC that is not a MAC)", async () => {
      const oid = await newEnquiry(U.sara);
      const l = await ledgerCount();
      expect((await rejection(upd(U.sara, id(), oid, null, { scope: "x" }))).code).toBe("JV002");
      expect((await rejection(upd(U.sara, id(), oid, 1, {}))).code).toBe("22023");
      expect((await rejection(upd(U.sara, id(), oid, 1, "[1]"))).code).toBe("22023");
      expect((await rejection(commit(U.sara, `select jarvis_update_enquiry($1::uuid, $2::uuid, $3, 1, 5::bigint, 'nope', '{"scope":"x"}')`, [id(), CO.uae, oid]))).code).toBe("JV002");
      expect(await ledgerCount()).toBe(l);
    });
    it("the EXISTING owner-or-founder rule applies: a colleague with a Sales grant is refused (recorded failed, nothing changed); the founder may edit another person's enquiry", async () => {
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      const f = (await upd(U.omar, id(), oid, v, { scope: "Omar's scope" }))[0].r as R;
      expect(f).toMatchObject({ status: "failed", error_code: "42501" });
      expect((await opp(oid)).scope).toBeNull();
      expect(((await upd(U.founder, id(), oid, v, { scope: "Founder's scope" }))[0].r as R).status).toBe("done");
    });
    it("a Lost enquiry is refused by the existing rule; a Won enquiry's money is not in the allowlist anyway", async () => {
      const oid = await newEnquiry(U.sara);
      await commit(U.sara, `select crm_mark_lost($1::uuid, 'Event cancelled')`, [oid]);
      const v = Number((await opp(oid)).version);
      expect(((await upd(U.sara, id(), oid, v, { scope: "x" }))[0].r as R)).toMatchObject({ status: "failed", error_code: "23514" });
    });
    it("cannot bypass visibility or permissions: no Sales grant, another company's enquiry, a forged id, revoked grant, JARVIS or writes off; no ledger row, nothing changes", async () => {
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      const before = await opp(oid); const l = await ledgerCount();
      expect((await rejection(upd(U.noGrant, id(), oid, v, { scope: "x" }))).code).toBe("P0002");
      expect((await rejection(upd(U.ksaStaff, id(), oid, v, { scope: "x" }))).code).toBe("P0002");
      expect((await rejection(upd(U.sara, id(), id(), v, { scope: "x" }))).code).toBe("P0002");
      expect((await rejection(upd(U.outsider, id(), oid, v, { scope: "x" }))).code).toMatch(/P0002|42501/);
      await admin(`update jarvis_settings set writes_enabled = false`);
      expect((await rejection(upd(U.sara, id(), oid, v, { scope: "x" }))).code).toBe("42501");
      await admin(`update jarvis_settings set writes_enabled = true, enabled = false`);
      expect((await rejection(upd(U.sara, id(), oid, v, { scope: "x" }))).code).toBe("42501");
      await admin(`update jarvis_settings set enabled = true`);
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.sara}'`);
      expect((await rejection(upd(U.sara, id(), oid, v, { scope: "x" }))).code).toBe("P0002");
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.sara}'`);
      expect(await opp(oid)).toEqual(before);
      expect(await ledgerCount()).toBe(l);
    });
    it("another person, or different reviewed values, on a used confirmation id are refused", async () => {
      const oid = await newEnquiry(U.sara);
      const v = Number((await opp(oid)).version);
      const conf = id();
      await upd(U.sara, conf, oid, v, { scope: "Bound scope" });
      expect((await rejection(upd(U.sara, conf, oid, v, { scope: "Bound scope" }, { as: U.founder }))).code).toBe("JV002");
      expect((await rejection(upd(U.sara, conf, oid, v, { scope: "Other scope" }))).code).toBe("42501");
      const other = await newEnquiry(U.sara, "Another one");
      expect((await rejection(upd(U.sara, conf, other, Number((await opp(other)).version), { scope: "Bound scope" }))).code).toBe("42501");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("jarvis_change_stage", () => {
    const ACT = "jarvis.sales.enquiry.change_stage";
    const move = (user: string, conf: string, oid: string, to: string, version: number | null, o: { as?: string; payload?: unknown } = {}) =>
      commit<{ r: Record<string, unknown> }>(o.as ?? user, wrapperSql("jarvis_change_stage"), callArgs(proofCall({ user, company: CO.uae, action: ACT, target: oid, version, payload: o.payload ?? { to }, jti: conf })));
    type R = { status: string; result_id: string | null; extra: { company_id: string; version: number; from: string; to: string } | null; replayed: boolean; error_code: string | null; error_message: string | null };
    const ver = async (oid: string) => Number((await opp(oid)).version);
    const step = async (user: string, oid: string, to: string) => (await move(user, id(), oid, to, await ver(oid)))[0].r as R;
    const sentProposal = async (user: string, oid: string, status = "sent") => {
      const pid = (await commit<{ id: string }>(user, `select crm_add_proposal($1::uuid, 'Fictional proposal note') as id`, [oid]))[0].id;
      await commit(user, `select crm_set_proposal_status($1::uuid, $2, current_date)`, [pid, status]);
    };

    it("every UNGATED one-step move works, forward and back, through the EXISTING crm_move_stage: version +1, the usual stage line and the JARVIS line, a ledger row", async () => {
      await ensureOrgs();
      const oid = await newEnquiry(U.sara);
      const v = await ver(oid);
      const conf = id();
      const r = (await move(U.sara, conf, oid, "qualified", v))[0].r as R;
      expect(r).toMatchObject({ status: "done", replayed: false, result_id: oid });
      expect(r.extra).toMatchObject({ company_id: CO.uae, version: v + 1, from: "new", to: "qualified" });
      expect(await opp(oid)).toMatchObject({ stage: "qualified", version: v + 1 });
      const ev = await events(oid);
      expect(ev.find((e) => e.kind === "stage_changed")).toMatchObject({ from_value: "new", to_value: "qualified", actor_id: U.sara });
      expect(ev.find((e) => e.from_value === "jarvis")).toMatchObject({ kind: "details_changed", to_value: "stage", reason: "new>qualified", actor_id: U.sara });
      expect((await admin<Record<string, unknown>>(`select action_id, target, status from jarvis_action_ledger where confirmation_id = '${conf}'`))[0]).toMatchObject({ action_id: "jarvis.sales.enquiry.change_stage", target: oid, status: "done" });
      expect((await step(U.sara, oid, "proposal_prep")).status).toBe("done");
      expect((await step(U.sara, oid, "qualified")).status).toBe("done");
      expect((await step(U.sara, oid, "new")).status).toBe("done");
      expect(await opp(oid)).toMatchObject({ stage: "new" });
      expect((await admin(`select 1 from crm_follow_ups where opportunity_id = '${oid}' and status = 'open'`)).length).toBe(1); // the open follow-up is untouched
    });
    it("PROPOSAL SENT: refused without a recorded sent proposal (a draft does not count, recorded failed once, nothing moves); allowed once one is recorded as sent", async () => {
      const oid = await newEnquiry(U.sara);
      await step(U.sara, oid, "qualified"); await step(U.sara, oid, "proposal_prep");
      const conf = id();
      const f = (await move(U.sara, conf, oid, "proposal_sent", await ver(oid)))[0].r as R;
      expect(f).toMatchObject({ status: "failed", error_code: "23514" });
      expect(f.error_message).toMatch(/Record a proposal as sent/);
      expect((await opp(oid)).stage).toBe("proposal_prep");
      await commit(U.sara, `select crm_add_proposal($1::uuid, 'draft only')`, [oid]);
      expect(((await step(U.sara, oid, "proposal_sent")) as R).status).toBe("failed");
      await sentProposal(U.sara, oid);
      expect(((await step(U.sara, oid, "proposal_sent")) as R).status).toBe("done");
      expect((await opp(oid)).stage).toBe("proposal_sent");
      expect(((await move(U.sara, conf, oid, "proposal_sent", await ver(oid) - 1))[0].r as R)).toMatchObject({ status: "failed", replayed: true });
    });
    it("QUOTE SENT: refused without the Zoho quote reference (blank does not count); allowed with it; negotiation then needs nothing", async () => {
      const oid = await newEnquiry(U.sara);
      for (const to of ["qualified", "proposal_prep"]) await step(U.sara, oid, to);
      await sentProposal(U.sara, oid);
      await step(U.sara, oid, "proposal_sent");
      const f = await step(U.sara, oid, "quote_sent");
      expect(f).toMatchObject({ status: "failed", error_code: "23514" });
      expect(f.error_message).toMatch(/Zoho Books quote reference/);
      await commit(U.sara, `select crm_upsert_zoho_reference($1::uuid, p_quote_ref => 'QT-FICTIONAL-1')`, [oid]);
      expect((await step(U.sara, oid, "quote_sent")).status).toBe("done");
      expect((await step(U.sara, oid, "negotiation")).status).toBe("done");
      expect((await step(U.sara, oid, "quote_sent")).status).toBe("done"); // back into a gated stage: its evidence still exists
      expect((await opp(oid)).stage).toBe("quote_sent");
    });
    it("what JARVIS never offers is refused by the wrapper before the ledger: skips, two steps back, On hold, Won, Lost, unknown stages; nothing changes", async () => {
      const oid = await newEnquiry(U.sara);
      const before = await opp(oid); const l = await ledgerCount();
      for (const to of ["proposal_prep", "negotiation", "on_hold", "won", "lost", "bogus", "new"]) expect((await rejection(move(U.sara, id(), oid, to, await ver(oid)))).code, to).toBe("22023");
      await step(U.sara, oid, "qualified"); await step(U.sara, oid, "proposal_prep");
      expect((await rejection(move(U.sara, id(), oid, "new", await ver(oid)))).code).toBe("22023");
      await step(U.sara, oid, "qualified"); await step(U.sara, oid, "new");
      expect(await opp(oid)).toMatchObject({ stage: before.stage });
      expect(await ledgerCount()).toBe(l + 4);
    });
    it("an on-hold, won or lost enquiry cannot be moved: the existing function refuses (recorded failed), Won/Lost/hold forms are the only way", async () => {
      const lost = await newEnquiry(U.sara);
      await commit(U.sara, `select crm_mark_lost($1::uuid, 'Event cancelled')`, [lost]);
      expect(await step(U.sara, lost, "qualified")).toMatchObject({ status: "failed", error_code: "23514" });
      const held = await newEnquiry(U.sara);
      await commit(U.sara, `select crm_hold_opportunity($1::uuid, 'Client postponed event', (current_date + 10))`, [held]);
      const f = await step(U.sara, held, "qualified");
      expect(f.status).toBe("failed");
      expect(f.error_message).toMatch(/Resume the opportunity/);
      expect((await opp(held)).stage).toBe("on_hold");
    });
    it("STALE proof version is refused with nothing written (no ledger row); N parallel calls with one confirmation id move it exactly ONCE; a repeat returns the original although the stage moved on", async () => {
      const oid = await newEnquiry(U.sara);
      const v = await ver(oid);
      await step(U.sara, oid, "qualified");
      const l0 = await ledgerCount();
      expect((await rejection(move(U.sara, id(), oid, "proposal_prep", v))).code).toBe("40001");
      expect(await ledgerCount()).toBe(l0);
      const oid2 = await newEnquiry(U.sara);
      const v2 = await ver(oid2);
      const conf = id();
      const rs = (await Promise.all(Array.from({ length: 12 }, () => move(U.sara, conf, oid2, "qualified", v2)))).map((x) => x[0].r as R);
      expect(rs.filter((r) => !r.replayed).length).toBe(1);
      expect(rs.every((r) => r.status === "done")).toBe(true);
      expect((await opp(oid2)).version).toBe(v2 + 1);
      expect((await events(oid2)).filter((e) => e.from_value === "jarvis")).toHaveLength(1);
      await step(U.sara, oid2, "proposal_prep");
      expect((await move(U.sara, conf, oid2, "qualified", v2))[0].r).toMatchObject({ status: "done", replayed: true });
      expect((await opp(oid2)).stage).toBe("proposal_prep");
    });
    it("the owner-or-founder rule applies: a colleague is refused (recorded failed, nothing moves); the founder may move another person's enquiry", async () => {
      const oid = await newEnquiry(U.sara);
      expect(await step(U.omar, oid, "qualified")).toMatchObject({ status: "failed", error_code: "42501" });
      expect((await opp(oid)).stage).toBe("new");
      expect((await step(U.founder, oid, "qualified")).status).toBe("done");
    });
    it("cannot bypass visibility or switches: no grant, another company, a forged id, revoked grant, JARVIS or writes off; no ledger row, nothing moves", async () => {
      const oid = await newEnquiry(U.sara);
      const v = await ver(oid);
      const before = await opp(oid); const l = await ledgerCount();
      expect((await rejection(move(U.noGrant, id(), oid, "qualified", v))).code).toBe("P0002");
      expect((await rejection(move(U.ksaStaff, id(), oid, "qualified", v))).code).toBe("P0002");
      expect((await rejection(move(U.sara, id(), id(), "qualified", v))).code).toBe("P0002");
      expect((await rejection(move(U.sara, id(), oid, "qualified", null))).code).toBe("JV002");
      await admin(`update jarvis_settings set writes_enabled = false`);
      expect((await rejection(move(U.sara, id(), oid, "qualified", v))).code).toBe("42501");
      await admin(`update jarvis_settings set writes_enabled = true, enabled = false`);
      expect((await rejection(move(U.sara, id(), oid, "qualified", v))).code).toBe("42501");
      await admin(`update jarvis_settings set enabled = true`);
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.sara}'`);
      expect((await rejection(move(U.sara, id(), oid, "qualified", v))).code).toBe("P0002");
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.sara}'`);
      expect(await opp(oid)).toEqual(before);
      expect(await ledgerCount()).toBe(l);
    });
    it("another person, another enquiry or different reviewed values on a used confirmation id are refused", async () => {
      const oid = await newEnquiry(U.sara);
      const conf = id();
      await move(U.sara, conf, oid, "qualified", await ver(oid));
      const v = await ver(oid) - 1;
      expect((await rejection(move(U.sara, conf, oid, "qualified", v, { as: U.founder }))).code).toBe("JV002");
      expect((await rejection(move(U.sara, conf, oid, "proposal_prep", v))).code).toBe("42501");
      const other = await newEnquiry(U.sara);
      expect((await rejection(move(U.sara, conf, other, "qualified", await ver(other)))).code).toBe("42501");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("jarvis_record_meeting (activity + follow-up, atomic)", () => {
    const ACT = "jarvis.sales.meeting.record";
    const activity = (over: Record<string, unknown> = {}) => ({ kind: "meeting", body: "SECRET-MEETING-NOTES-4242 agreed two LED walls", occurred_at: null, internal: false, ...over });
    const followUp = (over: Record<string, unknown> = {}) => ({ title: "SECRET-FOLLOWUP-TITLE send proposal", due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), kind: "proposal", ...over });
    const rec = (user: string, conf: string, oid: string, act: unknown = activity(), fu: unknown = followUp(), o: { as?: string } = {}) =>
      commit<{ r: Record<string, unknown> }>(o.as ?? user, wrapperSql("jarvis_record_meeting"), callArgs(proofCall({ user, company: CO.uae, action: ACT, target: oid, version: null, payload: { activity: act, follow_up: fu }, jti: conf })));
    type R = { status: string; result_id: string | null; reference: string | null; extra: { company_id: string; activity_id: string; follow_up_id: string | null } | null; replayed: boolean; error_code: string | null; error_message: string | null };
    const counts = async (oid: string) => (await admin<{ a: string; f: string; o: string }>(`select (select count(*) from crm_activities where opportunity_id = '${oid}')::text a, (select count(*) from crm_follow_ups where opportunity_id = '${oid}')::text f, (select count(*) from crm_follow_ups where opportunity_id = '${oid}' and status = 'open')::text o`))[0];

    it("saves the activity AND the follow-up in one transaction through the EXISTING functions, the follow-up assigned to the caller, plus the ledger row and the JARVIS timeline line", async () => {
      await ensureOrgs();
      const oid = await newEnquiry(U.sara);
      const before = await counts(oid);
      const conf = id();
      const r = (await rec(U.sara, conf, oid))[0].r as R;
      expect(r).toMatchObject({ status: "done", replayed: false, result_id: oid });
      expect(r.extra!.follow_up_id).toBeTruthy();
      const after = await counts(oid);
      expect(Number(after.a)).toBe(Number(before.a) + 1);
      expect(Number(after.f)).toBe(Number(before.f) + 1);
      const act = (await admin<Record<string, unknown>>(`select kind, created_by, is_internal from crm_activities where id = '${r.extra!.activity_id}'`))[0];
      expect(act).toMatchObject({ kind: "meeting", created_by: U.sara, is_internal: false });
      expect((await admin<Record<string, unknown>>(`select assigned_to, created_by, kind, status from crm_follow_ups where id = '${r.extra!.follow_up_id}'`))[0]).toMatchObject({ assigned_to: U.sara, created_by: U.sara, kind: "proposal", status: "open" });
      expect((await events(oid)).find((e) => e.from_value === "jarvis")).toMatchObject({ kind: "details_changed", to_value: "meeting", reason: "activity and follow-up", actor_id: U.sara });
      expect((await admin<Record<string, unknown>>(`select action_id, target, status, result_id from jarvis_action_ledger where confirmation_id = '${conf}'`))[0]).toMatchObject({ action_id: "jarvis.sales.meeting.record", target: oid, status: "done", result_id: oid });
    });
    it("the ledger holds neither the notes nor the follow-up title", async () => {
      const dump = JSON.stringify(await admin(`select * from jarvis_action_ledger`));
      for (const needle of ["SECRET-MEETING-NOTES-4242", "SECRET-FOLLOWUP-TITLE", "LED walls"]) expect(dump).not.toContain(needle);
    });
    it("activity only (no follow-up) records the activity alone", async () => {
      const oid = await newEnquiry(U.sara);
      const before = await counts(oid);
      const r = (await rec(U.sara, id(), oid, activity({ kind: "call" }), null))[0].r as R;
      expect(r).toMatchObject({ status: "done" });
      expect(r.extra!.follow_up_id).toBeNull();
      expect(await counts(oid)).toEqual({ a: String(Number(before.a) + 1), f: before.f, o: before.o });
    });
    it("ATOMIC: when the follow-up is refused (a Won enquiry has none) NOTHING is saved, not even the activity; the refusal is recorded once and replayed", async () => {
      const oid = await newEnquiry(U.sara);
      await admin(`update crm_opportunities set stage = 'negotiation' where id = '${oid}'`);
      await commit(U.sara, `select crm_mark_won($1::uuid, 'purchase_order', 'PO-1', current_date, null, 1000)`, [oid]).catch(() => null);
      let stage = (await opp(oid)).stage;
      if (stage !== "won") { await admin(`update crm_opportunities set stage = 'won', stage_changed_at = now(), closed_at = now(), closed_by = '${U.sara}', evidence_type = 'purchase_order', evidence_reference = 'PO-1', evidence_date = current_date, value = 1000, currency = 'AED' where id = '${oid}'`).catch(() => null); stage = (await opp(oid)).stage; }
      expect(stage).toBe("won");
      const before = await counts(oid);
      const conf = id();
      const [act, fu] = [activity(), followUp()]; // one payload: a repeat must send the same text (its hash is part of the proof)
      const f = (await rec(U.sara, conf, oid, act, fu))[0].r as R;
      expect(f).toMatchObject({ status: "failed", error_code: "23514", replayed: false });
      expect(f.error_message).toMatch(/closed opportunity has no follow-ups/);
      expect(await counts(oid)).toEqual(before);
      expect((await rec(U.sara, conf, oid, act, fu))[0].r).toMatchObject({ status: "failed", replayed: true });
      expect(await counts(oid)).toEqual(before);
      // the activity alone IS allowed on a Won enquiry
      expect(((await rec(U.sara, id(), oid, activity(), null))[0].r as R).status).toBe("done");
    });
    it("ATOMIC the other way: a future-dated activity is refused and the follow-up is not saved either; a Lost enquiry takes neither", async () => {
      const oid = await newEnquiry(U.sara);
      const before = await counts(oid);
      const f = (await rec(U.sara, id(), oid, activity({ occurred_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })))[0].r as R;
      expect(f).toMatchObject({ status: "failed", error_code: "22023" });
      expect(await counts(oid)).toEqual(before);
      const lost = await newEnquiry(U.sara);
      await commit(U.sara, `select crm_mark_lost($1::uuid, 'Event cancelled')`, [lost]);
      const b2 = await counts(lost);
      expect(((await rec(U.sara, id(), lost))[0].r as R)).toMatchObject({ status: "failed", error_code: "23514" });
      expect(await counts(lost)).toEqual(b2);
    });
    it("a repeat returns the ORIGINAL result and records nothing more; N parallel calls with one confirmation id record exactly ONE activity and ONE follow-up", async () => {
      const oid = await newEnquiry(U.sara);
      const conf = id();
      const [act, fu] = [activity(), followUp()];
      const first = (await rec(U.sara, conf, oid, act, fu))[0].r as R;
      const after = await counts(oid);
      for (let i = 0; i < 3; i++) expect((await rec(U.sara, conf, oid, act, fu))[0].r).toMatchObject({ status: "done", replayed: true, extra: first.extra });
      expect(await counts(oid)).toEqual(after);
      const oid2 = await newEnquiry(U.sara);
      const b2 = await counts(oid2);
      const par = id();
      const [act2, fu2] = [activity(), followUp()];
      const rs = (await Promise.all(Array.from({ length: 12 }, () => rec(U.sara, par, oid2, act2, fu2)))).map((x) => x[0].r as R);
      expect(rs.filter((r) => !r.replayed).length).toBe(1);
      expect(new Set(rs.map((r) => r.extra!.activity_id)).size).toBe(1);
      expect(await counts(oid2)).toEqual({ a: String(Number(b2.a) + 1), f: String(Number(b2.f) + 1), o: String(Number(b2.o) + 1) });
    });
    it("malformed requests are refused with no ledger row (type, text, follow-up without title or date, not objects)", async () => {
      const oid = await newEnquiry(U.sara);
      const l = await ledgerCount();
      for (const [a, f] of [[activity({ kind: "fax" }), followUp()], [activity({ body: "  " }), followUp()], [activity({ body: "x".repeat(4001) }), followUp()], [activity(), followUp({ title: "" })], [activity(), followUp({ due_at: null })]] as [unknown, unknown][]) {
        expect(["22023", "22P02"]).toContain((await rejection(rec(U.sara, id(), oid, a, f))).code);
      }
      expect((await rejection(commit(U.sara, wrapperSql("jarvis_record_meeting"), callArgs(proofCall({ user: U.sara, company: CO.uae, action: ACT, target: oid, payload: "[1]" }))))).code).toBe("22023");
      // a meeting is not bound to a record version: a proof signed WITH a version is refused
      expect((await rejection(commit(U.sara, wrapperSql("jarvis_record_meeting"), callArgs(proofCall({ user: U.sara, company: CO.uae, action: ACT, target: oid, version: 3, payload: { activity: activity(), follow_up: null } }))))).code).toBe("JV002");
      expect(await ledgerCount()).toBe(l);
    });
    it("the follow-up is always the caller's: there is no way to name an assignee through the wrapper", async () => {
      const oid = await newEnquiry(U.sara);
      const r = (await rec(U.omar, id(), oid, activity(), { ...followUp(), assigned_to: U.sara, assignee: U.sara }))[0].r as R;
      expect(r.status).toBe("done");
      expect((await admin<{ assigned_to: string }>(`select assigned_to from crm_follow_ups where id = '${r.extra!.follow_up_id}'`))[0].assigned_to).toBe(U.omar);
    });
    it("cannot bypass visibility or switches: no grant, another company, a forged id, revoked grant, JARVIS or writes off; no ledger row, nothing saved", async () => {
      const oid = await newEnquiry(U.sara);
      const before = await counts(oid); const l = await ledgerCount();
      expect((await rejection(rec(U.noGrant, id(), oid))).code).toBe("P0002");
      expect((await rejection(rec(U.ksaStaff, id(), oid))).code).toBe("P0002");
      expect((await rejection(rec(U.sara, id(), id()))).code).toBe("P0002");
      await admin(`update jarvis_settings set writes_enabled = false`);
      expect((await rejection(rec(U.sara, id(), oid))).code).toBe("42501");
      await admin(`update jarvis_settings set writes_enabled = true, enabled = false`);
      expect((await rejection(rec(U.sara, id(), oid))).code).toBe("42501");
      await admin(`update jarvis_settings set enabled = true`);
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.sara}'`);
      expect((await rejection(rec(U.sara, id(), oid))).code).toBe("P0002");
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.sara}'`);
      expect(await counts(oid)).toEqual(before);
      expect(await ledgerCount()).toBe(l);
    });
    it("another person, another enquiry or different reviewed values on a used confirmation id are refused", async () => {
      const oid = await newEnquiry(U.sara);
      const conf = id();
      await rec(U.sara, conf, oid);
      expect((await rejection(rec(U.sara, conf, oid, activity(), followUp(), { as: U.omar }))).code).toBe("JV002");
      expect((await rejection(rec(U.sara, conf, oid, activity({ body: "A different note" })))).code).toBe("42501");
      expect((await rejection(rec(U.sara, conf, await newEnquiry(U.sara)))).code).toBe("42501");
    });
  });
});
