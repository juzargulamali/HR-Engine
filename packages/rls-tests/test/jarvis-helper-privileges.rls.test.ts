import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { callArgs, PROOF_KEY, proofCall, wrapperSql } from "../src/jarvis-proof";

// CORRECTIVE MIGRATION 20261223000200_jarvis_helper_privileges.sql, proved against a real Postgres. Fictional data only.
//
// The defect (found by the read-only verifier on hosted V2, then by jarvis_10_execute_privileges_readonly.sql): the platform stamps EXECUTE for anon, authenticated and
// service_role onto every new function in `public`; migration 20261223000100 revoked that for the four internal helpers jarvis_ledger_json / _enter / _done / _fail from public,
// anon and authenticated but not from service_role. A plain test database has no such default privileges, so THIS test first recreates them (exactly what the diagnostic showed
// on hosted: default privileges of postgres in schema public granting EXECUTE on functions to anon, authenticated and service_role), applies 20261223000100 ALONE and proves the
// defect, then applies the corrective migration and proves: the helpers are closed to everyone but their owner, the authorised functions' ACLs are byte-identical, the verifier
// is all OK, the migration is idempotent, and the authorised wrapper still works end to end for an eligible pilot person.
const FIRST = "20261223000100_jarvis_platform.sql";
const FIX = "20261223000200_jarvis_helper_privileges.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const id = () => randomUUID();
const CO = id();
const U = { sara: id(), founder: id() };
const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();

const HELPERS = [
  "jarvis_ledger_json(jarvis_action_ledger, boolean)",
  "jarvis_ledger_enter(uuid, text, text, uuid, text)",
  "jarvis_ledger_done(uuid, uuid, text, jsonb)",
  "jarvis_ledger_fail(uuid, text, text)",
];
const AUTHORISED = [
  "jarvis_my_access(uuid)",
  "jarvis_usage_take(integer)",
  "jarvis_create_enquiry(uuid, uuid, text, integer, bigint, text, text)",
  "jarvis_register_organisation(uuid, uuid, text, integer, bigint, text, text)",
  "jarvis_update_enquiry(uuid, uuid, text, integer, bigint, text, text)",
  "jarvis_change_stage(uuid, uuid, text, integer, bigint, text, text)",
  "jarvis_record_meeting(uuid, uuid, text, integer, bigint, text, text)",
];
const PROOF_MACHINERY = ["jarvis_hmac_sha256(bytea, bytea)", "jarvis_verify_proof(text, uuid, uuid, text, integer, bigint, text, text)", "jarvis_set_proof_key(text)"];

