import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// JARVIS part 1 (migration 20261223000100_jarvis_platform.sql). Fictional data only. Proves against a real Postgres:
//   * default OFF: nobody is available, nothing can be created, and the migration changes no existing function or row (owner pack preflight / preservation / verify);
//   * the pilot controls: global switch, allowlist, write kill switch (read-only help keeps working), optional company list; access is answered as booleans only;
//   * jarvis_create_enquiry: the enquiry comes from the EXISTING crm_create_opportunity under the caller's own identity (a person without a Sales grant, or for a
//     company they have no grant for, is refused by the underlying rule and leaves no row); the ledger row and the enquiry commit together; N parallel calls with the
//     same confirmation id create exactly ONE enquiry; a repeat (after a timeout, or from another connection = a restart) returns the ORIGINAL result; another person,
//     company or different values on a used confirmation id are refused; a refusal by the existing rules is recorded once and replayed, creating nothing;
//   * the ledger stores no text; a person reads at most their own rows; no direct write to any jarvis_* table works;
//   * the daily usage limit is enforced atomically and survives (it is a table, not memory);
//   * the owner pack, then the rollback (twice) and the re-apply.

const MIGRATIONS_BEFORE = "20261223000100_jarvis_platform.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { sara: id(), omar: id(), noGrant: id(), ksaStaff: id(), outsider: id(), founder: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@jarvis-test.ae')`).join(", ");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HASH = sha("reviewed values A");

