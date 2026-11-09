import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

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
    await admin(`insert into jarvis_pilot_users (user_id) values ('${U.sara}'), ('${U.omar}'), ('${U.founder}'), ('${U.noGrant}'), ('${U.ksaStaff}')`);
  });
  afterAll(async () => { await db.teardown(); });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("jarvis_register_organisation", () => {
    const HASH = sha("org values A");
    const args = (over: Record<string, unknown> = {}) => ({ company_id: CO.uae, name: "Fictional Lantern Events", roles: ["agency"], country_code: "AE", website: "https://www.lantern-events.example/about", place: "Dubai", note: "SECRET-NOTE-TEXT-777", ack_ids: [], ...over });
    const reg = (user: string, conf: string, a: Record<string, unknown> = args(), hash = HASH) => commit<{ r: Record<string, unknown> }>(user, `select jarvis_register_organisation($1::uuid, $2, $3::jsonb) as r`, [conf, hash, j(a)]);
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
      expect((await rejection(commit(U.founder, `select jarvis_register_organisation($1::uuid, $2, $3::jsonb)`, [conf, HASH, j(args({ name: "Fictional Bound Studio", website: null }))]))).code).toBe("42501");
      expect((await rejection(reg(U.sara, conf, args({ name: "Fictional Bound Studio", website: null }), sha("different")))).code).toBe("42501");
      expect(await orgCount()).toBe(n);
    });
    it("a same-name or same-website organisation that was not named as different is refused (recorded failed once, replayed, nothing created); naming it lets the save through", async () => {
      const existing = (await admin<{ id: string }>(`select id from crm_organisations where name = 'Fictional Lantern Events' limit 1`))[0].id;
      const n = await orgCount();
      const conf = id();
      const r = (await reg(U.sara, conf, args({ name: "FICTIONAL LANTERN EVENTS L.L.C", website: null })))[0].r as R;
      expect(r.status).toBe("done"); // 'LLC' changes the normalised name: not the same name
      const same = args({ name: "fictional lantern events", website: null });
      const f = (await reg(U.sara, id(), same))[0].r as R;
      expect(f).toMatchObject({ status: "failed", error_code: "JV001", result_id: null });
      expect(f.error_message).toMatch(/similar organisation/);
      const byDomain = (await reg(U.sara, id(), args({ name: "A Completely Different Name", website: "http://lantern-events.example/" })))[0].r as R;
      expect(byDomain).toMatchObject({ status: "failed", error_code: "JV001" });
      expect(await orgCount()).toBe(n + 1);
      const conf2 = id();
      const failed = (await reg(U.sara, conf2, same))[0].r as R;
      expect(failed.status).toBe("failed");
      expect((await reg(U.sara, conf2, same))[0].r).toMatchObject({ status: "failed", replayed: true });
      const ok = (await reg(U.sara, id(), args({ name: "fictional lantern events", website: null, ack_ids: [existing] })))[0].r as R;
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
      for (const a of [args({ roles: [] }), args({ roles: ["boss"] }), args({ roles: "agency" }), args({ name: "   " }), args({ company_id: null })]) {
        expect(["22023", "22P02"]).toContain((await rejection(reg(U.sara, id(), a))).code);
      }
      expect((await rejection(commit(U.sara, `select jarvis_register_organisation($1::uuid, 'nope', $2::jsonb)`, [id(), j(args())]))).code).toBe("22023");
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
      for (const sql of [`select jarvis_register_organisation('${id()}', '${HASH}', '{}'::jsonb)`, `select jarvis_ledger_enter('${id()}', '${HASH}', 'x', '${CO.uae}', 'new')`]) {
        expect((await rejection(db.asUser(null, async (q) => (await q(sql)).rows))).message).toMatch(/permission denied/);
      }
      for (const sql of [`select jarvis_ledger_enter('${id()}', '${HASH}', 'x', '${CO.uae}', 'new')`, `select jarvis_ledger_done('${id()}', '${id()}', 'x', null)`, `select jarvis_ledger_fail('${id()}', 'x', 'y')`]) {
        expect((await rejection(commit(U.sara, sql))).message).toMatch(/permission denied/);
      }
    });
  });
});