describe("JARVIS corrective migration: internal ledger helpers closed to the service role, authorised wrappers untouched", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as T[];
  const arr = (xs: string[]) => `array[${xs.map((x) => `'${x}'`).join(", ")}]`;
  const aclOf = async (sigs: string[]) =>
    admin<{ sig: string; acl: string | null }>(`select s as sig, (select proacl::text from pg_proc where oid = to_regprocedure('public.' || s)) as acl from unnest(${arr(sigs)}) s order by s`);
  const canRun = async (role: string, sig: string) => (await admin<{ ok: boolean }>(`select has_function_privilege('${role}', to_regprocedure('public.${sig}')::oid, 'execute') as ok`))[0]!.ok;
  const publicRun = async (sig: string) => (await admin<{ ok: boolean }>(`select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure('public.${sig}') and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`))[0]!.ok;
  const verify = async () => (await admin<{ item: string; result: string }>(pack("jarvis_20_verify_readonly.sql")));
  const failing = (rows: { item: string; result: string }[]) => rows.filter((r) => /^(FAIL|MISSING|WRONG)/.test(r.result));
  /** Calls a helper AS a role inside a DO block and reports the SQLSTATE it ended with ('none' = it ran without error). A DO block keeps the connection clean on error. */
  const callAs = async (role: "anon" | "authenticated" | "service_role", call: string) => {
    try {
      await db.seed(`do $$ declare s text := 'none'; begin begin set local role ${role}; perform ${call}; exception when others then s := sqlstate; end; raise exception 'RESULT:%', s; end $$`);
    } catch (e) {
      const m = /RESULT:(\w+)/.exec((e as Error).message);
      if (m) return m[1]!;
      throw e;
    }
    throw new Error("unreachable");
  };
  const ENTER = `jarvis_ledger_enter('${id()}'::uuid, repeat('a', 64), 'jarvis.sales.enquiry.update', '${CO}'::uuid, 'new')`;
  const DONE = `jarvis_ledger_done('${id()}'::uuid, null, 'x', null)`;
  const FAIL = `jarvis_ledger_fail('${id()}'::uuid, 'X', 'x')`;

  let beforeAcl: { sig: string; acl: string | null }[] = [];
  let beforeFailing: string[] = [];
  let preservationBefore: unknown[] = [];

  beforeAll(async () => {
    await db.setupBefore(FIRST);
    // What the hosted diagnostic showed (section 3): new functions in public are granted to the API roles automatically.
    await db.seed(`alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role`);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Fictional Enginious UAE LLC', 'AE', 'AED');
      insert into auth.users (id, email) values ('${U.sara}', 'sara@jarvis-helper-test.ae'), ('${U.founder}', 'founder@jarvis-helper-test.ae');
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO}', 'UAE', 'AED');
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO}', '{founder}'), ('${U.sara}', '${CO}', '{}');
    `);
    await db.applyMigration(FIRST);
    beforeAcl = await aclOf([...HELPERS, ...AUTHORISED, ...PROOF_MACHINERY]);
    beforeFailing = failing(await verify()).map((r) => r.item);
    preservationBefore = (await db.seed(pack("jarvis_05_preservation_check_readonly.sql"))).rows;
  });
  afterAll(async () => { await db.teardown(); });

  describe("before the fix (migration 20261223000100 alone, with the platform's default function privileges)", () => {
    it("reproduces the hosted defect: the service role can execute exactly the four helpers; anon, authenticated and PUBLIC cannot", async () => {
      for (const h of HELPERS) {
        expect(await canRun("service_role", h), `service_role on ${h}`).toBe(true);
        expect(await canRun("authenticated", h)).toBe(false);
        expect(await canRun("anon", h)).toBe(false);
        expect(await publicRun(h)).toBe(false);
      }
      for (const f of PROOF_MACHINERY) expect(await canRun("service_role", f), `service_role on ${f}`).toBe(false);
    });

    it("the read-only verifier fails on exactly the four helpers, as on hosted V2", () => {
      expect(beforeFailing).toHaveLength(4);
      for (const h of HELPERS.map((x) => x.split("(")[0]!)) expect(beforeFailing.filter((i) => i.includes(`${h}(`))).toHaveLength(1);
      for (const i of beforeFailing) expect(i).toContain("is NOT callable by signed-in users, anon, public or the platform service role");
    });

    it("the diagnostic query (read-only transaction) names service_role as the explicit grantee of those four, granted by postgres", async () => {
      const res = (await db.seed(`begin read only; ${pack("jarvis_10_execute_privileges_readonly.sql")} rollback;`)) as unknown as QueryResult[];
      const rows = (res.find((r) => Array.isArray(r.rows) && r.rows.some((x) => "section" in x))?.rows ?? []) as { section: number; function: string; role: string; detail: string }[];
      const bad = rows.filter((r) => r.section === 2 && r.role === "service_role" && HELPERS.some((h) => r.function.startsWith(h.split("(")[0]!)));
      expect(bad).toHaveLength(4);
      for (const r of bad) expect(r.detail).toContain("explicit grant to service_role (grantor postgres)");
      expect(rows.some((r) => r.section === 3 && r.detail.includes("schema public grants EXECUTE to service_role"))).toBe(true);
    });

    it("what a service-role call could do: it reaches the helper and is refused only because nobody is signed in", async () => {
      expect(await callAs("service_role", ENTER)).toBe("28000");
    });
  });

  describe("after the corrective migration", () => {
    beforeAll(async () => { await db.applyMigration(FIX); });

    it("the four helpers are executable by nobody but their owner: not the service role, not anon, not authenticated, not PUBLIC, and no other role in the ACL", async () => {
      for (const h of HELPERS) {
        for (const role of ["service_role", "anon", "authenticated"]) expect(await canRun(role, h), `${role} on ${h}`).toBe(false);
        expect(await publicRun(h)).toBe(false);
        const grantees = (await admin<{ g: string }>(`select pg_get_userbyid(a.grantee) as g from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure('public.${h}') and a.privilege_type = 'EXECUTE'`)).map((r) => r.g);
        expect(grantees).toEqual(["postgres"]);
      }
    });

    it("direct calls by the service role, anon and signed-in users are refused by privilege (42501), before any function body runs", async () => {
      for (const role of ["service_role", "anon", "authenticated"] as const) {
        expect(await callAs(role, ENTER), `${role} enter`).toBe("42501");
        expect(await callAs(role, DONE), `${role} done`).toBe("42501");
        expect(await callAs(role, FAIL), `${role} fail`).toBe("42501");
      }
    });

    it("the read-only verifier is now all OK (no FAIL, MISSING or WRONG row)", async () => {
      expect(failing(await verify())).toEqual([]);
    });

    it("the authorised functions are untouched: their ACLs are byte-identical to before, signed-in users still execute exactly the seven wrappers' set, anon and PUBLIC still cannot", async () => {
      const after = await aclOf([...HELPERS, ...AUTHORISED, ...PROOF_MACHINERY]);
      const same = (sigs: string[]) => expect(after.filter((r) => sigs.includes(r.sig))).toEqual(beforeAcl.filter((r) => sigs.includes(r.sig)));
      same(AUTHORISED);
      same(PROOF_MACHINERY);
      for (const f of AUTHORISED) {
        expect(await canRun("authenticated", f), `authenticated on ${f}`).toBe(true);
        expect(await canRun("anon", f)).toBe(false);
        expect(await publicRun(f)).toBe(false);
      }
      for (const f of PROOF_MACHINERY) for (const role of ["service_role", "anon", "authenticated"]) expect(await canRun(role, f), `${role} on ${f}`).toBe(false);
      // the only functions signed-in users can execute are still exactly the seven named (no stray jarvis_* function appeared)
      const exec = (await admin<{ sig: string }>(`select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jarvis\\_%' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).length;
      expect(exec).toBe(AUTHORISED.length);
    });

    it("the owner's preservation check is identical before and after (this migration changes privileges only)", async () => {
      expect((await db.seed(pack("jarvis_05_preservation_check_readonly.sql"))).rows).toEqual(preservationBefore);
    });

    it("is idempotent: running it again changes no ACL and still passes the verifier", async () => {
      const snapshot = await aclOf([...HELPERS, ...AUTHORISED, ...PROOF_MACHINERY]);
      await db.applyMigration(FIX);
      expect(await aclOf([...HELPERS, ...AUTHORISED, ...PROOF_MACHINERY])).toEqual(snapshot);
      expect(failing(await verify())).toEqual([]);
    });

    it("the diagnostic no longer lists the service role, anon, authenticated or PUBLIC on any helper", async () => {
      const res = (await db.seed(`begin read only; ${pack("jarvis_10_execute_privileges_readonly.sql")} rollback;`)) as unknown as QueryResult[];
      const rows = (res.find((r) => Array.isArray(r.rows) && r.rows.some((x) => "section" in x))?.rows ?? []) as { section: number; function: string; role: string }[];
      const helperRows = rows.filter((r) => r.section <= 2 && HELPERS.some((h) => r.function.startsWith(h.split("(")[0]!)));
      expect(helperRows.length).toBeGreaterThan(0);
      for (const r of helperRows) expect(r.role).toBe("postgres");
    });

    it("an eligible pilot person can still use the authorised wrapper end to end (valid proof: an enquiry and a confirmed ledger row; the helpers run as the wrapper's owner)", async () => {
      await db.seed(`select jarvis_set_proof_key('${PROOF_KEY}')`);
      await db.seed(`update jarvis_settings set enabled = true, writes_enabled = true`);
      await db.seed(`insert into jarvis_pilot_users (user_id) values ('${U.sara}')`);
      const clientId = (await db.asUserCommit(U.founder, async (q) => (await q(`select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`)).rows[0].id as string));
      const payload = { company_id: CO, title: "Fictional helper-privileges check", source: "whatsapp", next_title: "Call to qualify", next_due: SOON, next_kind: "call", agency_org_id: null, client_org_id: clientId, currency: "AED", value: 1000, brief: "x", location: "Harbour Hall", technologies: [] };
      const call = proofCall({ user: U.sara, company: CO, action: "jarvis.sales.enquiry.create_from_brief", target: "new", payload });
      const r = await db.asUserCommit(U.sara, async (q) => (await q(wrapperSql("jarvis_create_enquiry"), callArgs(call))).rows[0].r as { status: string; opportunity_id: string; replayed: boolean });
      expect(r.status).toBe("done");
      expect(r.replayed).toBe(false);
      const led = await admin<{ status: string; user_id: string; company_id: string }>(`select status, user_id, company_id from jarvis_action_ledger where confirmation_id = '${call.jti}'`);
      expect(led).toEqual([{ status: "done", user_id: U.sara, company_id: CO }]);
      expect(await admin<{ n: string }>(`select count(*)::text as n from crm_opportunities where id = '${r.opportunity_id}'`)).toEqual([{ n: "1" }]);
      // the same proof again returns the original result and writes nothing more
      const again = await db.asUserCommit(U.sara, async (q) => (await q(wrapperSql("jarvis_create_enquiry"), callArgs(call))).rows[0].r as { replayed: boolean; opportunity_id: string });
      expect(again.replayed).toBe(true);
      expect(again.opportunity_id).toBe(r.opportunity_id);
    });
  });
});