describe("JARVIS platform (part 1)", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
  const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error("expected a refusal, but the call succeeded"); };
  const j = (o: unknown) => JSON.stringify(o);
  const soon = () => new Date(Date.now() + 2 * 86_400_000).toISOString();

  let clientId: string; let agencyId: string; let plainOrg: string;
  const args = (over: Record<string, unknown> = {}) => ({
    company_id: CO.uae, title: "Fictional LED wall for a harbour gala", source: "whatsapp", next_title: "Call to qualify the brief", next_due: soon(), next_kind: "call",
    agency_org_id: agencyId, client_org_id: clientId, currency: "AED", value: 45000, brief: "SECRET-BRIEF-TEXT-1234 needs two LED walls", location: "Harbour Hall",
    event_start: "2026-12-05", technologies: [{ name: "LED wall", qty: 2 }], ...over,
  });
  const create = (user: string, conf: string, a: Record<string, unknown> = args(), hash = HASH) =>
    commit<{ r: Record<string, unknown> }>(user, `select jarvis_create_enquiry($1::uuid, $2, $3::jsonb) as r`, [conf, hash, j(a)]);
  const countOpps = async () => Number((await admin<{ n: string }>(`select count(*)::text n from crm_opportunities`))[0].n);
  const countLedger = async () => Number((await admin<{ n: string }>(`select count(*)::text n from jarvis_action_ledger`))[0].n);
  const setSwitches = (enabled: boolean, writes: boolean) => admin(`update jarvis_settings set enabled = ${enabled}, writes_enabled = ${writes}`);
  const world = async () => (await admin<Record<string, string>>(`select
      (select count(*)::text from crm_opportunities) as opps, (select count(*)::text from crm_follow_ups) as fus,
      (select count(*)::text from crm_opportunity_events) as events, (select coalesce(sum(last_value),0)::text from crm_reference_counters) as counters,
      (select count(*)::text from jarvis_action_ledger) as ledger`))[0];

  let preflight: { section: string; item: string; detail: string }[] = [];
  let before: { item: string; n: string; fingerprint: string }[] = [];
  let before2: typeof before = [];

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS_BEFORE);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA LLC', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR');
    `);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaStaff}', '${CO.ksa}', '{}');
    `);
    clientId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    agencyId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Wave Agency', p_roles => '{agency}', p_country_code => 'AE') as id`))[0].id;
    plainOrg = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Tech Only Co', p_roles => '{technology}', p_country_code => 'AE') as id`))[0].id;
    // Owner pack BEFORE the migration (preservation run twice).
    preflight = (await db.seed(pack("jarvis_00_preflight_readonly.sql"))).rows as typeof preflight;
    before = (await db.seed(pack("jarvis_05_preservation_check_readonly.sql"))).rows as typeof before;
    before2 = (await db.seed(pack("jarvis_05_preservation_check_readonly.sql"))).rows as typeof before2;
    await db.applyMigration(MIGRATIONS_BEFORE);
  });
  afterAll(async () => { await db.teardown(); });

  describe("owner pack and default state", () => {
    it("preflight before the migration: prerequisites OK and 'not applied yet'", () => {
      const b = preflight.filter((r) => r.section === "B prerequisites");
      expect(b.length).toBeGreaterThan(15);
      expect(b.filter((r) => !/^OK/.test(r.detail))).toEqual([]);
      expect(b.find((r) => r.item === "applied already?")?.detail).toBe("OK - not applied yet");
    });
    it("preservation check is stable before, and identical after except the new objects", async () => {
      expect(before2).toEqual(before);
      const after = (await db.seed(pack("jarvis_05_preservation_check_readonly.sql"))).rows as typeof before;
      const changed = after.filter((a, i) => JSON.stringify(a) !== JSON.stringify(before[i])).map((a) => a.item);
      expect(changed.every((i) => i.includes("INTENDED TO CHANGE"))).toBe(true);
      expect(changed.length).toBe(8);
      expect(after.filter((a) => a.item.startsWith("function crm_create_opportunity"))[0]?.fingerprint).toBe(before.filter((a) => a.item.startsWith("function crm_create_opportunity"))[0]?.fingerprint);
    });
    it("verify pack: every pass/fail row says OK", async () => {
      const rows = (await db.seed(pack("jarvis_20_verify_readonly.sql"))).rows as { item: string; result: string }[];
      const checks = rows.filter((r) => !r.item.startsWith("INFORMATION"));
      expect(checks.length).toBeGreaterThan(20);
      expect(checks.filter((r) => r.result !== "OK")).toEqual([]);
      expect(rows.find((r) => r.item.includes("global switch"))?.result).toBe("false / false");
    });
    it("default OFF: nobody is available, the write is refused and creates nothing", async () => {
      for (const u of [U.sara, U.omar, U.founder, U.outsider]) {
        const a = (await commit<{ is_available: boolean; writes_allowed: boolean }>(u, `select * from jarvis_my_access()`))[0];
        expect(a.is_available).toBe(false);
        expect(a.writes_allowed).toBe(false);
      }
      const before = await world();
      const e = await rejection(create(U.sara, id()));
      expect(e.code).toBe("42501");
      expect(await world()).toEqual(before);
    });
    it("a signed-out (anon) caller cannot call any function", async () => {
      for (const sql of [`select * from jarvis_my_access()`, `select * from jarvis_usage_take(5)`, `select jarvis_create_enquiry('${id()}', '${HASH}', '{}'::jsonb)`]) {
        const e = await rejection(db.asUser(null, async (q) => (await q(sql)).rows));
        expect(e.message).toMatch(/permission denied/);
      }
    });
  });

  describe("pilot controls (switches, allowlist, company list, write kill switch)", () => {
    it("enabled but not on the allowlist: still unavailable", async () => {
      await setSwitches(true, true);
      const a = (await commit<{ is_available: boolean; writes_allowed: boolean }>(U.sara, `select * from jarvis_my_access()`))[0];
      expect(a).toMatchObject({ is_available: false, writes_allowed: false });
      expect((await rejection(create(U.sara, id()))).code).toBe("42501");
    });
    it("on the allowlist AND enabled: available; an inactive profile is not", async () => {
      await admin(`insert into jarvis_pilot_users (user_id, note) values ('${U.sara}', 'pilot'), ('${U.noGrant}', 'pilot'), ('${U.ksaStaff}', 'pilot'), ('${U.founder}', 'pilot')`);
      expect((await commit<{ is_available: boolean }>(U.sara, `select * from jarvis_my_access()`))[0].is_available).toBe(true);
      expect((await commit<{ is_available: boolean }>(U.omar, `select * from jarvis_my_access()`))[0].is_available).toBe(false);
      await admin(`update profiles set is_active = false where id = '${U.noGrant}'`);
      expect((await commit<{ is_available: boolean }>(U.noGrant, `select * from jarvis_my_access()`))[0].is_available).toBe(false);
      await admin(`update profiles set is_active = true where id = '${U.noGrant}'`);
      expect((await commit<{ is_available: boolean }>(U.noGrant, `select * from jarvis_my_access()`))[0].is_available).toBe(true);
    });
    it("write kill switch: read access stays (available) while the write is refused with no side effect", async () => {
      await setSwitches(true, false);
      const a = (await commit<{ is_available: boolean; writes_allowed: boolean }>(U.sara, `select * from jarvis_my_access()`))[0];
      expect(a).toMatchObject({ is_available: true, writes_allowed: false });
      const before = await world();
      expect((await rejection(create(U.sara, id()))).code).toBe("42501");
      expect(await world()).toEqual(before);
      await setSwitches(true, true);
    });
    it("global switch off again: everyone is unavailable at once", async () => {
      await setSwitches(false, true);
      expect((await commit<{ is_available: boolean }>(U.sara, `select * from jarvis_my_access()`))[0].is_available).toBe(false);
      expect((await rejection(create(U.sara, id()))).code).toBe("42501");
      await setSwitches(true, true);
    });
    it("company list: empty means no restriction; with rows only those companies", async () => {
      expect((await commit<{ company_allowed: boolean }>(U.ksaStaff, `select * from jarvis_my_access('${CO.ksa}')`))[0].company_allowed).toBe(true);
      await admin(`insert into jarvis_pilot_companies (company_id) values ('${CO.uae}')`);
      expect((await commit<{ company_allowed: boolean }>(U.sara, `select * from jarvis_my_access('${CO.uae}')`))[0].company_allowed).toBe(true);
      expect((await commit<{ company_allowed: boolean }>(U.ksaStaff, `select * from jarvis_my_access('${CO.ksa}')`))[0].company_allowed).toBe(false);
      const before = await world();
      expect((await rejection(create(U.ksaStaff, id(), args({ company_id: CO.ksa, agency_org_id: agencyId, client_org_id: clientId })))).code).toBe("42501");
      expect(await world()).toEqual(before);
      await admin(`delete from jarvis_pilot_companies`);
    });
    it("access answers booleans only (no allowlist or setting is readable by a signed-in user)", async () => {
      for (const t of ["jarvis_settings", "jarvis_pilot_users", "jarvis_pilot_companies", "jarvis_usage"]) {
        const rows = await commit<{ n: string }>(U.sara, `select count(*)::text n from ${t}`).catch(() => null);
        // Either the privilege is gone (error) or RLS hides every row (0): never any content.
        expect(rows === null || rows[0].n === "0").toBe(true);
      }
    });
  });

  describe("create an enquiry (the atomic wrapper)", () => {
    it("creates the enquiry once through the existing function, under the caller's identity, with ledger and timeline", async () => {
      const conf = id();
      const r = (await create(U.sara, conf))[0].r as { status: string; opportunity_id: string; reference: string; replayed: boolean };
      expect(r).toMatchObject({ status: "done", replayed: false });
      expect(r.reference).toMatch(/^OPP-UAE-\d{4}-\d{4}$/);
      const opp = (await admin<Record<string, string>>(`select owner_id, created_by, stage, title, source, agency_org_id, client_org_id, currency, value::text, location from crm_opportunities where id = '${r.opportunity_id}'`))[0];
      expect(opp).toMatchObject({ owner_id: U.sara, created_by: U.sara, stage: "new", source: "whatsapp", agency_org_id: agencyId, client_org_id: clientId, currency: "AED", value: "45000.00" });
      expect((await admin(`select 1 from crm_follow_ups where opportunity_id = '${r.opportunity_id}' and assigned_to = '${U.sara}' and status = 'open'`)).length).toBe(1);
      const events = await admin<{ kind: string; from_value: string | null; actor_id: string }>(`select kind, from_value, actor_id from crm_opportunity_events where opportunity_id = '${r.opportunity_id}' order by created_at, id`);
      expect(events.map((e) => e.kind)).toEqual(["created", "created"]);
      expect(events.some((e) => e.from_value === "jarvis" && e.actor_id === U.sara)).toBe(true);
      const led = (await admin<Record<string, string>>(`select user_id, company_id, action_id, target, status, result_ref, result_id from jarvis_action_ledger where confirmation_id = '${conf}'`))[0];
      expect(led).toMatchObject({ user_id: U.sara, company_id: CO.uae, action_id: "jarvis.sales.enquiry.create_from_brief", target: "new", status: "done", result_ref: r.reference, result_id: r.opportunity_id });
    });
    it("the ledger stores NO text: no brief, title or any enquiry value appears in any ledger column", async () => {
      const dump = JSON.stringify(await admin(`select * from jarvis_action_ledger`));
      for (const needle of ["SECRET-BRIEF-TEXT-1234", "Fictional LED wall", "Harbour Hall", "LED wall", "Call to qualify"]) expect(dump).not.toContain(needle);
    });
    it("a repeat with the same confirmation id returns the ORIGINAL result and creates nothing (timeout / double click / restart)", async () => {
      const conf = id();
      const first = (await create(U.sara, conf))[0].r as { opportunity_id: string; reference: string };
      const before = await world();
      for (let i = 0; i < 3; i++) {
        const again = (await create(U.sara, conf))[0].r as { status: string; opportunity_id: string; reference: string; replayed: boolean };
        expect(again).toMatchObject({ status: "done", replayed: true, opportunity_id: first.opportunity_id, reference: first.reference });
      }
      expect(await world()).toEqual(before);
    });
    it("N parallel calls with the SAME confirmation id create exactly ONE enquiry (serialised on the confirmation id)", async () => {
      const conf = id();
      const n = await countOpps();
      const results = await Promise.all(Array.from({ length: 12 }, () => create(U.sara, conf)));
      const rs = results.map((x) => x[0].r as { status: string; opportunity_id: string; reference: string; replayed: boolean });
      expect(new Set(rs.map((r) => r.opportunity_id)).size).toBe(1);
      expect(new Set(rs.map((r) => r.reference)).size).toBe(1);
      expect(rs.filter((r) => !r.replayed).length).toBe(1);
      expect(rs.every((r) => r.status === "done")).toBe(true);
      expect(await countOpps()).toBe(n + 1);
      expect((await admin(`select 1 from jarvis_action_ledger where confirmation_id = '${conf}'`)).length).toBe(1);
    });
    it("parallel calls with DIFFERENT confirmation ids each create their own enquiry with distinct references (no cross-talk)", async () => {
      const n = await countOpps();
      const rs = (await Promise.all(Array.from({ length: 6 }, () => create(U.sara, id())))).map((x) => x[0].r as { reference: string });
      expect(new Set(rs.map((r) => r.reference)).size).toBe(6);
      expect(await countOpps()).toBe(n + 6);
    });
    it("another person cannot use or learn about someone else's confirmation id", async () => {
      const conf = id();
      await create(U.sara, conf);
      const before = await world();
      const e = await rejection(commit(U.founder, `select jarvis_create_enquiry($1::uuid, $2, $3::jsonb) as r`, [conf, HASH, j(args())]));
      expect(e.code).toBe("42501");
      expect(await world()).toEqual(before);
    });
    it("a used confirmation id with a different company or different reviewed values is refused (no second enquiry)", async () => {
      const conf = id();
      await create(U.sara, conf);
      const before = await world();
      expect((await rejection(create(U.sara, conf, args(), sha("other values")))).code).toBe("42501");
      expect((await rejection(commit(U.ksaStaff, `select jarvis_create_enquiry($1::uuid, $2, $3::jsonb)`, [conf, HASH, j(args({ company_id: CO.ksa }))]))).code).toBe("42501");
      expect(await world()).toEqual(before);
    });
    it("cannot bypass the existing create permission: a pilot user WITHOUT a Sales grant is refused and leaves no ledger row", async () => {
      const before = await world();
      const e = await rejection(create(U.noGrant, id()));
      expect(e.code).toBe("42501");
      expect(e.message).toMatch(/Sales access/);
      expect(await world()).toEqual(before);
    });
    it("cannot bypass it for another company: a Sales user of one company cannot create for a company they hold no grant for", async () => {
      const before = await world();
      expect((await rejection(create(U.sara, id(), args({ company_id: CO.ksa })))).code).toBe("42501");
      expect(await world()).toEqual(before);
    });
    it("a revoked Sales grant is refused at once", async () => {
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.omar}'`);
      await admin(`insert into jarvis_pilot_users (user_id) values ('${U.omar}') on conflict do nothing`);
      const before = await world();
      expect((await rejection(create(U.omar, id()))).code).toBe("42501");
      expect(await world()).toEqual(before);
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.omar}'`);
    });
    it("a refusal by the existing rules (agency role missing) is recorded ONCE as failed, creates nothing and is replayed on a repeat", async () => {
      const conf = id();
      const before = await world();
      const bad = args({ agency_org_id: plainOrg });
      const r = (await create(U.sara, conf, bad))[0].r as { status: string; error_code: string; error_message: string; replayed: boolean; opportunity_id: string | null };
      expect(r).toMatchObject({ status: "failed", error_code: "22023", replayed: false, opportunity_id: null });
      expect(r.error_message).toMatch(/not recorded as an agency/);
      const after = await world();
      expect(after.opps).toBe(before.opps);
      expect(after.fus).toBe(before.fus);
      expect(after.events).toBe(before.events);
      expect(after.counters).toBe(before.counters); // the reference number was not consumed
      expect(Number(after.ledger)).toBe(Number(before.ledger) + 1);
      const again = (await create(U.sara, conf, bad))[0].r as { status: string; replayed: boolean };
      expect(again).toMatchObject({ status: "failed", replayed: true });
      expect((await world()).ledger).toBe(after.ledger);
    });
    it("a company without Sales settings is refused by the existing rule (recorded failed, nothing created)", async () => {
      await admin(`delete from crm_company_settings where company_id = '${CO.ksa}'`);
      await admin(`insert into jarvis_pilot_users (user_id) values ('${U.ksaStaff}') on conflict do nothing`);
      const before = await world();
      const r = (await create(U.ksaStaff, id(), args({ company_id: CO.ksa })))[0].r as { status: string; error_message: string };
      expect(r.status).toBe("failed");
      expect(r.error_message).toMatch(/not configured/);
      expect((await world()).opps).toBe(before.opps);
      await admin(`insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.ksa}', 'KSA', 'SAR')`);
    });
    it("an incomplete confirmation (no agency or client) is refused by the existing rule", async () => {
      const r = (await create(U.sara, id(), args({ agency_org_id: null, client_org_id: null })))[0].r as { status: string; error_message: string };
      expect(r.status).toBe("failed");
      expect(r.error_message).toMatch(/agency or an end client/);
    });
    it("malformed input is refused with no ledger row", async () => {
      const before = await world();
      for (const [conf, hash, a] of [[id(), "not-a-hash", args()], [id(), HASH, { title: "x" }], [id(), HASH, [1, 2]]] as [string, string, unknown][]) {
        const e = await rejection(commit(U.sara, `select jarvis_create_enquiry($1::uuid, $2, $3::jsonb)`, [conf, hash, j(a)]));
        expect(["22023", "22P02"]).toContain(e.code);
      }
      expect(await world()).toEqual(before);
    });
  });

  describe("ledger visibility and direct writes", () => {
    it("a person reads only their OWN ledger rows", async () => {
      const mine = await commit<{ user_id: string }>(U.sara, `select user_id from jarvis_action_ledger`);
      expect(mine.length).toBeGreaterThan(3);
      expect(mine.every((r) => r.user_id === U.sara)).toBe(true);
      expect((await commit<{ n: string }>(U.founder, `select count(*)::text n from jarvis_action_ledger`))[0].n).toBe("0");
      expect((await commit<{ n: string }>(U.outsider, `select count(*)::text n from jarvis_action_ledger`))[0].n).toBe("0");
    });
    it("no direct write to any jarvis_* table works (insert, update, delete): refused, rows unchanged", async () => {
      const before = await world();
      const stmts = [
        `insert into jarvis_action_ledger (confirmation_id, user_id, company_id, action_id, target, values_hash) values ('${id()}', '${U.sara}', '${CO.uae}', 'x', 'new', '${HASH}')`,
        `update jarvis_action_ledger set status = 'failed' where user_id = '${U.sara}'`,
        `delete from jarvis_action_ledger`,
        `update jarvis_settings set enabled = true, writes_enabled = true`,
        `insert into jarvis_pilot_users (user_id) values ('${U.outsider}')`,
        `delete from jarvis_pilot_users`,
        `insert into jarvis_pilot_companies (company_id) values ('${CO.uae}')`,
        `insert into jarvis_usage (user_id, usage_day, requests) values ('${U.sara}', current_date, 0)`,
        `update jarvis_usage set requests = 0`,
      ];
      for (const s of stmts) expect((await rejection(commit(U.sara, s))).message).toMatch(/permission denied|row-level security/);
      expect(await world()).toEqual(before);
      expect((await commit<{ is_available: boolean }>(U.outsider, `select * from jarvis_my_access()`))[0].is_available).toBe(false);
    });
  });

  describe("usage limit", () => {
    it("counts atomically and refuses beyond the limit; parallel callers cannot both take the last slot; a different person is separate", async () => {
      const take = (u: string, limit: number) => commit<{ allowed: boolean; used: number; remaining: number }>(u, `select * from jarvis_usage_take(${limit})`).then((r) => r[0]);
      expect(await take(U.founder, 3)).toMatchObject({ allowed: true, used: 1, remaining: 2 });
      expect(await take(U.founder, 3)).toMatchObject({ allowed: true, used: 2, remaining: 1 });
      const racers = await Promise.all(Array.from({ length: 8 }, () => take(U.founder, 3)));
      expect(racers.filter((r) => r.allowed).length).toBe(1);
      expect(racers.filter((r) => !r.allowed).every((r) => r.used === 3 && r.remaining === 0)).toBe(true);
      expect(await take(U.founder, 3)).toMatchObject({ allowed: false, used: 3, remaining: 0 });
      expect(await take(U.sara, 3)).toMatchObject({ allowed: true, used: 1 });
      // durable: the count is a table row (a restart or another app instance reads the same number)
      expect((await admin<{ requests: number }>(`select requests from jarvis_usage where user_id = '${U.founder}'`))[0].requests).toBe(3);
    });
    it("is refused for a person who is not available", async () => {
      expect((await rejection(commit(U.outsider, `select * from jarvis_usage_take(5)`))).code).toBe("42501");
      expect((await rejection(commit(U.sara, `select * from jarvis_usage_take(0)`))).code).toBe("22023");
    });
  });

  describe("rollback", () => {
    it("refuses while the ledger has rows (export first), then drops everything, twice, and the migration re-applies", async () => {
      const refused = await rejection(db.seed(pack("jarvis_90_rollback.sql")));
      expect(refused.message).toMatch(/Export it first/);
      expect((await admin(`select to_regclass('public.jarvis_action_ledger') is not null as t`))[0].t).toBe(true);
      const confirm = `select set_config('jarvis.confirm_ledger_exported', 'yes', false);\n`;
      const countOppsBefore = await countOpps();
      await db.seed(confirm + pack("jarvis_90_rollback.sql"));
      await db.seed(pack("jarvis_90_rollback.sql")); // second run: nothing left to export or drop
      expect(await countOpps()).toBe(countOppsBefore); // enquiries created through JARVIS stay
      const left = await admin<{ n: string }>(`select count(*)::text n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'jarvis\\_%'`);
      expect(left[0].n).toBe("0");
      expect((await admin(`select to_regclass('public.jarvis_settings') is null as t`))[0].t).toBe(true);
      expect(await rejection(commit(U.sara, `select * from jarvis_my_access()`))).toBeTruthy();
      await db.applyMigration(MIGRATIONS_BEFORE);
      await db.applyMigration(MIGRATIONS_BEFORE); // idempotent
      expect((await admin<{ enabled: boolean; writes_enabled: boolean }>(`select enabled, writes_enabled from jarvis_settings`))[0]).toEqual({ enabled: false, writes_enabled: false });
    });
  });
});
